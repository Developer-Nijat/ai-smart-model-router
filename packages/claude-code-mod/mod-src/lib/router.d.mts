import type { Decision, Effort, LiveMessage, Override, RouteMode, SessionState, TurnRecord } from '../types'

export type LiveChoice = 'on' | 'band' | 'off'

export type Settings = {
  routing: { mode: RouteMode; sticky: { enabled: boolean; minScoreGain: number }; weights: Record<string, number> }
  classifier: { enabled: boolean; provider: string; model: string | null; confidenceThreshold: number; timeoutMs: number }
  privacy: { mode: string; storePrompts: boolean }
}

export type Plan = {
  decision: Decision | null
  shouldApply: boolean
  agentModel: string | null
  agentEffort: Effort | null
  trace: string[]
  skipReason: string | null
}

export type ClassifierCall = {
  model: string
  system: string
  prompt: string
  maxTokens: number
  effort: Effort
  timeoutMs: number
}

export type Classified = { classification: unknown; source: string; aiCalled: boolean; aiError: string | null }

export type StepUsage = {
  model?: string
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

export type StepObservation = { usage?: StepUsage | null }

export type Router = {
  tierOf(id: string): number | null
  modelIdOf(name: string | null | undefined): string | null
  resolveManual(word: string): { id: string; supportedEffort: readonly string[] } | null
  newSession(sessionId: string): SessionState
  classify(input: {
    text: string
    state: SessionState
    settings: Settings
    complete?: (call: ClassifierCall) => Promise<string>
  }): Promise<Classified>
  decideTurn(input: {
    state: SessionState
    settings: Settings
    text: string
    classified: Classified
    ids: { decisionId: string; turnId: string }
    createdAt: string
    observedModel: string
  }): Plan
  decideSubagent(input: {
    settings: Settings
    sessionId: string
    prompt: string
    model?: string
    subagentType: string
    ids: { decisionId: string; turnId: string | null }
    createdAt: string
  }): Plan
  finishTurn(input: { state: SessionState | null; plan: Plan; steps: readonly StepObservation[] }): {
    state: SessionState | null
    record: TurnRecord
  }
}

export type RouteCommand =
  | { kind: 'status' | 'help' | 'clear' | 'explain' | 'stats' }
  | { kind: 'mode'; mode: RouteMode }
  | { kind: 'override'; model: string; effort: Effort | null; scope: Override['scope'] }
  | { kind: 'error'; message: string }

export type DaemonTarget = { base: string; endpoint: string; token: string } | { disabled: string }

declare const smr: {
  withTuning(settings: Settings, tuning: unknown): Settings
  hmacSha256Hex(key: string, message: string, digest: (data: Uint8Array) => Promise<ArrayBuffer>): Promise<string>
  newNonce(getRandomValues: (bytes: Uint8Array) => Uint8Array): string
  healthUrl(target: { base: string }, nonce: string): string
  verifyHealth(
    text: string,
    target: { token: string },
    nonce: string,
    digest: (data: Uint8Array) => Promise<ArrayBuffer>,
  ): Promise<boolean>
  describeFailure(status: number): string
  daemonTarget(options: Record<string, unknown>): DaemonTarget
  nextBatch<T>(pending: readonly T[] | unknown, size?: number): T[]
  afterSend<T>(pending: readonly T[], batch: readonly T[], response: { ok: boolean }): T[]
  DATA: unknown
  RULES: unknown[]
  HELP: string
  createRouter(input: { data: unknown; rules?: unknown[] }): Router
  settingsFromOptions(options: Record<string, unknown>): { settings: Settings; warnings: string[]; live: LiveChoice }
  liveMessage(input: {
    decision: Decision
    applies: boolean
    previousModel?: string | null
    tierOf?: (id: string) => number | null
    subagentType?: string | null
  }): LiveMessage
  LIVE_CHOICES: readonly LiveChoice[]
  withMode(settings: Settings, mode: RouteMode): Settings
  parseRouteCommand(args: string, router: Router): RouteCommand
  formatStatus(input: { mode: RouteMode; override: Override | null; warnings: string[]; records: TurnRecord[] }): string
  lastMainRecord(records: readonly TurnRecord[]): TurnRecord | undefined
  formatExplain(record: TurnRecord | undefined): string
  formatStats(records: readonly TurnRecord[]): string
  statusLine(record: TurnRecord): string
  withOverride(state: SessionState, override: Override | null): SessionState
  afterClear(state: SessionState): SessionState
}

export default smr
