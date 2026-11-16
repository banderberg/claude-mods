import { expect, mock, test } from 'claude-code/testing'

import type { On } from 'claude-code'

const world = (on: On, usage: unknown, account: unknown): unknown[] => {
  const lines: unknown[] = []
  mock.clock(on, { now: 1_000_000 })
  on('session.model', () => ({ value: 'Fable 5.2' }))
  on('session.usage', () => ({ value: usage as never }))
  on('session.authorize', () => ({ value: { handle: 'h', kind: 'bearer' } }))
  on('http.fetch', () =>
    account === undefined
      ? { value: { status: 500, ok: false, headers: {}, text: '' } }
      : { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(account) } },
  )
  on('ui.status', (_, e) => (lines.push(e), { value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.list', () => ({ value: [{ id: 'a1', description: 'look', type: 'Explore', status: 'running' }] }))

  return lines
}

const START = { cwd: '/', surface: 'terminal', isInteractive: true } as const
const CONTEXT = { window: 200000, percent: 12 }

test('the engine windows are shown, and a disabled spend limit is not', async ($, on) => {
  const lines = world(
    on,
    {
      startedAt: 0,
      context: CONTEXT,
      rateLimits: [
        { kind: 'five_hour', percentUsed: 23.4 },
        { kind: 'seven_day', percentUsed: 41 },
      ],
    },
    { spend: { enabled: false, limit: null, percent: 0 }, extra_usage: { is_enabled: false } },
  )

  await $.session.start(START)

  expect(JSON.stringify(lines.at(-1))).toContain('Fable 5.2 · 5h 23% · 7d 41% · ctx 12%')
})

test('a plan with a spend limit shows the share used', async ($, on) => {
  const lines = world(
    on,
    { startedAt: 0, context: CONTEXT, rateLimits: [] },
    {
      five_hour: null,
      seven_day: null,
      spend: { enabled: true, limit: { amount_minor: 50000 }, percent: 37.2 },
    },
  )

  await $.session.start(START)

  expect(JSON.stringify(lines.at(-1))).toContain('Fable 5.2 · spend 37% · ctx 12%')
})

test('the account windows fill in before the engine has a reading', async ($, on) => {
  const lines = world(
    on,
    { startedAt: 0, context: { window: 200000 }, rateLimits: [] },
    { five_hour: { utilization: 4 }, seven_day: { utilization: 13 }, spend: { enabled: false } },
  )

  await $.session.start(START)

  expect(JSON.stringify(lines.at(-1))).toContain('Fable 5.2 · 5h 4% · 7d 13%')
})

test('a failed usage request leaves the model and context', async ($, on) => {
  const lines = world(on, { startedAt: 0, context: CONTEXT, rateLimits: [] }, undefined)

  await $.session.start(START)

  expect(JSON.stringify(lines.at(-1))).toContain('Fable 5.2 · ctx 12%')
})

const BAND = {
  plugin: 'model-usage-status',
  component: 'AbovePrompt',
  surface: 'terminal',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: true,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 9 },
  },
} as const

const reply = (model: string, tokens: number) => ({
  turnId: 't',
  index: 0,
  answer: '',
  toolUses: [],
  stopReason: 'end_turn' as const,
  usage: {
    model,
    input_tokens: tokens,
    output_tokens: 1,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  },
})

test('viewing a subagent shows its model and context, and main again after', async ($, on) => {
  const lines = world(
    on,
    { startedAt: 0, context: CONTEXT, rateLimits: [{ kind: 'five_hour', percentUsed: 23 }] },
    {},
  )
  on('turn.step', async function* (_, e) {
    return e.agentId === undefined ? reply('claude-fable-5-2', 24000) : reply('claude-haiku-5-5', 45200)
  })

  await $.session.start(START)

  for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'x', messageCount: 1 })) {
    // drain
  }

  for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'x', messageCount: 1, agentId: 'a1' })) {
    // drain
  }

  const inAgent = await $.ui.mount({ ...BAND, props: { ...BAND.props, view: { agentId: 'a1' } } })
  expect(JSON.stringify(lines.at(-1))).toContain('Explore: Haiku 5.5 · 5h 23% · ctx 45k')
  await inAgent.unmount()

  const inMain = await $.ui.mount({ ...BAND, props: { ...BAND.props, view: {} } })
  expect(JSON.stringify(lines.at(-1))).toContain('Fable 5.2 · 5h 23% · ctx 12%')
  await inMain.unmount()
})
