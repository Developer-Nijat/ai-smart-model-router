export type Decision = {
  model: string
  effort?: 'low' | 'medium' | 'high'
  source: 'manual' | 'rule' | 'default'
  reason: string
}

declare const core: {
  decide: (text: string, options?: { override?: string }) => Decision
  MANUAL_MODELS: readonly string[]
}

export default core
