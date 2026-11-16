/** One subagent: its model, what it was spawned as, and its context in tokens. */
export type AgentStep = { model?: string; label?: string; tokens?: number }

/** Everything the status line is written from, measured by the event hooks. */
export type Line = {
  /** The session's model as `/model` shows it; empty until first measured. */
  model: string
  /** The model id the main conversation's responses report. */
  modelId: string | null
  /** The account's usage parts, the same in every view: `5h 23%`, `spend 4%`. */
  usage: string[]
  /** The main conversation's context part, `ctx 12%`; empty when unknown. */
  context: string
  /** The session model's context window, in tokens. */
  window: number
  agents: Record<string, AgentStep>
}

declare module 'claude-code' {
  interface PluginState {
    'model-usage-status': { line: Line }
  }
}
