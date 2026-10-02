// glass's state contract: what the footer draws from.
export type GlassTurn = {
  durationMs: number
  /** main-loop tool calls this turn */
  tools: number
  /** input + cache read + cache creation tokens */
  inTokens: number
  outTokens: number
  /** when the turn ended, ms since the epoch */
  finishedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    glass: { lastTurn: GlassTurn | null }
  }
}
