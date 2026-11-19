export type RouteMode = 'shadow' | 'auto' | 'off'

export type RouteEntry = {
  turnId: string
  agentId?: string
  mode: RouteMode
  source: string
  reason: string
  requestedModel: string
  recommendedModel: string
  recommendedEffort?: string
  applied: boolean
  answeredBy?: string
  steps: number
}

declare module 'claude-code' {
  interface PluginState {
    'smr-spike': {
      mode: Shaped<RouteMode>
      override: Shaped<string>
      log: Shaped<RouteEntry[]>
    }
  }
}
