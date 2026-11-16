import type { EngineInterface, Register } from 'claude-code'

const LABELS: Record<string, string> = {
  five_hour: '5h',
  seven_day: '7d',
  spend_limit: 'spend',
}

// The account's own usage figures, as Claude Code's /usage screen and the
// desktop app read them. The engine hands mods the rate-limit windows only
// once a response has reported them, and never a plan's spend limit, so the
// mod asks for both here with the session's own sign-in.
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const PLAN_MAX_AGE_MS = 60 * 1000

type Window = { kind: string; percentUsed: number }
type Plan = { windows: Window[]; spendPercent?: number }

let plan: { value: Plan; readAt: number } | undefined

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const asPercent = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

/** The share of the plan's spend limit used, when the plan has one switched on. */
const spendPercentOf = (body: Record<string, unknown>): number | undefined => {
  const { spend, extra_usage: extra } = body

  if (isRecord(spend) && (spend.enabled === true || isRecord(spend.limit))) {
    const percent = asPercent(spend.percent)

    if (percent !== undefined) {
      return percent
    }
  }

  return isRecord(extra) && extra.is_enabled === true ? asPercent(extra.utilization) : undefined
}

const parsePlan = (text: string): Plan | undefined => {
  const body: unknown = JSON.parse(text)

  if (!isRecord(body)) {
    return undefined
  }

  const windows: Window[] = []

  for (const kind of ['five_hour', 'seven_day']) {
    const entry = body[kind]
    const percentUsed = isRecord(entry) ? asPercent(entry.utilization) : undefined

    if (percentUsed !== undefined) {
      windows.push({ kind, percentUsed })
    }
  }

  return { windows, spendPercent: spendPercentOf(body) }
}

/**
 * Reads the account's usage, at most once a minute. Any failure (no
 * subscription sign-in, an offline or refused request, an answer in another
 * shape) leaves the last reading in place: the line then shows what the engine
 * has alone.
 */
const readPlan = async ($: EngineInterface, canFetch: boolean): Promise<Plan | undefined> => {
  const now = await $.clock.now()

  if (!canFetch || (plan !== undefined && now - plan.readAt < PLAN_MAX_AGE_MS)) {
    return plan?.value
  }

  try {
    const auth = await $.session.authorize()

    if (auth?.kind === 'bearer') {
      const response = await $.http.fetch(USAGE_URL, {
        auth: auth.handle,
        headers: { 'anthropic-beta': 'oauth-2025-04-20' },
      })
      const value = response.ok ? parsePlan(response.text) : undefined

      if (value !== undefined) {
        plan = { value, readAt: now }
      }
    }
  } catch {
    // Keep the last reading.
  }

  return plan?.value
}

const refresh = async ($: EngineInterface, canFetch: boolean): Promise<void> => {
  const [model, usage, account] = await Promise.all([
    $.session.model(),
    $.session.usage(),
    readPlan($, canFetch),
  ])

  const parts = [model]
  const windows: Window[] = usage.rateLimits.length > 0 ? usage.rateLimits : (account?.windows ?? [])

  for (const limit of windows) {
    parts.push(`${LABELS[limit.kind] ?? limit.kind} ${Math.round(limit.percentUsed)}%`)
  }

  const hasSpend = windows.some(limit => limit.kind === 'spend_limit')

  if (!hasSpend && account?.spendPercent !== undefined) {
    parts.push(`spend ${Math.round(account.spendPercent)}%`)
  }

  if (usage.context.percent !== undefined) {
    parts.push(`ctx ${usage.context.percent}%`)
  }

  $.ui.status(parts.join(' · '))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await refresh($, true)

    return next(e)
  })

  // Never holds a turn up on the network: the last reading is drawn.
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      await refresh($, false)
    }

    return next(e)
  })

  // Usage figures are pushed here after each main-thread turn and whenever a
  // rate-limit window moves a whole point.
  on('session.measure', async ($, e, next) => {
    await refresh($, true)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await refresh($, true)

    return next(e)
  })

  // A slash command such as /model can change the model between turns.
  on('command.run', async ($, e, next) => {
    const result = await next(e)
    await refresh($, true)

    return result
  }).catch(($, e, next) => next(e))
}
