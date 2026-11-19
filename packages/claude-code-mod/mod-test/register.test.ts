import { expect, test } from 'claude-code/testing'
import smr from '../lib/router.mjs'

// Runs the mod's hooks against the engine kit (`claude plugin test`): no model is called.
// Hooks registered with `on` here stand for the engine beneath the mod.

const usage = (model: string) => ({
  model,
  input_tokens: 1000,
  output_tokens: 200,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
})

function engine(on: Parameters<Parameters<typeof test>[1]>[1], seen: { model?: string; effort?: unknown }[], opts: { storeFails?: boolean; seed?: Record<string, unknown>; statuses?: (string | undefined)[] } = {}) {
  const store = new Map<string, unknown>(Object.entries(opts.seed ?? {}))
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    if (opts.storeFails) throw new Error('quota')
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('ui.status', (_, e) => {
    opts.statuses?.push(e.text)
    return { value: undefined }
  })
  // The send timeout never fires in tests: each fetch stub answers at once.
  on('clock.sleep', () => new Promise<never>(() => undefined))
  on('session.id', () => ({ value: 'session-1' }))
  on('clock.now', () => ({ value: Date.UTC(2026, 10, 19, 10, 0, 0) }))
  on('command.register', () => ({ value: { command: 'route' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('turn.step', async function* (_, e) {
    seen.push({ model: e.model, effort: e.effort })
    const full = e.model === 'haiku' ? 'claude-haiku-5-5' : e.model === 'opus' ? 'claude-opus-5-5' : e.model === 'sonnet' ? 'claude-sonnet-5-5' : e.model
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: usage(full) }
  })
}

async function runTurn($: Parameters<Parameters<typeof test>[1]>[0], turnId: string, text: string) {
  await $.turn.start({ text, turnId })
  const stream = $.turn.step({ turnId, index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 1 })
  for await (const _ of stream) {
    // drain
  }
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, reason: 'answer', turnId } as never)
}

test('auto mode sends a typo fix to haiku with low effort', { options: { defaultMode: 'auto' } }, async ($, on) => {
  const seen: { model?: string; effort?: unknown }[] = []
  engine(on, seen)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await runTurn($, 't1', "Fix the typo in the word 'helo'")
  expect(seen[0]).toEqual({ model: 'haiku', effort: 'low' })

  const stats = await $.command.run({ command: 'route', args: 'explain' } as never)
  expect(String((stats as { text: string }).text)).toContain('applied')
})

test('a routed turn says so while it runs: transcript line, status and band', { options: { defaultMode: 'auto' } }, async ($, on) => {
  const seen: { model?: string; effort?: unknown }[] = []
  const statuses: (string | undefined)[] = []
  engine(on, seen, { statuses })
  const logs: string[] = []
  on('ui.log', (_, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await runTurn($, 't1', "Fix the typo in the word 'helo'")
  expect(logs).toEqual(['▼ router · opus → haiku/low · light bug fix · a cheaper model is enough'])
  expect(statuses[0]).toBe('router ▼ opus → haiku/low')
  // Labels only: the prompt's words never reach a message.
  expect(logs.join(' ')).not.toContain('helo')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'smart-model-router',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isCollapsed: false, isWorking: true, maxRows: 10 } as never,
    })
    expect(await ui.find({ type: 'Text', text: /opus → haiku\/low/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^router $/ })).toBeDefined()
    await ui.unmount()
  }
})

