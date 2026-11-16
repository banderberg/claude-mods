import { expect, mock, test } from 'claude-code/testing'

const NOV = Date.UTC(2026, 10, 16, 12)
const month = (ms: number): string => {
  const date = new Date(ms)

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

test('a subscription shows its rate-limit windows and no cost', async ($, on) => {
  const lines: unknown[] = []
  mock.clock(on, { now: NOV })
  mock.store(on)
  on('session.model', () => ({ value: 'Fable 5.2' }))
  on('session.id', () => ({ value: 'a' }))
  on('session.usage', () => ({
    value: {
      startedAt: NOV,
      context: { window: 200000, percent: 12 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 23.4 },
        { kind: 'seven_day', percentUsed: 41 },
      ],
      cost: { usd: 3 },
    },
  }))
  on('ui.status', (_, e) => (lines.push(e), { value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect(JSON.stringify(lines.at(-1))).toContain('Fable 5.2 · 5h 23% · 7d 41% · ctx 12%')
})

test('with no windows it shows session cost and the month across sessions', async ($, on) => {
  const lines: unknown[] = []
  mock.clock(on, { now: NOV })
  mock.store(on, {
    'spend:other': { month: month(NOV), base: 1, usd: 9 },
    'spend:old': { month: '2026-10', base: 0, usd: 500 },
  })
  let usd = 1.5
  on('session.model', () => ({ value: 'Fable 5.2' }))
  on('session.id', () => ({ value: 'a' }))
  on('session.usage', () => ({
    value: { startedAt: NOV, context: { window: 200000, percent: 12 }, rateLimits: [], cost: { usd } },
  }))
  on('ui.status', (_, e) => (lines.push(e), { value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(JSON.stringify(lines.at(-1))).toContain('Fable 5.2 · $1.50 session · $11.50 month · ctx 12%')

  // The counter starting over (a /clear) keeps what was already spent.
  usd = 0.25
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(JSON.stringify(lines.at(-1))).toContain('$0.25 session · $11.75 month')
})
