export type RouteMode = 'shadow' | 'auto' | 'off'
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type Classification = {
  taskType: string
  complexity: number
  reasoning: string
  codingDepth: string
  risk: string
  scope: string
  confidence: number
  latencyPriority: boolean
  contextTokens: number | null
}

export type Decision = {
  id: string
  sessionId: string
  turnId: string | null
  agentId: string
  subagentId: string | null
  mode: RouteMode
  classification: Classification | null
  selection: { model: string; effort: Effort | null }
  alternatives: { model: string; score: number; reason: string }[]
  reason: string
  decisionSource: string
  status: 'recommended' | 'applied' | 'unsupported' | 'failed' | 'skipped'
  appliedModel: string | null
  appliedEffort: Effort | null
  estimatedCostUsd: number | null
  createdAt: string
}

export type Tokens = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/** One finished turn (main or subagent). Holds no prompt text. */
export type TurnRecord = {
  decision: Decision
  verified: boolean
  answeredBy: string[]
  steps: number
  tokens: Tokens
  /** False when a step reported no usage: the cost is then unknown. */
  costComplete: boolean
  trace: string[]
}

/** What the band above the prompt shows for the last routed turn (src/live.js). */
export type LiveMessage = {
  tone: 'down' | 'up' | 'same' | 'stay' | 'shadow' | 'manual' | 'rule' | 'subagent'
  icon: string
  title: string
  detail: string
  line: string
}

export type Override = { model: string; effort: Effort | null; scope: 'turn' | 'session' }

/** The core's per-session routing state (packages/core/src/session.js). */
export type SessionState = {
  sessionId: string
  agentId: string
  subagentId: string | null
  currentModel: string | null
  contextTokens: number | null
  override: Override | null
  turns: number
  lastDecisionId: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'smart-model-router': {
      mode: Shaped<RouteMode>
      session: Shaped<SessionState | null>
      log: Shaped<TurnRecord[]>
      live: Shaped<LiveMessage | null>
    }
  }
}