test('liveMessages band keeps the transcript clean; off shows nothing', { options: { defaultMode: 'auto', liveMessages: 'band' } }, async ($, on) => {
  const seen: { model?: string; effort?: unknown }[] = []
  engine(on, seen)
  const logs: string[] = []
  on('ui.log', (_, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await runTurn($, 't1', "Fix the typo in the word 'helo'")
  expect(logs).toEqual([])
  await $.command.run({ command: 'route', args: 'off' } as never)
  const ui = await $.ui.mount({
    plugin: 'smart-model-router',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10 } as never,
  })
  expect(await ui.find({ type: 'Text', text: /haiku/ })).toBeUndefined()
  await ui.unmount()
})

test('shadow mode (the default) changes nothing', async ($, on) => {
  const seen: { model?: string; effort?: unknown }[] = []
  engine(on, seen)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await runTurn($, 't1', "Fix the typo in the word 'helo'")
  expect(seen[0]).toEqual({ model: 'claude-opus-5-5', effort: 'high' })

  const status = await $.command.run({ command: 'route', args: '' } as never)
  expect(String((status as { text: string }).text)).toContain('mode: shadow')
  const explain = await $.command.run({ command: 'route', args: 'explain' } as never)
  expect(String((explain as { text: string }).text)).toContain('recommended: anthropic.claude-haiku')
  // The output is the person's; the model gets a note that the command was handled,
  // so it does not report /route as a missing skill.
  const answer = explain as { isTextDisplayOnly?: true; context?: readonly string[] }
  expect(answer.isTextDisplayOnly).toBe(true)
  expect(answer.context?.join(' ')).toContain('handled by the smart-model-router plugin')
})

test('a manual override applies even in shadow mode, once', async ($, on) => {
  const seen: { model?: string; effort?: unknown }[] = []
  engine(on, seen)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const said = await $.command.run({ command: 'route', args: 'sonnet max once' } as never)
  expect(String((said as { text: string }).text)).toContain('manual override: anthropic.claude-sonnet/max')
  await runTurn($, 't1', "Fix the typo in the word 'helo'")
  await runTurn($, 't2', "Fix the typo in the word 'helo'")
  expect(seen[0]).toEqual({ model: 'sonnet', effort: 'max' })
  expect(seen[1]).toEqual({ model: 'claude-opus-5-5', effort: 'high' })
})

test('/route off stops routing; bad words get help', { options: { defaultMode: 'auto' } }, async ($, on) => {
  const seen: { model?: string; effort?: unknown }[] = []
  engine(on, seen)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'route', args: 'off' } as never)
  await runTurn($, 't1', "Fix the typo in the word 'helo'")
  expect(seen[0]).toEqual({ model: 'claude-opus-5-5', effort: 'high' })
  const bad = await $.command.run({ command: 'route', args: 'gpt9' } as never)
  expect(String((bad as { text: string }).text)).toContain('unknown command or model')
})

