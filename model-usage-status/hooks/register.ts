import type { EngineInterface, Register } from 'claude-code'

const LABELS: Record<string, string> = {
  five_hour: '5h',
  seven_day: '7d',
  spend_limit: 'spend',
}

// One store entry per session, so sessions running side by side never write
// the same key. `base` holds what the session cost before its counter last
// started over (a /clear), `usd` the counter's latest reading.
type Spend = { month: string; base: number; usd: number }

const KEY_PREFIX = 'spend:'
const OTHERS_MAX_AGE_MS = 5 * 60 * 1000

const monthOf = (ms: number): string => {
  const date = new Date(ms)

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

const asSpend = (value: unknown): Spend | undefined => {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }

  const { month, base, usd } = value as Record<string, unknown>

  return typeof month === 'string' && typeof base === 'number' && typeof usd === 'number'
    ? { month, base, usd }
    : undefined
}

const dollars = (usd: number): string => `$${usd.toFixed(2)}`

// What this month's other sessions on this machine cost, re-read from the
// store every few minutes; this session's own share is added live.
let others: { month: string; usd: number; readAt: number } | undefined

const readOthers = async ($: EngineInterface, ownKey: string, month: string, now: number) => {
  let usd = 0

  for (const key of await $.store.keys()) {
    if (!key.startsWith(KEY_PREFIX) || key === ownKey) {
      continue
    }

    const spend = asSpend(await $.store.get(key))

    if (spend === undefined || spend.month < month) {
      // Malformed, or an earlier month's: no longer shown.
      await $.store.delete(key)
    } else if (spend.month === month) {
      usd += spend.base + spend.usd
    }
  }

  others = { month, usd, readAt: now }

  return usd
}

/** Records this session's cost and returns the month's total on this machine. */
const trackMonth = async ($: EngineInterface, sessionUsd: number): Promise<number> => {
  const [id, now] = await Promise.all([$.session.id(), $.clock.now()])
  const ownKey = `${KEY_PREFIX}${id}`
  const month = monthOf(now)
  const stored = asSpend(await $.store.get(ownKey))
  const last = stored !== undefined && stored.month === month ? stored : { month, base: 0, usd: 0 }
  const base = sessionUsd < last.usd ? last.base + last.usd : last.base

  if (stored === undefined || base !== last.base || sessionUsd !== last.usd || stored.month !== month) {
    await $.store.set(ownKey, { month, base, usd: sessionUsd } satisfies Spend)
  }

  const isFresh =
    others !== undefined && others.month === month && now - others.readAt < OTHERS_MAX_AGE_MS
  const othersUsd = isFresh && others !== undefined ? others.usd : await readOthers($, ownKey, month, now)

  return othersUsd + base + sessionUsd
}

const refresh = async ($: EngineInterface): Promise<void> => {
  const [model, usage] = await Promise.all([$.session.model(), $.session.usage()])

  const parts = [model]

  for (const limit of usage.rateLimits) {
    parts.push(`${LABELS[limit.kind] ?? limit.kind} ${Math.round(limit.percentUsed)}%`)
  }

  // No rate-limit windows (API or usage-based billing): show what this
  // session has cost, and what every session on this machine has cost this
  // month, instead.
  if (usage.rateLimits.length === 0 && usage.cost !== undefined && usage.cost.usd > 0) {
    const monthUsd = await trackMonth($, usage.cost.usd)

    parts.push(`${dollars(usage.cost.usd)} session`, `${dollars(monthUsd)} month`)
  }

  if (usage.context.percent !== undefined) {
    parts.push(`ctx ${usage.context.percent}%`)
  }

  $.ui.status(parts.join(' · '))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await refresh($)

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      await refresh($)
    }

    return next(e)
  })

  // Usage figures are pushed here after each main-thread turn and whenever a
  // rate-limit window moves a whole point.
  on('session.measure', async ($, e, next) => {
    await refresh($)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await refresh($)

    return next(e)
  })

  // A slash command such as /model can change the model between turns.
  on('command.run', async ($, e, next) => {
    const result = await next(e)
    await refresh($)

    return result
  }).catch(($, e, next) => next(e))
}
