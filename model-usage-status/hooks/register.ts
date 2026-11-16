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

// Each subagent's model, known from its first request on, and how many tokens
// its last finished response was answered over. The engine's own figures are the main
// conversation's alone, so a subagent's are gathered from its steps.
type Step = { model: string; tokens?: number }

const agents = new Map<string, Step>()
let mainModelId: string | undefined
// The agent whose transcript is on screen; undefined for the main conversation.
let viewed: string | undefined

/** A model id without a variant suffix such as `[1m]`. */
const bareId = (id: string): string => id.replace(/\[[^\]]*\]$/, '')

/** `claude-opus-5-5-20260101` as `Opus 5.5`. */
const modelName = (id: string): string => {
  const words = bareId(id).split('-').filter(word => word !== 'claude' && !/^\d{8}$/.test(word))
  const names = words.filter(word => !/^\d+$/.test(word))
  const version = words.filter(word => /^\d+$/.test(word)).join('.')
  const name = names.map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')

  return [name, version].filter(part => part !== '').join(' ') || id
}

const tokenCount = (tokens: number): string =>
  tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : String(tokens)

const refresh = async ($: EngineInterface, canFetch: boolean): Promise<void> => {
  const [model, usage, account, running] = await Promise.all([
    $.session.model(),
    $.session.usage(),
    readPlan($, canFetch),
    viewed === undefined ? undefined : $.agent.list(),
  ])

  const agent = running?.find(candidate => candidate.id === viewed)
  const step = viewed === undefined ? undefined : agents.get(viewed)
  const isAgentView = viewed !== undefined && (agent !== undefined || step !== undefined)

  const parts: string[] = []

  if (isAgentView) {
    const label = agent?.name ?? agent?.type
    const name = step === undefined ? 'subagent' : modelName(step.model)

    parts.push(label === undefined ? name : `${name} (${label})`)
  } else {
    parts.push(model)
  }

  const windows: Window[] = usage.rateLimits.length > 0 ? usage.rateLimits : (account?.windows ?? [])

  for (const limit of windows) {
    parts.push(`${LABELS[limit.kind] ?? limit.kind} ${Math.round(limit.percentUsed)}%`)
  }

  const hasSpend = windows.some(limit => limit.kind === 'spend_limit')

  if (!hasSpend && account?.spendPercent !== undefined) {
    parts.push(`spend ${Math.round(account.spendPercent)}%`)
  }

  if (isAgentView) {
    // The window is known only for the session's own model: a subagent on
    // another model shows its tokens instead of a share.
    if (step?.tokens !== undefined) {
      const hasSameWindow = step.model === mainModelId && usage.context.window > 0

      parts.push(
        hasSameWindow
          ? `ctx ${Math.round((step.tokens / usage.context.window) * 100)}%`
          : `ctx ${tokenCount(step.tokens)}`,
      )
    }
  } else if (usage.context.percent !== undefined) {
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

  // Each model response, main's and every subagent's: where a subagent's
  // model and context fill come from.
  on('turn.step', async function* ($, e, next) {
    const { agentId } = e

    // The model is known as the request leaves, well before a long response
    // has finished.
    if (agentId !== undefined && agents.get(agentId)?.model !== bareId(e.model)) {
      agents.set(agentId, { ...agents.get(agentId), model: bareId(e.model) })

      if (agentId === viewed) {
        await refresh($, false)
      }
    }

    const response = yield* next(e)

    if (response.usage !== null) {
      const { input_tokens, cache_read_input_tokens, cache_creation_input_tokens } = response.usage
      const model = bareId(response.usage.model)

      if (agentId === undefined) {
        mainModelId = model
      } else {
        agents.set(agentId, {
          model,
          tokens: input_tokens + cache_read_input_tokens + cache_creation_input_tokens,
        })

        if (agentId === viewed) {
          await refresh($, false)
        }
      }
    }

    return response
  })

  // Draws nothing: the band is asked again whenever the person switches
  // between the main conversation and a subagent's, which is how the line
  // learns whose figures to show.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.view.agentId !== viewed) {
      viewed = e.props.view.agentId
      await refresh($, false)
    }

    return next(e)
  })

  // A slash command such as /model can change the model between turns.
  on('command.run', async ($, e, next) => {
    const result = await next(e)
    await refresh($, true)

    return result
  }).catch(($, e, next) => next(e))
}