test('a subagent gets a model for its task unless the call names one', { options: { defaultMode: 'auto' } }, async ($, on) => {
  const models: (string | undefined)[] = []
  engine(on, [])
  on('agent.spawn', (_, e) => {
    models.push(e.model)
    return { model: e.model ?? e.parentModel, agentId: `agent-${models.length}` }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const base = { tool_use_id: 'tu1', description: 'd', subagentType: 'general-purpose', parentModel: 'claude-opus-5-5' }
  await $.agent.spawn({ ...base, prompt: 'Fix the typo in README.md' } as never)
  await $.agent.spawn({ ...base, prompt: 'Audit the auth flow for injection vulnerabilities' } as never)
  await $.agent.spawn({ ...base, prompt: 'Fix the typo in README.md', model: 'opus' } as never)
  expect(models).toEqual(['haiku', 'opus', 'opus'])
})

test('a store failure never breaks the turn', { options: { defaultMode: 'auto' } }, async ($, on) => {
  const seen: { model?: string; effort?: unknown }[] = []
  engine(on, seen, { storeFails: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await runTurn($, 't1', "Fix the typo in the word 'helo'")
  expect(seen[0]).toEqual({ model: 'haiku', effort: 'low' })
  await runTurn($, 't2', "Fix the typo in the word 'helo'")
  expect(seen).toHaveLength(2)
})

test('a subagent turn runs on its planned model and effort and is recorded', { options: { defaultMode: 'auto' } }, async ($, on) => {
  const seen: { model?: string; effort?: unknown }[] = []
  engine(on, seen)
  on('agent.spawn', async (_, e) => {
    // The engine starts the subagent before the spawn call returns.
    await $.turn.start({ text: e.prompt, turnId: 'sub-t1', agentId: 'agent-1' })
    const stream = $.turn.step({ turnId: 'sub-t1', index: 0, model: e.model ?? e.parentModel, effort: 'high', messageCount: 1, agentId: 'agent-1' })
    for await (const _ of stream) {
      // drain
    }
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, reason: 'answer', turnId: 'sub-t1' } as never)
    return { model: e.model ?? e.parentModel, agentId: 'agent-1' }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn({ tool_use_id: 'tu1', description: 'd', subagentType: 'general-purpose', parentModel: 'claude-opus-5-5', prompt: 'Fix the typo in README.md' } as never)
  expect(seen[0]).toEqual({ model: 'haiku', effort: 'low' })
  const stats = await $.command.run({ command: 'route', args: 'stats' } as never)
  expect(String((stats as { text: string }).text)).toContain('turns: 1 (0 main, 1 subagent)')
})

const TOKEN = 'b'.repeat(64)

/** Answers /health with a proof made with TOKEN; every other request goes to `handle`. */
function provingDaemon(on: Parameters<Parameters<typeof test>[1]>[1], handle: (url: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) => { status: number; text: string }) {
  on('http.fetch', async (_, e) => {
    if (e.url.includes('/health?nonce=')) {
      const nonce = new URL(e.url).searchParams.get('nonce') ?? ''
      const digest = (data: Uint8Array) => crypto.subtle.digest('SHA-256', data)
      const proof = await smr.hmacSha256Hex(TOKEN, `smr-health:${nonce}`, digest)
      return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ ok: true, service: 'smart-model-router', proof }) } }
    }
    const { status, text } = handle(e.url, e.init as never)
    return { value: { status, ok: status < 300, headers: {}, text } }
  })
}

const OPUS_FOR_TYPOS = [{ id: 'typos-on-opus', name: 'Typos on Opus', enabled: true, priority: 5, when: { keywords: ['helo'] }, then: { model: 'anthropic.claude-opus', effort: 'high' } }]

