import { expect, mock, test } from 'claude-code/testing'

import { SCALE, rowOf, rowSpans, rowSvg, textW } from '../hooks/row.mjs'

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

test('with no plan the row is still there, idle, and never hints at /goal', async ($, on) => {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({ children: [] }))
  const term = await $.ui.mount({ plugin: 'goal-meter', surface: 'terminal', ...BAND })
  expect(await term.find({ type: 'Text', text: '空闲' })).toBeDefined()
  expect(JSON.stringify(await term.find({ type: 'Box' }))).not.toContain('/goal')
  await term.unmount()
  const desk = await $.ui.mount({ plugin: 'goal-meter', surface: 'desktop', ...BAND })
  const svg = await desk.find({ type: 'Svg' })
  expect(svg?.props.alt).toBe('空闲')
  expect(String(svg?.props.source)).not.toContain('/goal')
  await desk.unmount()
})

test('a task with no plan yet reads "working" while the turn runs, idle again after', async ($, on) => {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({ children: [] }))
  on('tool.call', () => ({ result: 'engine' }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  mock.clock(on)
  const row = async () => {
    const ui = await $.ui.mount({ plugin: 'goal-meter', surface: 'terminal', ...BAND })
    const text = JSON.stringify(await ui.find({ type: 'Box', key: 'goal-row' }) ?? await ui.find({ type: 'Box' }))
    await ui.unmount()
    return text
  }
  await $.turn.start({ text: '修一下这个 bug', turnId: 't1' })
  expect(await row()).toContain('工作中')
  await $.tool.call({ tool: 'Read', file_path: '/a' } as never)
  await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
  expect(await row()).toContain('2 个操作')
  await $.turn.complete({ reason: 'answer', answer: '', durationMs: 1, isAborted: false, turnId: 't1' })
  const after = await row()
  expect(after).toContain('空闲')
  expect(after).not.toContain('工作中')
})

test('a turn a few tools deep with no plan gets one hidden reminder to plan, once', async ($, on) => {
  on('tool.call', () => ({ result: 'engine' }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  mock.clock(on)
  const call = () => $.tool.call({ tool: 'Bash', command: 'ls' } as never) as Promise<{ context?: readonly string[] }>
  await $.turn.start({ text: '继续', turnId: 't1' })
  expect((await call()).context).toBeUndefined()
  expect((await call()).context).toBeUndefined()
  const third = await call()
  expect(third.context?.[0]).toContain('mcp__goal-meter__tasks')
  expect(third.context?.[0]).toContain('"plan"')
  expect((await call()).context).toBeUndefined()
  // a new turn may be reminded again
  await $.turn.complete({ reason: 'answer', answer: '', durationMs: 1, isAborted: false, turnId: 't1' })
  await $.turn.start({ text: '再来', turnId: 't2' })
  await call(); await call()
  expect((await call()).context).toHaveLength(1)
})

test('no reminder once a plan is running', async ($, on) => {
  on('tool.call', () => ({ result: 'engine' }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  mock.clock(on)
  await $.turn.start({ text: '做个功能', turnId: 't1' })
  await $.tool.call({ tool: 'mcp__goal-meter__tasks', action: 'plan', goal: '做个功能', tasks: [{ title: '写', size: 'M' }] })
  for (let i = 0; i < 5; i++) {
    const r = (await $.tool.call({ tool: 'Bash', command: 'ls' } as never)) as { context?: readonly string[] }
    expect(r.context).toBeUndefined()
  }
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
  expect(r).toEqual({ state: 'running', title: '测试全绿并提交', fraction: 0.5, figure: '2/4 · 50%', detail: '剩约 8m' })
  const { svg, height } = rowSvg(r)
  // drawn larger than usage-band's 30px row: the type comes out about 15px
  expect(height).toBe(Math.ceil(30 * SCALE))
  expect(svg).toContain('viewBox="0 0 ')
  expect(svg).toContain('<animate')
  // a rainbow, flowing along the bar, on the title and the bar fill; no rose left
  expect(svg).toContain('fill="url(#rb-title)"')
  expect(svg).toContain('fill="url(#rb-bar)"')
  expect(svg).toContain('animateTransform')
  expect(svg).not.toContain('e58fb6')
  expect(svg).toContain('测试全绿并提交')
  expect(svg).toContain('2/4 · 50%')
  const spans = rowSpans(r, 120)
  expect(spans.map(s => s.text).join('')).toBe('◎ 测试全绿并提交  ■■■■■■■■■■  2/4 · 50% · 剩约 8m')
})

test('task sizes (S, M, L) never reach the row', async () => {
  const r = rowOf(goal(), prog, 0, false)
  const text = rowSpans(r).map(s => s.text).join('') + rowSvg(r).svg
  expect(/\b[SML]\b/.test(text.replace(/<[^>]+>/g, ' ').replace(/viewBox|xmlns/g, ''))).toBe(false)
})

test('planning, done and an old finished goal read as they should', async () => {
  expect(rowOf(goal({ planAt: 0 }), prog, 0, false).detail).toBe('列步骤中…')
  expect(rowOf(goal({ status: 'met', endedAt: 12 * 60000 }), prog, 0, true)).toMatchObject({ state: 'done', figure: '完成 ✓', detail: '12m' })
  // a new task after one finished reads working, not the old plan's done
  expect(rowOf(goal({ status: 'met', endedAt: 1 }), prog, 0, true, { calls: 1 }).state).toBe('working')
  expect(rowOf(goal({ status: 'met', endedAt: 1 }), prog, 0, false).state).toBe('idle')
})

test('collapsed to one row; the steps float in a hover card that moves nothing, sizes left out', async ($, on) => {
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
    const scope = await ui.find({ type: 'Box', key: 'goal-row' })
    expect(scope).toBeDefined()
    const hidden = JSON.stringify(scope)
    expect(hidden).toContain('"display":"none"')
    expect(hidden).toContain('"position":"absolute"')
    // centred over the row, as if it grew out of it: on the desktop the card hangs off the
    // centred row at its full width; in the terminal a full-width strip centres it
    if (surface === 'terminal') {
      expect(hidden).toContain('"width":"100%"')
      expect(hidden).toContain('"justifyContent":"center"')
      expect(await ui.find({ type: 'Text', text: '读代码' })).toBeDefined()
    } else {
      // the card is an image exactly as wide as the row image, at its left edge
      const imgs = await ui.findAll({ type: 'Svg' })
      expect(imgs).toHaveLength(2)
      expect(imgs[1]!.props.width).toBe(imgs[0]!.props.width)
      expect(String(imgs[1]!.props.source)).toContain('改样式')
    }
    expect(await ui.find({ type: 'Text', text: /^S\b|^L\b/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('Latin text is measured narrow enough not to be stretched apart', async () => {
  // 'No goal' in Inter 13px is about 50px wide; the old flat guess gave 56+ and spread the letters
  expect(textW('No goal')).toBeLessThan(54)
  expect(textW('在 /tmp')).toBeGreaterThan(textW('a /tmp'))
})

test('on by default: the system prompt asks Claude to plan multi-step work, once, stably', async ($, on) => {
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'engine', scope: 'shared' as const }] }))
  const input = { model: 'm', promptModel: 'm', surfaces: [], tools: ['Bash', 'mcp__goal-meter__tasks'], outputStyle: null, traits: [] }
  const a = await $.prompt.compose(input as never)
  const mine = a.sections.find(s => s.id === 'goal-meter:auto-plan')
  expect(mine?.scope).toBe('session')
  expect(mine?.text).toContain('mcp__goal-meter__tasks')
  expect(mine?.text).toContain('"plan"')
  // the same text every render, so the prompt cache holds
  const b = await $.prompt.compose(input as never)
  expect(b.sections.find(s => s.id === 'goal-meter:auto-plan')?.text).toBe(mine?.text)
  // nothing added where the tool is not offered
  const c = await $.prompt.compose({ ...input, tools: ['Bash'] } as never)
  expect(c.sections.map(s => s.id)).toEqual(['intro'])
})

test('a plan without /goal shows under the name Claude gave; a new name starts a new plan', async ($, on) => {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({ children: [] }))
  on('tool.call', () => ({ result: 'engine' }))
  mock.clock(on)
  const plan = (goal: string, titles: string[]) =>
    $.tool.call({ tool: 'mcp__goal-meter__tasks', action: 'plan', goal, tasks: titles.map(title => ({ title, size: 'M' })) })
  await plan('整理周报', ['收数据', '写结论'])
  let ui = await $.ui.mount({ plugin: 'goal-meter', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: '整理周报' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /0\/2/ })).toBeDefined()
  await ui.unmount()
  await plan('修登录 bug', ['复现', '修', '验证'])
  ui = await $.ui.mount({ plugin: 'goal-meter', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: '修登录 bug' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /0\/3/ })).toBeDefined()
  await ui.unmount()
})
