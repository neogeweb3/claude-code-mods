import { expect, mock, test } from 'claude-code/testing'

import { rowOf, rowSpans, rowSvg } from '../hooks/row.mjs'

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 140 } as never,
} as const

const goal = (over = {}) => ({
  title: '测试全绿并提交',
  status: 'running',
  startedAt: 0,
  planAt: 1,
  endedAt: 0,
  ...over,
})
const prog = { fraction: 0.5, doneN: 2, n: 4, pct: 50 }

test('with no goal the row is still there, idle, on terminal and desktop', async ($, on) => {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({ children: [] }))
  const term = await $.ui.mount({ plugin: 'goal-meter', surface: 'terminal', ...BAND })
  expect(await term.find({ type: 'Text', text: 'No goal' })).toBeDefined()
  await term.unmount()
  const desk = await $.ui.mount({ plugin: 'goal-meter', surface: 'desktop', ...BAND })
  const svg = await desk.find({ type: 'Svg' })
  expect(svg?.props.alt).toBe('No goal, /goal <what done looks like>')
  await desk.unmount()
})

test('the row stacks on top of what another mod drew, never replacing it', async ($, on) => {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Text({ children: ['5h 5%'] }))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'goal-meter', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: '5h 5%' })).toBeDefined()
    await ui.unmount()
  }
})

test('a running goal is one row: title, bar, done of total, ETA', async () => {
  const r = rowOf(goal(), prog, 8 * 60000, false)
  expect(r).toEqual({ state: 'running', title: '测试全绿并提交', fraction: 0.5, figure: '2/4 · 50%', detail: '~8m left' })
  const { svg, height } = rowSvg(r)
  expect(height).toBe(30)
  expect(svg).toContain('<animate')
  expect(svg).toContain('测试全绿并提交')
  expect(svg).toContain('2/4 · 50%')
  const spans = rowSpans(r, 120)
  expect(spans.map(s => s.text).join('')).toBe('◎ 测试全绿并提交  ■■■■■■■■■■  2/4 · 50% · ~8m left')
})

test('task sizes (S, M, L) never reach the row', async () => {
  const r = rowOf(goal(), prog, 0, false)
  const text = rowSpans(r).map(s => s.text).join('') + rowSvg(r).svg
  expect(/\b[SML]\b/.test(text.replace(/<[^>]+>/g, ' ').replace(/viewBox|xmlns/g, ''))).toBe(false)
})

test('planning, done and an old finished goal read as they should', async () => {
  expect(rowOf(goal({ planAt: 0 }), prog, 0, false).detail).toBe('planning…')
  expect(rowOf(goal({ status: 'met', endedAt: 12 * 60000 }), prog, 0, true)).toMatchObject({ state: 'done', figure: 'done ✓', detail: '12m' })
  expect(rowOf(goal({ status: 'met', endedAt: 1 }), prog, 0, false).state).toBe('idle')
})

test('collapsed to one row; the steps sit in a hover reveal under it, sizes left out', async ($, on) => {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({ children: [] }))
  on('tool.call', () => ({ result: 'engine' }))
  mock.clock(on)
  await $.tool.call({
    tool: 'mcp__goal-meter__tasks',
    action: 'plan',
    tasks: [{ title: '读代码', size: 'S' }, { title: '改样式', size: 'L' }],
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'goal-meter', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: '读代码' })).toBeDefined()
    const scope = await ui.find({ type: 'Box', key: 'goal-row' })
    expect(scope).toBeDefined()
    const hidden = JSON.stringify(scope)
    expect(hidden).toContain('"display":"none"')
    expect(hidden).toContain('"hover":{"display":"flex"}')
    expect(await ui.find({ type: 'Text', text: '读代码' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '改样式' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^S\b|^L\b/ })).toBeUndefined()
    await ui.unmount()
  }
})
