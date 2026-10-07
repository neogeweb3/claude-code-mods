// The goal row above the prompt: one line, always there, drawn the way usage-band draws its
// band so the two read as one family. Pure functions: no mods API calls, so tests drive them.
//
// Desktop and mobile get one SVG drawn as a plain image (an image redraws in place; a framed SVG
// blinks on every redraw), with usage-band's type, rounded bar and shine. The terminal gets one
// row of spans with usage-band's ■ bar.

import { minutes, clip } from './fmt.mjs'

// usage-band's hues are cyan, amber, indigo and green; the goal takes a rainbow, green when done.
// HUE.goal stays for the terminal's lone accents; the desktop draws the gradient below.
export const HUE = { goal: '#b197fc', done: '#72cf9f' }
const TRACK = '#4a4f5c'
// Light-mode stops, then dark-mode ones; the first repeats last so a flowing bar loops seamlessly
export const RAINBOW = ['#e03131', '#f76707', '#e67700', '#2f9e44', '#1c7ed6', '#7048e8', '#c2255c', '#e03131']
const RAINBOW_DARK = ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#4dabf7', '#9775fa', '#f783ac', '#ff6b6b']
// The row draws 1:1, the same 13px as usage-band's band (Neo, 2026-10-06: 1.18x read larger than
// the band). The steps card has its own larger type instead, see CARD.
export const SCALE = 1
const scaled = (v) => Math.ceil(v * SCALE)

// A rainbow running from x1 to x2 in the image's own units; `flow` slides it along forever
const rainbow = (id, x1, x2, flow = false) =>
  `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${x1}" x2="${x2}" y1="0" y2="0" spreadMethod="repeat">` +
  RAINBOW.map((_, i) => `<stop offset="${(i / (RAINBOW.length - 1)).toFixed(3)}" class="r${i}"/>`).join('') +
  (flow ? `<animateTransform attributeName="gradientTransform" type="translate" from="0 0" to="${x2 - x1} 0" dur="6s" repeatCount="indefinite"/>` : '') +
  `</linearGradient>`
const RAINBOW_CSS =
  RAINBOW.map((c, i) => `.r${i}{stop-color:${c}}`).join('') +
  `@media (prefers-color-scheme:dark){${RAINBOW_DARK.map((c, i) => `.r${i}{stop-color:${c}}`).join('')}}`

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
 * The row's parts. With no plan running it reads 'working' while Claude is on a turn (`work`,
 * the turn's tool calls so far) and 'idle' otherwise: no /goal hint, the plan is Claude's to make.
 * state: 'idle' | 'working' | 'planning' | 'running' | 'done' | 'stopped'
 */
export function rowOf(g, p, etaMs, isRecent, work = null) {
  const running = g && g.status === 'running'
  if (!running && work) return { state: 'working', title: '工作中', detail: work.calls ? `${work.calls} 个操作` : '' }
  if (!g || !(running || isRecent)) return { state: 'idle', title: '空闲' }
  const title = clip(g.title, 40)
  // done: a full bar; for its first seconds (`celebrate`) a rainbow sweeps it, then it settles green
  if (g.status === 'met') return { state: 'done', title, fraction: 1, celebrate: !!g.celebrate, figure: '完成 ✓', detail: `用时 ${minutes((g.endedAt || 0) - g.startedAt)}` }
  if (g.status !== 'running') return { state: 'stopped', title, figure: '已停止' }
  if (!g.planned && !g.planAt) return { state: 'planning', title, detail: '列步骤中…' }
  return {
    state: 'running',
    title: clip(g.title, g.step ? 16 : 40),
    // the step under way, named in the row so nobody has to hover to see it
    step: g.step ? clip(g.step, 14) : '',
    fraction: p.fraction,
    figure: `${p.doneN}/${p.n} · ${p.pct}%`,
    detail: etaMs ? `剩约 ${minutes(etaMs)}` : '',
  }
}

export function describe(r) {
  return [r.state === 'idle' || r.state === 'working' ? r.title : `任务：${r.title}`, r.figure, r.step && `正在：${r.step}`, r.detail].filter(Boolean).join('，')
}

// ---- desktop: one SVG in usage-band's style

const CAP = { top: 9.75, h: 10 }
const D = { h: 30, inner: 7, size: 13, barW: 120, barH: 6, icon: 10 }
// Advance widths in em for Inter (SF Pro, the fallback, runs within a few %): measured classes,
// not one flat guess, so Latin text is not stretched apart; wide CJK and symbols take a full em
const NARROW = new Set([...'iljtf.,:;!|\'()[]/ '])
const WIDE = new Set([...'mwMW@%'])
export const textW = (v, size = D.size) =>
  [...v].reduce((w, c) => {
    if (c.codePointAt(0) >= 0x2e80) return w + 1
    if (c >= '0' && c <= '9') return w + 0.62
    if (c === ' ') return w + 0.26
    if (NARROW.has(c)) return w + 0.3
    if (WIDE.has(c)) return w + 0.86
    if (c === '·' || c === '~' || c === '<' || c === '>') return w + 0.55
    if (c === '✓') return w + 0.7
    if (c >= 'A' && c <= 'Z') return w + 0.66
    return w + 0.54
  }, 0) * size

