// The goal row above the prompt: one line, always there, drawn the way usage-band draws its
// band so the two read as one family. Pure functions: no mods API calls, so tests drive them.
//
// Desktop and mobile get one SVG drawn as a plain image (an image redraws in place; a framed SVG
// blinks on every redraw), with usage-band's type, rounded bar and shine. The terminal gets one
// row of spans with usage-band's ■ bar.

import { minutes, clip } from './fmt.mjs'

// usage-band's hues are cyan, amber, indigo and green; the goal takes rose, green when done
export const HUE = { goal: '#e58fb6', done: '#72cf9f' }
const TRACK = '#4a4f5c'

// Blend a #rrggbb color toward white (t > 0) or black (t < 0) by |t|
export const lighten = (hex, t) => {
  const n = parseInt(hex.slice(1), 16)
  const target = t >= 0 ? 255 : 0
  const ch = (v) => Math.round(v + (target - v) * Math.abs(t)).toString(16).padStart(2, '0')
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`
}

const esc = (v) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// ---- what the row says, the same on every surface

/**
 * The row's parts for a goal (null when the chat has none, or its goal ended a while ago).
 * state: 'idle' | 'planning' | 'running' | 'done' | 'stopped'
 */
export function rowOf(g, p, etaMs, isRecent) {
  if (!g || !(g.status === 'running' || isRecent)) {
    return { state: 'idle', title: 'No goal', detail: '/goal <what done looks like>' }
  }
  const title = clip(g.title, 40)
  if (g.status === 'met') return { state: 'done', title, figure: 'done ✓', detail: minutes((g.endedAt || 0) - g.startedAt) }
  if (g.status !== 'running') return { state: 'stopped', title, figure: 'stopped' }
  if (!g.planAt) return { state: 'planning', title, detail: 'planning…' }
  return {
    state: 'running',
    title,
    fraction: p.fraction,
    figure: `${p.doneN}/${p.n} · ${p.pct}%`,
    detail: etaMs ? `~${minutes(etaMs)} left` : p.doneN < 2 ? 'ETA after 2 tasks' : '',
  }
}

export function describe(r) {
  return [r.state === 'idle' ? 'No goal' : `Goal: ${r.title}`, r.figure, r.detail].filter(Boolean).join(', ')
}

// ---- desktop: one SVG in usage-band's style

const CAP = { top: 9.75, h: 10 }
const D = { h: 30, inner: 7, size: 13, barW: 120, barH: 6, icon: 10 }
// Advance widths in em for Inter with tabular figures (usage-band's table); wide CJK and
// symbols take a full em, so a Chinese goal gets the room it needs
const ADVANCE = { h: 0.58, d: 0.6, m: 0.9, K: 0.64, M: 0.84, '%': 0.84, '/': 0.36, '.': 0.27, ' ': 0.26, '·': 0.3, '✓': 0.7, '~': 0.6 }
export const textW = (v, size = D.size) =>
  [...v].reduce((w, c) => w + (c >= '0' && c <= '9' ? 0.62 : c.codePointAt(0) >= 0x2e80 ? 1 : (ADVANCE[c] ?? 0.6)), 0) * size +
  0.2 * Math.max(0, [...v].length - 1)

const pinW = (v) => `textLength="${textW(v).toFixed(1)}" lengthAdjust="spacing"`
const ink = (hue, x, v) =>
  `<text x="${x}" y="19.5" font-size="${D.size}" ${pinW(v)} class="ink" style="--l:${lighten(hue, -0.38)};--d:${lighten(hue, 0.25)}">${esc(v)}</text>`
const mute = (x, v) => `<text x="${x}" y="19.5" font-size="${D.size}" ${pinW(v)} class="mute">${esc(v)}</text>`
const rule = (x) => `<rect x="${x}" y="${CAP.top}" width="1" height="${CAP.h}" class="rule"/>`

// A target, as usage-band draws its cache icon
const icon = (color) =>
  `<g fill="none" stroke="${color}" stroke-width="1.2">` +
  `<circle cx="5" cy="5" r="4.4"/><circle cx="5" cy="5" r="2.1"/><circle cx="5" cy="5" r="0.7" fill="${color}"/></g>`

const HEAD =
  `<style>` +
  `:root{color-scheme:light dark;background:transparent}` +
  `text{font-family:Inter,"SF Pro Text",system-ui,-apple-system,"Segoe UI",sans-serif;font-weight:500;font-feature-settings:"tnum","cv05"}` +
  `.track{fill:var(--h);fill-opacity:.22}` +
  `.ink{fill:var(--l)}.mute{fill:#8b8f97;font-weight:400}.rule{fill:#000;fill-opacity:.1}` +
  `@media (prefers-color-scheme:dark){.ink{fill:var(--d)}.mute{fill:#9aa0a8}.rule{fill:#fff;fill-opacity:.13}}` +
  `</style>` +
  `<defs><linearGradient id="shine" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/>` +
  `<stop offset=".5" stop-color="#fff" stop-opacity=".8"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>`

export function rowSvg(r) {
  const hue = r.state === 'done' ? HUE.done : HUE.goal
  const parts = [`<g transform="translate(1 ${CAP.top})">${icon(r.state === 'idle' ? '#8b8f97' : lighten(hue, -0.15))}</g>`]
  let x = 1 + D.icon + 6
  const put = (draw, v, gap = D.inner) => {
    parts.push(draw(x, v))
    x += textW(v) + gap
  }
  if (r.state === 'idle') put(mute, r.title)
  else put((px, v) => ink(hue, px, v), r.title)
  if (r.state === 'running') {
    const y = (D.h - D.barH) / 2
    const rad = D.barH / 2
    const fillW = Math.max(r.fraction > 0 ? D.barH : 0, Math.min(D.barW, D.barW * r.fraction))
    parts.push(
      `<defs><clipPath id="c-goal"><rect x="${x}" y="${y}" width="${fillW}" height="${D.barH}" rx="${rad}"/></clipPath></defs>`,
      `<rect x="${x}" y="${y}" width="${D.barW}" height="${D.barH}" rx="${rad}" class="track" style="--h:${hue}"/>`,
      `<rect x="${x}" y="${y}" width="${fillW}" height="${D.barH}" rx="${rad}" fill="${lighten(hue, -0.12)}"/>`,
      `<g clip-path="url(#c-goal)"><rect y="${y}" width="18" height="${D.barH}" fill="url(#shine)">` +
        `<animate attributeName="x" values="${x - 18};${x + D.barW};${x + D.barW}" keyTimes="0;0.62;1" dur="2.6s" repeatCount="indefinite"/></rect></g>`,
    )
    x += D.barW + D.inner
  }
  if (r.figure) put((px, v) => ink(hue, px, v), r.figure)
  if (r.detail) {
    if (r.state !== 'idle') {
      parts.push(rule(x))
      x += 1 + D.inner
    }
    put(mute, r.detail)
  }
  const width = Math.max(1, Math.ceil(x - D.inner + 2))
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${D.h}" viewBox="0 0 ${width} ${D.h}" style="color-scheme:light dark;background:transparent">` +
    HEAD + parts.join('') + `</svg>`
  return { svg, width, height: D.h }
}

// ---- terminal: one row of spans in usage-band's style

export function rowSpans(r, columns = 100) {
  const hue = r.state === 'done' ? HUE.done : HUE.goal
  const spans = [{ text: '◎ ', color: r.state === 'idle' ? undefined : hue, dim: r.state === 'idle' }]
  spans.push(r.state === 'idle' ? { text: r.title, dim: true } : { text: r.title, color: hue })
  if (r.state === 'running') {
    const cells = columns >= 80 ? 10 : 6
    const filled = Math.max(r.fraction > 0 ? 1 : 0, Math.min(cells, Math.round(r.fraction * cells)))
    spans.push({ text: '  ' })
    for (let i = 0; i < filled; i++) {
      const shade = filled === 1 ? 0 : -0.15 + (0.35 * i) / (filled - 1)
      spans.push({ text: '■', color: lighten(hue, shade) })
    }
    if (cells > filled) spans.push({ text: '■'.repeat(cells - filled), color: TRACK })
  }
  if (r.figure) spans.push({ text: '  ' + r.figure, color: hue })
  if (r.detail) spans.push({ text: (r.state === 'idle' ? '  ' : ' · ') + r.detail, dim: true })
  return spans
}
