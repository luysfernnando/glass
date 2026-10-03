// glass's state contract: what the chrome draws from.
export type GlassTurn = {
  turnId: string
  durationMs: number
  /** main-loop tool calls this turn */
  tools: number
  /** Edit, Write and NotebookEdit calls, main loop and agents alike */
  edits: number
  /** main-loop calls that ended in an error */
  failed: number
  /** input + cache read + cache creation tokens */
  inTokens: number
  /** cache read tokens alone, for the cached share */
  cacheTokens: number
  outTokens: number
  /** the session ledger's delta over the turn; null where the host keeps none */
  costUsd: number | null
  /** the id of the turn's last main-loop tool call, which draws the elbow */
  lastToolId: string | null
  /** the reply text, for the footer's Copy */
  answer: string
  /** when the turn began and ended, ms since the epoch */
  startedAt: number
  finishedAt: number
}

/** one main-loop tool call, as the dots line and the tree draw it */
export type GlassCall = {
  id: string
  tool: string
  status: 'running' | 'ok' | 'failed'
  /** wall time once known */
  ms: number | null
}

/** one prompt the person submitted: the user row finds its turn by text */
export type GlassPrompt = {
  text: string
  submittedAt: number
  /** when the turn for it began; null until it does */
  startedAt: number | null
  turnId: string | null
}

/** one subagent still running, for the band above the prompt */
export type GlassAgent = {
  agentId: string
  description: string
  /** the agent type (`Explore`, `general-purpose`) */
  kind: string
  model: string
  effort: string
  /** the last tool it called, or `thinking` */
  stage: string
  /** the path its last file tool touched, or empty */
  file: string
  /** tokens its model requests have used so far */
  tokens: number
  startedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    glass: {
      turns: GlassTurn[]
      prompts: GlassPrompt[]
      /** the main-loop calls of each turn, by turn id, in call order */
      calls: Record<string, GlassCall[]>
      /** turn ids whose tree is folded away by /fold; a new turn leaves it */
      folded: string[]
      /** request ids of the engine's folded groups the person opened */
      expanded: string[]
      /** true after /expand: every folded group opens; /collapse clears it */
      expandAll: boolean
      agents: GlassAgent[]
      /** the band above the prompt: the box, or one strip */
      band: 'open' | 'closed'
    }
  }
}