const pinW = (v) => `textLength="${textW(v).toFixed(1)}" lengthAdjust="spacing"`
const ink = (hue, x, v) =>
  `<text x="${x}" y="19.5" font-size="${D.size}" ${pinW(v)} class="ink" style="--l:${lighten(hue, -0.38)};--d:${lighten(hue, 0.25)}">${esc(v)}</text>`
const mute = (x, v) => `<text x="${x}" y="19.5" font-size="${D.size}" ${pinW(v)} class="mute">${esc(v)}</text>`
const paint = (id, x, v, size = D.size, y = 19.5) =>
  `<text x="${x}" y="${y}" font-size="${size}" ${pinW(v)} fill="url(#${id})" font-weight="600">${esc(v)}</text>`
const fig = (x, v) => `<text x="${x}" y="19.5" font-size="${D.size}" ${pinW(v)} class="fig">${esc(v)}</text>`
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
  `.ink{fill:var(--l)}.mute{fill:#8b8f97;font-weight:400}.rule{fill:#000;fill-opacity:.1}.fig{fill:#2b2f36}` +
  `@media (prefers-color-scheme:dark){.ink{fill:var(--d)}.mute{fill:#9aa0a8}.rule{fill:#fff;fill-opacity:.13}.fig{fill:#eef0f3}}` +
  RAINBOW_CSS +
  `</style>` +
  `<defs><linearGradient id="shine" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/>` +
  `<stop offset=".5" stop-color="#fff" stop-opacity=".8"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>`

export function rowSvg(r) {
  const done = r.state === 'done'
  const lit = r.state !== 'idle'
  const defs = []
  const parts = []
  if (lit && !done) defs.push(rainbow('rb-icon', 1, 11))
  parts.push(`<g transform="translate(1 ${CAP.top})">${icon(!lit ? '#8b8f97' : done ? lighten(HUE.done, -0.15) : 'url(#rb-icon)')}</g>`)
  let x = 1 + D.icon + 6
  const put = (draw, v, gap = D.inner) => {
    parts.push(draw(x, v))
    x += textW(v) + gap
  }
  if (!lit) put(mute, r.title)
  else if (done) put((px, v) => ink(HUE.done, px, v), r.title)
  else {
    defs.push(rainbow('rb-title', x, x + textW(r.title)))
    put((px, v) => paint('rb-title', px, v), r.title)
  }
  if (r.state === 'running' || done) {
    const y = (D.h - D.barH) / 2
    const rad = D.barH / 2
    const fillW = Math.max(r.fraction > 0 ? D.barH : 0, Math.min(D.barW, D.barW * r.fraction))
    const shine = (times) =>
      `<g clip-path="url(#c-goal)"><rect y="${y}" width="18" height="${D.barH}" fill="url(#shine)">` +
      `<animate attributeName="x" values="${x - 18};${x + D.barW};${x + D.barW}" keyTimes="0;0.62;1" dur="${times ? '1.3s' : '2.6s'}" repeatCount="${times || 'indefinite'}" fill="freeze"/></rect></g>`
    defs.push(`<clipPath id="c-goal"><rect x="${x}" y="${y}" width="${fillW}" height="${D.barH}" rx="${rad}"/></clipPath>`)
    parts.push(`<rect x="${x}" y="${y}" width="${D.barW}" height="${D.barH}" rx="${rad}" class="track" style="--h:${done ? HUE.done : '#9775fa'}"/>`)
    if (done) {
      parts.push(`<rect x="${x}" y="${y}" width="${fillW}" height="${D.barH}" rx="${rad}" fill="${lighten(HUE.done, -0.12)}"/>`)
      if (r.celebrate) {
        defs.push(rainbow('rb-bar', x, x + D.barW, true))
        parts.push(
          `<rect x="${x}" y="${y}" width="${fillW}" height="${D.barH}" rx="${rad}" fill="url(#rb-bar)">` +
            `<animate attributeName="opacity" values="1;1;0" keyTimes="0;0.7;1" dur="3.2s" fill="freeze"/></rect>`,
          shine(2),
        )
      }
    } else {
      defs.push(rainbow('rb-bar', x, x + D.barW, true))
      parts.push(`<rect x="${x}" y="${y}" width="${fillW}" height="${D.barH}" rx="${rad}" fill="url(#rb-bar)"/>`, shine(0))
    }
    x += D.barW + D.inner
  }
  if (r.figure) put(done ? (px, v) => ink(HUE.done, px, v) : fig, r.figure)
  if (r.step) {
    parts.push(rule(x))
    x += 1 + D.inner
    put((px, v) => `<text x="${px}" y="19.5" font-size="${D.size}" ${pinW(v)} class="ink" style="--l:${RAINBOW[6]};--d:${RAINBOW_DARK[6]}">${v}</text>`, '▶', 5)
    put(fig, r.step)
  }
  if (r.detail) {
    if (lit) {
      parts.push(rule(x))
      x += 1 + D.inner
    }
    put(mute, r.detail)
  }
  const base = Math.max(1, Math.ceil(x - D.inner + 2))
  const width = scaled(base)
  const height = scaled(D.h)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${base} ${D.h}" style="color-scheme:light dark;background:transparent">` +
    HEAD + (defs.length ? `<defs>${defs.join('')}</defs>` : '') + parts.join('') + `</svg>`
  return { svg, width, height, base }
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
      // each cell its own colour of the rainbow, by where it sits on the full bar
      const color = r.state === 'done' ? hue : RAINBOW_DARK[Math.min(RAINBOW_DARK.length - 2, Math.floor((i / cells) * (RAINBOW_DARK.length - 1)))]
      spans.push({ text: '■', color })
    }
    if (cells > filled) spans.push({ text: '■'.repeat(cells - filled), color: TRACK })
  }
  if (r.figure) spans.push({ text: '  ' + r.figure, color: hue })
  if (r.step) spans.push({ text: ' · ▶ ', color: RAINBOW_DARK[6] }, { text: r.step })
  if (r.detail) spans.push({ text: (r.state === 'idle' ? '  ' : ' · ') + r.detail, dim: true })
  return spans
}

