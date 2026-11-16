import { expect, mock, test } from 'claude-code/testing'

import type { On } from 'claude-code'

const world = (on: On, usage: unknown, account: unknown): unknown[] => {
  const lines: unknown[] = []
  mock.clock(on, { now: 1_000_000 })
  on('session.model', () => ({ value: 'Fable 5.2' }))
  on('session.usage', () => ({ value: usage }))
  on('session.authorize', () => ({ value: { handle: 'h', kind: 'bearer' } }))
  on('http.fetch', () =>
    account === undefined
      ? { value: { status: 500, ok: false, headers: {}, text: '' } }
      : { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(account) } },
  )
  on('ui.status', (_, e) => (lines.push(e), { value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

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
