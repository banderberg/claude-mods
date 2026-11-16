import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentStep, Line } from '../types'

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

// What the line is written from lives in `$.state`, not in this module: the
// hook that draws runs apart from the hooks that measure, and only the
// session's state is common to both.
const EMPTY: Line = { model: '', modelId: null, usage: [], context: '', window: 0, agents: {} }
const line = atom({ plugin: 'model-usage-status', key: 'line' } as const, EMPTY)

// Where the band above the prompt is drawn, and so where the line can follow
// the transcript in view.
const BAND_SURFACES = ['terminal', 'desktop', 'mobile']

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

/** The line for the transcript in view: the main conversation's, or one agent's. */
const textFor = (state: Line, agentId: string | undefined): string | undefined => {
  if (state.model === '') {
    return undefined
  }

  const agent = agentId === undefined ? undefined : state.agents[agentId]

  if (agentId === undefined || agent === undefined) {
    return [state.model, ...state.usage, state.context].filter(part => part !== '').join(' · ')
  }

  const name = agent.model === undefined ? 'subagent' : modelName(agent.model)
  const parts = [agent.label === undefined ? name : `${name} (${agent.label})`, ...state.usage]

  // The window is known only for the session's own model: a subagent on
  // another model shows its tokens instead of a share.
  if (agent.tokens !== undefined) {
    const hasSameWindow = agent.model === state.modelId && state.window > 0

    parts.push(
      hasSameWindow
        ? `ctx ${Math.round((agent.tokens / state.window) * 100)}%`
        : `ctx ${tokenCount(agent.tokens)}`,
    )
  }

  return parts.join(' · ')
}

/**
 * Writes the line where no band is drawn to follow the view. Elsewhere the
 * band's hook writes it, on each change of the state and of the view.
 */
const writeUnfollowed = async ($: EngineInterface): Promise<void> => {
  const surface = await $.session.surface()

  if (surface !== null && !BAND_SURFACES.includes(surface)) {
    const text = textFor(await read($, line), undefined)

    if (text !== undefined) {
      $.ui.status(text)
    }
  }
}

/** Measures the main conversation and the account, and stores what the line shows. */
const measure = async ($: EngineInterface, canFetch: boolean): Promise<void> => {
  const [model, usage, account] = await Promise.all([
    $.session.model(),
    $.session.usage(),
    readPlan($, canFetch),
  ])

  const windows: Window[] = usage.rateLimits.length > 0 ? usage.rateLimits : (account?.windows ?? [])
  const parts = windows.map(
    limit => `${LABELS[limit.kind] ?? limit.kind} ${Math.round(limit.percentUsed)}%`,
  )
  const hasSpend = windows.some(limit => limit.kind === 'spend_limit')

  if (!hasSpend && account?.spendPercent !== undefined) {
    parts.push(`spend ${Math.round(account.spendPercent)}%`)
  }

  const context = usage.context.percent === undefined ? '' : `ctx ${usage.context.percent}%`

  await update($, line, state => ({
    ...state,
    model,
    usage: parts,
    context,
    window: usage.context.window,
  }))
  await writeUnfollowed($)
}

/** Stores what is newly known of one subagent, with what it was spawned as. */
const noteAgent = async ($: EngineInterface, agentId: string, known: AgentStep): Promise<void> => {
  const before = (await read($, line)).agents[agentId]
  const label =
    before?.label ??
    (await $.agent.list())
      .filter(agent => agent.id === agentId)
      .map(agent => agent.name ?? agent.type)[0]
  const after: AgentStep = { ...before, ...known, ...(label === undefined ? {} : { label }) }

  if (
    before?.model !== after.model ||
    before?.label !== after.label ||
    before?.tokens !== after.tokens
  ) {
    await update($, line, state => ({ ...state, agents: { ...state.agents, [agentId]: after } }))
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await measure($, true)

    return next(e)
  })

  // Never holds a turn up on the network: the last reading is drawn.
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      await measure($, false)
    } else {
      await noteAgent($, e.agentId, {})
    }

    return next(e)
  })

  // Usage figures are pushed here after each main-thread turn and whenever a
  // rate-limit window moves a whole point.
  on('session.measure', async ($, e, next) => {
    await measure($, true)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await measure($, true)
    }

    return next(e)
  })

  // A subagent's model, as soon as it is started.
  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)

    if (started.agentId !== undefined && started.model !== undefined) {
      await noteAgent($, started.agentId, { model: bareId(started.model) })
    }

    return started
  }).catch(($, e, next) => next(e))

  // Each model response, main's and every subagent's: where a subagent's
  // model and context fill come from.
  on('turn.step', async function* ($, e, next) {
    const { agentId } = e

    // The model is known as the request leaves, well before a long response
    // has finished.
    if (agentId !== undefined) {
      await noteAgent($, agentId, { model: bareId(e.model) })
    }

    const response = yield* next(e)

    if (response.usage !== null) {
      const { input_tokens, cache_read_input_tokens, cache_creation_input_tokens } = response.usage
      const model = bareId(response.usage.model)

      if (agentId !== undefined) {
        await noteAgent($, agentId, {
          model,
          tokens: input_tokens + cache_read_input_tokens + cache_creation_input_tokens,
        })
      } else if ((await read($, line)).modelId !== model) {
        await update($, line, state => ({ ...state, modelId: model }))
      }
    }

    return response
  })

  // Draws nothing. The band is asked again whenever the person switches
  // between the main conversation and a subagent's, and whenever the state
  // read here changes: each time, the line is written for the view on screen.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const text = textFor(await read($, line), e.props.view.agentId)

    if (text !== undefined) {
      $.ui.status(text)
    }

    return next(e)
  })

  // A slash command such as /model can change the model between turns.
  on('command.run', async ($, e, next) => {
    const result = await next(e)
    await measure($, true)

    return result
  }).catch(($, e, next) => next(e))
}