test('rules the daemon serves steer routing', { options: { defaultMode: 'auto', daemonToken: TOKEN } }, async ($, on) => {
  const seen: { model?: string; effort?: unknown }[] = []
  engine(on, seen)
  provingDaemon(on, (url) => {
    if (url.endsWith('/v1/routing')) return { status: 200, text: JSON.stringify({ rules: OPUS_FOR_TYPOS, tuning: { sticky: { enabled: true, minScoreGain: 0.2 }, weights: { quality: 1, cost: 0.3, latency: 0.1, transition: 0.5 } } }) }
    return { status: 200, text: '{"accepted":1,"duplicates":0,"rejected":[]}' }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await runTurn($, 't1', "Fix the typo in the word 'helo'")
  expect(seen[0]).toEqual({ model: 'opus', effort: 'high' })
  const status = await $.command.run({ command: 'route', args: '' } as never)
  expect(String((status as { text: string }).text)).toContain('rules: 1 (from the daemon), tuning from the daemon')
})

test('while the daemon is down, the last copy of its rules is used', { options: { defaultMode: 'auto', daemonToken: TOKEN } }, async ($, on) => {
  const seen: { model?: string; effort?: unknown }[] = []
  engine(on, seen, { seed: { 'daemon-routing': { rules: OPUS_FOR_TYPOS } } })
  on('http.fetch', () => {
    throw new Error('ECONNREFUSED')
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await runTurn($, 't1', "Fix the typo in the word 'helo'")
  expect(seen[0]).toEqual({ model: 'opus', effort: 'high' })
  const status = await $.command.run({ command: 'route', args: '' } as never)
  expect(String((status as { text: string }).text)).toContain('rules: 1 (last copy from the daemon)')
})

test('an oversized rule list from the daemon is refused', { options: { defaultMode: 'auto', daemonToken: TOKEN } }, async ($, on) => {
  const seen: { model?: string; effort?: unknown }[] = []
  engine(on, seen)
  const many = Array.from({ length: 501 }, (_, i) => ({ ...OPUS_FOR_TYPOS[0], id: `r${i}` }))
  provingDaemon(on, (url) => (url.endsWith('/v1/routing') ? { status: 200, text: JSON.stringify({ rules: many }) } : { status: 200, text: '{}' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await runTurn($, 't1', "Fix the typo in the word 'helo'")
  expect(seen[0]).toEqual({ model: 'haiku', effort: 'low' })
})

test('invalid rules from the daemon never replace the rules in force', { options: { defaultMode: 'auto', daemonToken: TOKEN } }, async ($, on) => {
  const seen: { model?: string; effort?: unknown }[] = []
  engine(on, seen)
  provingDaemon(on, (url) => (url.endsWith('/v1/routing') ? { status: 200, text: JSON.stringify({ rules: [{ id: 'Bad Id' }] }) } : { status: 200, text: '{}' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await runTurn($, 't1', "Fix the typo in the word 'helo'")
  expect(seen[0]).toEqual({ model: 'haiku', effort: 'low' })
  const status = await $.command.run({ command: 'route', args: '' } as never)
  expect(String((status as { text: string }).text)).toContain('(shipped with the build)')
})

test(
  'records go to the daemon with the token and leave the buffer',
  { options: { defaultMode: 'auto', daemonToken: 'b'.repeat(64), daemonUrl: 'http://127.0.0.1:3101' } },
  async ($, on) => {
    engine(on, [])
    const sent: { url: string; auth?: string; count: number }[] = []
    provingDaemon(on, (url, init) => {
      if (url.endsWith('/v1/routing')) return { status: 404, text: '{}' }
      const body = JSON.parse(String(init?.body ?? '{}')) as { records: unknown[] }
      sent.push({ url, auth: init?.headers?.authorization, count: body.records.length })
      return { status: 200, text: '{"accepted":1,"duplicates":0,"rejected":[]}' }
    })
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await runTurn($, 't1', "Fix the typo in the word 'helo'")
    expect(sent).toEqual([{ url: 'http://127.0.0.1:3101/v1/records', auth: `Bearer ${'b'.repeat(64)}`, count: 1 }])
    const status = await $.command.run({ command: 'route', args: '' } as never)
    expect(String((status as { text: string }).text)).toContain('(0 buffered)')
  },
)

test('a listener that cannot prove the token never receives it or the records', { options: { defaultMode: 'auto', daemonToken: 'b'.repeat(64) } }, async ($, on) => {
  engine(on, [])
  const posts: string[] = []
  on('http.fetch', (_, e) => {
    if (e.init?.method === 'POST') posts.push(e.url)
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ service: 'smart-model-router', proof: 'f'.repeat(64) }) } }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await runTurn($, 't1', "Fix the typo in the word 'helo'")
  expect(posts).toEqual([])
  const status = await $.command.run({ command: 'route', args: '' } as never)
  expect(String((status as { text: string }).text)).toContain('(1 buffered)')
})

test('without a daemon the records stay buffered and the turn is unaffected', { options: { defaultMode: 'auto', daemonToken: 'b'.repeat(64) } }, async ($, on) => {
  const seen: { model?: string; effort?: unknown }[] = []
  engine(on, seen)
  on('http.fetch', () => {
    throw new Error('ECONNREFUSED')
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await runTurn($, 't1', "Fix the typo in the word 'helo'")
  expect(seen[0]).toEqual({ model: 'haiku', effort: 'low' })
  const status = await $.command.run({ command: 'route', args: '' } as never)
  expect(String((status as { text: string }).text)).toContain('(1 buffered)')
})