// ---- desktop: the steps card, one SVG exactly as wide as the row it floats over, so its middle
// is always the row's middle (the row is centred in the band) and it never shifts sideways

// The desktop draws the card in a frame of its own: about 24px of padding round the image and no
// wider than about 431px, an image wider than the room left scaled down to fit (three screenshots,
// 2026-10-06). So the card stays within CARD.max and keeps no margin of its own.
const STEP = { h: 23, top: 1, size: 14 }
export const CARD = { min: 220, max: 380, pad: 2 }
const MARK = { done: '✓', active: '▶', pending: '○' }

// Cut text to fit `room` px, by the same measure the row uses
export const fit = (v, room, size) => {
  if (textW(v, size) <= room) return v
  const chars = [...v]
  while (chars.length && textW(chars.join('') + '…', size) > room) chars.pop()
  return chars.join('') + '…'
}

export function stepsSvg(steps) {
  const tails = steps.map((t) => (t.tail ? textW(t.tail, STEP.size) + 12 : 0))
  const want = Math.max(...steps.map((t, i) => 18 + textW(t.title, STEP.size) + tails[i]), 0) + CARD.pad * 2
  const width = Math.round(Math.min(CARD.max, Math.max(CARD.min, want)))
  const h = STEP.top * 2 + steps.length * STEP.h - 4
  const defs = []
  const rows = steps.map((s, i) => {
    const y = STEP.top + i * STEP.h + 15
    const hue = s.status === 'done' ? HUE.done : s.status === 'active' ? '#f783ac' : null
    const mark = MARK[s.status] || '○'
    const tail = s.tail ? s.tail : ''
    const x0 = CARD.pad
    const tx = x0 + 18
    const title = fit(s.title, width - tx - CARD.pad - tails[i], STEP.size)
    const markSvg = hue
      ? `<text x="${x0}" y="${y}" font-size="${STEP.size}" class="ink" style="--l:${lighten(hue, -0.38)};--d:${lighten(hue, 0.25)}">${mark}</text>`
      : `<text x="${x0}" y="${y}" font-size="${STEP.size}" class="mute">${mark}</text>`
    if (s.status === 'active') defs.push(rainbow(`rb-step${i}`, tx, tx + textW(title, STEP.size)))
    const titleSvg = s.status === 'active'
      ? `<text x="${tx}" y="${y}" font-size="${STEP.size}" font-weight="600" fill="url(#rb-step${i})">${esc(title)}</text>`
      : `<text x="${tx}" y="${y}" font-size="${STEP.size}" class="${s.status === 'pending' ? 'fig' : 'mute'}">${esc(title)}</text>`
    const tailSvg = tail ? `<text x="${width - CARD.pad}" y="${y}" font-size="${STEP.size}" text-anchor="end" class="mute">${esc(tail)}</text>` : ''
    return markSvg + titleSvg + tailSvg
  })
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}" style="color-scheme:light dark;background:transparent">` +
    HEAD + (defs.length ? `<defs>${defs.join('')}</defs>` : '') + rows.join('') + `</svg>`
  return { svg, width, height: h }
}
