import type { EngineInterface, Register } from 'claude-code'

const LABELS: Record<string, string> = {
  five_hour: '5h',
  seven_day: '7d',
  spend_limit: 'spend',
}

const refresh = async ($: EngineInterface): Promise<void> => {
  const [model, usage] = await Promise.all([$.session.model(), $.session.usage()])

  const parts = [model]

  for (const limit of usage.rateLimits) {
    parts.push(`${LABELS[limit.kind] ?? limit.kind} ${Math.round(limit.percentUsed)}%`)
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
