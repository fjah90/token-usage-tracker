export type ModelUsage = {
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
  requests: number
}

export type DayUsage = { date: string; models: Record<string, ModelUsage> }

export type HeadroomSavings = {
  days: Record<string, { tokensSaved: number; usdSaved: number }>
  lifetime: { tokensSaved: number; usdSaved: number }
}

/** What hooks/scan.mjs prints. */
export type Report = {
  generatedAt: string
  fromDay: string
  days: DayUsage[]
  headroom: HeadroomSavings | null
  /** This session's usage per model since it began (with --session). */
  session: Record<string, ModelUsage> | null
}

export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

declare module 'claude-code' {
  interface PluginState {
    'token-usage-tracker': {
      report: Report | null
      limits: Limit[]
      error: string | null
      isScanning: boolean
      isExpanded: boolean
      /** This session's cost in USD, as /cost totals it. */
      cost: number | null
    }
  }
}
