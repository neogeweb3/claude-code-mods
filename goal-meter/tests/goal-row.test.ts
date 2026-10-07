import { expect, mock, test } from 'claude-code/testing'

import { CARD, SCALE, rowOf, rowSpans, rowSvg, stepsSvg, textW } from '../hooks/row.mjs'

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
  mock.clock(on)
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
  mock.clock(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'goal-meter', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: '5h 5%' })).toBeDefined()
    // and the goal row is really there too, above it
    expect(await ui.find({ type: 'Box', key: 'goal-row' }) ?? await ui.find({ type: 'Text', text: '空闲' })).toBeDefined()
    await ui.unmount()
  }
})

test('a running goal is one row: title, bar, done of total, ETA', async () => {
  const r = rowOf(goal(), prog, 8 * 60000, false)
  expect(r).toEqual({ state: 'running', title: '测试全绿并提交', step: '', fraction: 0.5, figure: '2/4 · 50%', detail: '剩约 8m' })
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
  expect(rowOf(goal({ status: 'met', endedAt: 12 * 60000 }), prog, 0, true)).toMatchObject({ state: 'done', figure: '完成 ✓', detail: '用时 12m' })
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
      // the card keeps within the desktop's frame (never scaled down) and is centred by the
      // column's alignItems, not pinned to the row's left edge
      const imgs = await ui.findAll({ type: 'Svg' })
      expect(imgs).toHaveLength(2)
      expect(imgs[1]!.props.width).toBeLessThanOrEqual(CARD.max)
      expect(String(imgs[1]!.props.source)).toContain('改样式')
      expect(hidden).toContain('"alignItems":"center"')
      expect(hidden).not.toContain('"left":0')
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

test('the row names the step under way, else the next one, so nobody has to hover', async ($, on) => {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({ children: [] }))
  on('tool.call', () => ({ result: 'engine' }))
  mock.clock(on)
  const tasks = (action: string, extra = {}) => $.tool.call({ tool: 'mcp__goal-meter__tasks', action, ...extra } as never)
  await tasks('plan', { goal: '美化进度行', tasks: [{ title: '显示当前步骤', size: 'M' }, { title: '完成动画', size: 'M' }] })
  const row = async (surface: 'terminal' | 'desktop') => {
    const ui = await $.ui.mount({ plugin: 'goal-meter', surface, ...BAND })
    const imgs = surface === 'desktop' ? await ui.findAll({ type: 'Svg' }) : []
    const text = surface === 'desktop' ? String(imgs[0]!.props.source) + imgs[0]!.props.alt : JSON.stringify(await ui.find({ type: 'Box', key: 'goal-row' }))
    await ui.unmount()
    return text
  }
  // nothing started yet: the next step up
  expect(await row('terminal')).toContain('显示当前步骤')
  await tasks('start', { id: 1 })
  expect(await row('terminal')).toContain('▶ ')
  expect(await row('desktop')).toContain('正在：显示当前步骤')
  await tasks('done', { id: 1 })
  const after = await row('desktop')
  expect(after).toContain('完成动画')
  expect(after).not.toContain('正在：显示当前步骤')
})

test('a plan just finished sweeps a rainbow over a full bar, then settles green', async () => {
  const done = (celebrate: boolean) => rowSvg(rowOf(goal({ status: 'met', endedAt: 5 * 60000, celebrate }), prog, 0, true)).svg
  const party = done(true)
  expect(party).toContain('fill="url(#rb-bar)"')
  expect(party).toContain('attributeName="opacity" values="1;1;0"')
  expect(party).toContain('fill="freeze"')
  const calm = done(false)
  expect(calm).not.toContain('rb-bar')
  expect(calm).not.toContain('<animate')
  // the full bar is drawn in both
  expect(calm).toContain('class="track"')
  expect(rowOf(goal({ status: 'met', endedAt: 5 * 60000 }), prog, 0, true).detail).toBe('用时 5m')
})

test('a finished plan celebrates only in the first seconds after it ends', async ($, on) => {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({ children: [] }))
  on('tool.call', () => ({ result: 'engine' }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  const clock = mock.clock(on)
  const svg = async () => {
    const ui = await $.ui.mount({ plugin: 'goal-meter', surface: 'desktop', ...BAND })
    const s = String((await ui.find({ type: 'Svg' }))!.props.source)
    await ui.unmount()
    return s
  }
  await clock.advance(60000) // the mock clock starts at 0, which reads as "never ended"
  await $.turn.start({ text: '做', turnId: 't1' })
  await $.tool.call({ tool: 'mcp__goal-meter__tasks', action: 'plan', goal: '小活', tasks: [{ title: '一步', size: 'S' }] } as never)
  await $.tool.call({ tool: 'mcp__goal-meter__tasks', action: 'done', id: 1 } as never)
  await $.turn.complete({ reason: 'answer', answer: '', durationMs: 1, isAborted: false, turnId: 't1' })
  expect(await svg()).toContain('rb-bar')
  await clock.advance(20000)
  expect(await svg()).not.toContain('rb-bar')
})

test('the row is drawn at usage-band\'s size; the card at its own larger type, never past the frame', async () => {
  expect(SCALE).toBe(1)
  expect(rowSvg(rowOf(goal(), prog, 0, false)).height).toBe(30)
  const long = '这是一个非常非常长的步骤名字，长到一行放不下还要再长一点'
  const card = stepsSvg([{ status: 'active', title: long, tail: '进行中 2m' }, { status: 'pending', title: '短', tail: '' }])
  expect(card.width).toBe(CARD.max)
  expect(card.svg).toContain('font-size="14"')
  expect(card.svg).toContain('…')
  // a short card is narrow, not padded out to the row's width
  expect(stepsSvg([{ status: 'pending', title: '短', tail: '' }]).width).toBe(CARD.min)
  // no margin of its own: the first mark sits at the card's edge
  expect(card.svg).toContain(`x="${CARD.pad}"`)
})

test('every finished step shows a time, even one marked done without a start', async ($, on) => {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({ children: [] }))
  on('tool.call', () => ({ result: 'engine' }))
  const clock = mock.clock(on)
  const tasks = (action: string, extra = {}) => $.tool.call({ tool: 'mcp__goal-meter__tasks', action, ...extra } as never)
  await clock.advance(60000)
  await tasks('plan', { goal: '计时', tasks: [{ title: '甲', size: 'S' }, { title: '乙', size: 'S' }, { title: '丙', size: 'S' }] })
  await clock.advance(3 * 60000)
  await tasks('done', { id: 1 }) // never started: timed from the plan's start
  await clock.advance(10000)
  await tasks('done', { ids: [2, 3] }) // a batch: the second had no time of its own
  const ui = await $.ui.mount({ plugin: 'goal-meter', surface: 'desktop', ...BAND })
  const card = String((await ui.findAll({ type: 'Svg' }))[1]!.props.source)
  await ui.unmount()
  const tails = [...card.matchAll(/text-anchor="end" class="mute">([^<]*)</g)].map(m => m[1])
  expect(tails).toEqual(['3m00s', '10s', '0s'])
})

test('with no plan, hovering lists the turn\'s latest operations with their times', async ($, on) => {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({ children: [] }))
  on('tool.call', () => ({ result: 'engine' }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  const clock = mock.clock(on)
  const card = async (surface: 'desktop' | 'terminal') => {
    const ui = await $.ui.mount({ plugin: 'goal-meter', surface, ...BAND })
    const out = surface === 'desktop'
      ? String((await ui.findAll({ type: 'Svg' }))[1]?.props.source ?? '')
      : JSON.stringify(await ui.find({ type: 'Box', key: 'goal-row' }) ?? null)
    await ui.unmount()
    return out
  }
  await clock.advance(60000)
  await $.turn.start({ text: '/handoff', turnId: 't1' })
  await $.tool.call({ tool: 'Bash', command: 'git log', description: 'Measuring journal loss' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/Users/nge/mods/HANDOFF.md' } as never)
  await $.tool.call({ tool: 'mcp__goal-meter__tasks', action: 'show' } as never) // the mod's own call is not an operation
  const desk = await card('desktop')
  expect(desk).toContain('Measuring journal loss')
  expect(desk).toContain('读 HANDOFF.md')
  expect(desk).not.toContain('tasks')
  expect(desk).toMatch(/\d+s</)
  expect(await card('terminal')).toContain('读 HANDOFF.md')
  // still there to look back on once the turn ends; a new turn starts a fresh list
  await $.turn.complete({ reason: 'answer', answer: '', durationMs: 1, isAborted: false, turnId: 't1' })
  expect(await card('desktop')).toContain('读 HANDOFF.md')
  await $.turn.start({ text: '下一个', turnId: 't2' })
  expect(await card('desktop')).not.toContain('读 HANDOFF.md')
})
