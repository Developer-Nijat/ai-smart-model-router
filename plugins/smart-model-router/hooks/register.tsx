import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { LiveMessage, RouteMode, SessionState, TurnRecord } from '../types'
import smr from '../lib/router.mjs'
import type { Classified, ClassifierCall, DaemonTarget, LiveChoice, Plan, Settings, StepObservation } from '../lib/router.mjs'

// Smart Model Router for Claude Code (docs/claude-code-integration.md).
// All routing logic lives in lib/router.mjs (packages/claude-code-mod/src, tested with
// vitest); this module only moves values between Claude Code's hooks and the router.
//
// Rules every hook follows:
// - routing never breaks a turn: any router or bookkeeping error falls through to the
//   engine unchanged (next(e) stays outside the try, so it runs exactly once);
// - no prompt text is stored: a turn keeps it in memory until its model is decided.

const MAX_LOG = 50
const MAX_OPEN = 200
const MAX_STORED = 500
const STORE_KEY = 'pending-records'
const ROUTING_KEY = 'daemon-routing'
/** Limits on what the daemon may hand us: rules run on every turn and live in $.store. */
const MAX_ROUTING_RULES = 500
const MAX_ROUTING_BYTES = 1_000_000
const ROUTE_NOTE =
  'The person ran /route, a command handled by the smart-model-router plugin (it picks the model and effort per turn). ' +
  'Its output was shown to them already. It is not a skill and needs nothing from you: do not mention it.'

const sessionAtom = atom({ plugin: 'smart-model-router', key: 'session' } as const, null as SessionState | null, { shape: 'session-1' })
const logAtom = atom({ plugin: 'smart-model-router', key: 'log' } as const, [] as TurnRecord[], { shape: 'log-1' })
const liveAtom = atom({ plugin: 'smart-model-router', key: 'live' } as const, null as LiveMessage | null, { shape: 'live-1' })

/** Theme colors for each kind of live message: cheaper is good news, dearer a heads-up. */
const TONE_COLOR: Record<LiveMessage['tone'], string> = {
  down: 'success',
  up: 'warning',
  same: 'suggestion',
  stay: 'inactive',
  shadow: 'subtle',
  manual: 'permission',
  rule: 'merged',
  subagent: 'claude',
}

/** userConfig `liveMessages`: transcript line and band (on), band only, or nothing. */
let liveChoice: LiveChoice = 'on'

/**
 * Shows a routing decision while its turn runs: the band above the prompt, the status
 * line and (with `on`) a line in the transcript. Labels and scores only, never the prompt.
 */
async function announce($: EngineInterface, message: LiveMessage): Promise<void> {
  if (liveChoice === 'off') return
  await update($, liveAtom, () => message)
  $.ui.status(`router ${message.icon} ${message.title}`)
  if (liveChoice === 'on') $.ui.log(message.line, { to: 'transcript' })
}

let router = smr.createRouter({ data: smr.DATA, rules: smr.RULES })
/** Where the rules in force came from: the build, the daemon, or the daemon's last copy. */
let rulesSource: 'shipped' | 'daemon' | 'saved' = 'shipped'
let rulesCount: number = smr.RULES.length
/** Scoring tuning from the daemon (`{ sticky, weights }`), or null for the defaults. */
let tuning: unknown = null

/**
 * Routes with the daemon's rules and tuning from now on when the rules are valid;
 * otherwise keeps the current ones. Tuning is checked where it is applied (withTuning).
 */
function useRouting(routing: unknown, source: 'daemon' | 'saved'): boolean {
  const { rules, tuning: next } = (routing ?? {}) as { rules?: unknown; tuning?: unknown }
  if (!Array.isArray(rules) || rules.length > MAX_ROUTING_RULES) return false
  try {
    router = smr.createRouter({ data: smr.DATA, rules })
  } catch {
    return false
  }
  rulesSource = source
  rulesCount = rules.length
  tuning = next ?? null
  return true
}

type OpenTurn = {
  kind: 'main' | 'subagent'
  settings: Settings
  createdAt: string
  text?: string
  classified?: Classified
  plan?: Plan
  steps: readonly StepObservation[]
}

type SubagentPlan = { plan: Plan; settings: Settings; createdAt: string }

/** Running turns by turnId; removed at turn.complete. */
const openTurns = new Map<string, OpenTurn>()
/** Subagent plans by the subagent's agentId, until its first turn starts. */
const subagentPlans = new Map<string, SubagentPlan>()
/**
 * Spawns whose subagent has not started yet, by spawn id. The engine may start the
 * subagent's turn before the spawn hook learns its agentId, so a turn whose agentId is
 * unknown takes the pending spawn with the same task. The task text is dropped with it.
 */
const pendingSpawns = new Map<string, SubagentPlan & { prompt: string }>()

function bounded<K, V>(map: Map<K, V>, key: K, value: V): void {
  if (!map.has(key) && map.size >= MAX_OPEN) map.delete(map.keys().next().value as K)
  map.set(key, value)
}

/** One write at a time: turns and subagents finish concurrently and share the log and store. */
let writes: Promise<unknown> = Promise.resolve()
function serial<T>(work: () => Promise<T>): Promise<T> {
  const run = writes.then(work, work)
  writes = run.catch(() => undefined)
  return run
}

async function sessionId($: EngineInterface): Promise<string> {
  return String(await $.session.id())
}

async function nowIso($: EngineInterface): Promise<string> {
  return new Date(await $.clock.now()).toISOString()
}

async function sessionState($: EngineInterface): Promise<SessionState> {
  const id = await sessionId($)
  const stored = await read($, sessionAtom)
  return stored && stored.sessionId === id ? stored : router.newSession(id)
}

async function record($: EngineInterface, rec: TurnRecord): Promise<void> {
  await update($, logAtom, (list) => [...list, rec].slice(-MAX_LOG))
  // Buffer for the local daemon (Phase 4) to collect; capped so it never grows unbounded.
  const pending = await $.store.get(STORE_KEY)
  await $.store.set(STORE_KEY, [...(Array.isArray(pending) ? pending : []), rec].slice(-MAX_STORED))
}

const SEND_TIMEOUT_MS = 3000

/** Why the last send did not go through; shown by /route. Null after a good send. */
let lastSendProblem: string | null = null
let sending = false

/** A daemon that accepts the connection and never answers must not hold up the turn. */
function withTimeout<T>($: EngineInterface, work: Promise<T>): Promise<T> {
  const timeout = $.clock.sleep(SEND_TIMEOUT_MS).then((): T => {
    throw new Error('timeout')
  })
  return Promise.race([work, timeout])
}

/**
 * Sends the oldest buffered records to the local daemon (ADR-003). The daemon first
 * proves it holds the token (HMAC over a fresh nonce), so the token is never sent to
 * whatever else might listen on the port. A daemon that is down is normal: the records
 * stay buffered and go with a later turn.
 */
async function flush($: EngineInterface, target: DaemonTarget): Promise<void> {
  if (!('endpoint' in target) || sending) return
  sending = true
  try {
    const batch = smr.nextBatch<TurnRecord>(await $.store.get(STORE_KEY))
    if (batch.length === 0) return
    if (!(await daemonProves($, target))) {
      lastSendProblem = 'the program on the daemon port did not prove it is the daemon; records kept'
      return
    }
    const response = await withTimeout(
      $,
      $.http.fetch(target.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${target.token}` },
        body: JSON.stringify({ records: batch }),
      }),
    )
    if (!response.ok) {
      lastSendProblem = smr.describeFailure(response.status)
      return
    }
    lastSendProblem = null
    await serial(async () => {
      const now = await $.store.get(STORE_KEY)
      await $.store.set(STORE_KEY, smr.afterSend<TurnRecord>(Array.isArray(now) ? now : [], batch, response))
    })
  } finally {
    sending = false
  }
}

/** True when the daemon answers a fresh nonce with an HMAC made with our token. */
async function daemonProves($: EngineInterface, target: { base: string; token: string }): Promise<boolean> {
  const nonce = smr.newNonce((bytes) => crypto.getRandomValues(bytes))
  const digest = (data: Uint8Array) => crypto.subtle.digest('SHA-256', data)
  const health = await withTimeout($, $.http.fetch(smr.healthUrl(target, nonce)))
  return health.ok && (await smr.verifyHealth(health.text, target, nonce, digest))
}

/**
 * The rules and scoring tuning in force: what the daemon serves (shipped rules plus the
 * user's, and routing.sticky/weights, edited in the dashboard), else the copy saved from
 * the daemon last time, else the build's. Invalid rules never replace valid ones.
 */
async function loadRouting($: EngineInterface, target: DaemonTarget): Promise<void> {
  if (!('endpoint' in target)) return
  try {
    if (rulesSource === 'shipped') useRouting(await $.store.get(ROUTING_KEY), 'saved')
    if (!(await daemonProves($, target))) return
    const response = await withTimeout(
      $,
      $.http.fetch(`${target.base}/v1/routing`, { method: 'GET', headers: { authorization: `Bearer ${target.token}` } }),
    )
    if (!response.ok || response.text.length > MAX_ROUTING_BYTES) return
    const routing = JSON.parse(response.text) as unknown
    if (useRouting(routing, 'daemon')) await $.store.set(ROUTING_KEY, routing)
  } catch {
    // Daemon down or slow: keep what is in force.
  }
}

/** Flushes, ignoring a daemon that is down or slow: buffering is the fallback. */
async function flushQuietly($: EngineInterface, target: DaemonTarget): Promise<void> {
  try {
    await flush($, target)
  } catch {
    lastSendProblem = 'daemon not reachable (mr start); records kept'
  }
}

/** A router or store failure is shown, never thrown into the user's turn. */
function warn($: EngineInterface, where: string, error: unknown): void {
  const name = error instanceof Error ? error.name : 'error'
  try {
    $.ui.status(`router: ${where} failed (${name}); turn left unrouted`)
  } catch {
    // The status line is best effort.
  }
}

function openSubagentTurn(turnId: string, agentId: string, text: string): void {
  let found: SubagentPlan | undefined = subagentPlans.get(agentId)
  if (found) subagentPlans.delete(agentId)
  else {
    const match = [...pendingSpawns.entries()].find(([, spawn]) => spawn.prompt === text)
    if (match) {
      pendingSpawns.delete(match[0])
      found = match[1]
    }
  }
  if (found) bounded(openTurns, turnId, { kind: 'subagent', settings: found.settings, createdAt: found.createdAt, plan: found.plan, steps: [] })
}

async function openMainTurn($: EngineInterface, turnId: string, text: string, settings: Settings): Promise<void> {
  if (settings.routing.mode === 'off') return
  const createdAt = await nowIso($)
  const state = await sessionState($)
  const complete = async (call: ClassifierCall): Promise<string> => {
    const r = await $.model.complete(call)
    if (r.isAnswered) return r.text
    throw new Error(r.reason === 'aborted' ? 'timeout' : 'provider-error')
  }
  const classified = await router.classify({ text, state, settings, complete })
  bounded(openTurns, turnId, { kind: 'main', settings, createdAt, text, classified, steps: [] })
}

/** The turn's plan; a main turn is decided on its first step, when the session model is known. */
async function planFor($: EngineInterface, turnId: string, observedModel: string): Promise<Plan | undefined> {
  const open = openTurns.get(turnId)
  if (!open) return undefined
  if (open.plan || open.kind !== 'main' || !open.classified) return open.plan
  const state = await sessionState($)
  const plan = router.decideTurn({
    state,
    settings: open.settings,
    text: open.text ?? '',
    classified: open.classified,
    ids: { decisionId: `${state.sessionId}:${turnId}`, turnId },
    createdAt: open.createdAt,
    observedModel,
  })
  // The prompt and its classification are not needed after the decision.
  openTurns.set(turnId, { ...open, text: undefined, classified: undefined, plan })
  if (plan.decision) {
    try {
      const message = smr.liveMessage({
        decision: plan.decision,
        applies: plan.shouldApply,
        previousModel: state.currentModel ?? router.modelIdOf(observedModel),
        tierOf: router.tierOf,
      })
      await announce($, message)
    } catch (error) {
      warn($, 'live message', error)
    }
  }
  return plan
}

export const register: Register = (on, options) => {
  // A reload starts from the build's rules; session.start fetches the daemon's again.
  router = smr.createRouter({ data: smr.DATA, rules: smr.RULES })
  rulesSource = 'shipped'
  rulesCount = smr.RULES.length
  tuning = null
  const { settings: baseSettings, warnings, live } = smr.settingsFromOptions(options)
  liveChoice = live
  const target = smr.daemonTarget(options)
  const modeAtom = atom({ plugin: 'smart-model-router', key: 'mode' } as const, baseSettings.routing.mode as RouteMode, { shape: 'mode-1' })

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'route',
        description: 'Smart Model Router: /route [auto|shadow|off|<model> [effort] [once]|clear|explain|stats|help]',
      })
    } catch (error) {
      warn($, '/route registration', error)
    }
    await loadRouting($, target)
    await flushQuietly($, target)
    return next(e)
  })

  // /clear starts an empty conversation: no context cache left to lose by switching.
  on('classic.SessionStart', async ($, e, next) => {
    try {
      if ((e as { source?: string }).source === 'clear') {
        await update($, sessionAtom, (stored) => (stored ? smr.afterClear(stored) : stored))
      }
    } catch (error) {
      warn($, '/clear', error)
    }
    return next(e)
  })

  on('command.run', { command: 'route' }, async ($, e) => {
    // The output is for the person; without a note the model sees "/route …" with no
    // result and reports it as a missing skill. The note is fixed text: nothing of the
    // output or the prompt goes into it.
    const say = (text: string) => ({ text, isTextDisplayOnly: true as const, context: [ROUTE_NOTE] })
    try {
      const cmd = smr.parseRouteCommand(e.args, router)
      if (cmd.kind === 'error') return say(cmd.message)
      if (cmd.kind === 'help') return say(smr.HELP)
      if (cmd.kind === 'mode') {
        await update($, modeAtom, () => cmd.mode)
        // Off routes nothing: the band would only show a stale decision.
        if (cmd.mode === 'off') {
          await update($, liveAtom, () => null)
          $.ui.status(undefined)
        }
        return say(`router mode: ${cmd.mode}`)
      }
      const records = await read($, logAtom)
      if (cmd.kind === 'explain') return say(smr.formatExplain(smr.lastMainRecord(records)))
      if (cmd.kind === 'stats') return say(smr.formatStats(records))
      const id = await sessionId($)
      const current = (stored: SessionState | null) => (stored && stored.sessionId === id ? stored : router.newSession(id))
      if (cmd.kind === 'clear') {
        await update($, sessionAtom, (stored) => smr.withOverride(current(stored), null))
        return say('manual override cleared')
      }
      if (cmd.kind === 'override') {
        const override = { model: cmd.model, effort: cmd.effort, scope: cmd.scope }
        await update($, sessionAtom, (stored) => smr.withOverride(current(stored), override))
        const when = cmd.scope === 'turn' ? 'next turn only' : 'until /route clear'
        return say(`manual override: ${cmd.model}${cmd.effort ? `/${cmd.effort}` : ''} (${when}; applies even in shadow mode)`)
      }
      const state = await sessionState($)
      const mode = await read($, modeAtom)
      const pending = await $.store.get(STORE_KEY)
      const buffered = Array.isArray(pending) ? pending.length : 0
      const daemon =
        'endpoint' in target
          ? `daemon: ${target.base} (${buffered} buffered)${lastSendProblem ? ` — ${lastSendProblem}` : ''}`
          : `daemon: off — ${target.disabled} (${buffered} buffered)`
      const rules = `rules: ${rulesCount} (${rulesSource === 'daemon' ? 'from the daemon' : rulesSource === 'saved' ? 'last copy from the daemon' : 'shipped with the build'})${tuning ? ', tuning from the daemon' : ''}`
      return say(`${smr.formatStatus({ mode, override: state.override, warnings, records })}
${daemon}
${rules}`)
    } catch (error) {
      return say(`router: /route failed (${error instanceof Error ? error.name : 'error'})`)
    }
  })

  // The band above the prompt: the turn's routing while it runs, dimmed once it is done.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const message = await read($, liveAtom)
    if (!message || liveChoice === 'off' || e.props.hasSurvey) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const working = e.props.isWorking
    const color = TONE_COLOR[message.tone] ?? 'text'
    return (
      <Box>
        <Text color={color} bold={working} dimColor={!working}>
          {message.icon}{' '}
        </Text>
        <Text dimColor>{working ? 'router ' : 'last turn '}</Text>
        <Text color={working ? color : undefined} bold={working} dimColor={!working}>
          {message.title}
        </Text>
        <Text dimColor> · {message.detail}</Text>
      </Box>
    )
  })

  on('turn.start', async ($, e, next) => {
    try {
      if (e.agentId) openSubagentTurn(e.turnId, e.agentId, e.text)
      else await openMainTurn($, e.turnId, e.text, smr.withTuning(smr.withMode(baseSettings, await read($, modeAtom)), tuning))
    } catch (error) {
      openTurns.delete(e.turnId)
      warn($, 'classification', error)
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    let sent = e
    try {
      const plan = await planFor($, e.turnId, e.model)
      if (plan?.shouldApply && plan.agentModel) {
        // Without an effort of its own the step must not carry the old model's level.
        const { effort: _old, ...rest } = e
        sent = plan.agentEffort ? { ...rest, model: plan.agentModel, effort: plan.agentEffort } : { ...rest, model: plan.agentModel }
      }
    } catch (error) {
      openTurns.delete(e.turnId)
      warn($, 'routing', error)
    }
    const result = yield* next(sent)
    const current = openTurns.get(e.turnId)
    if (current) openTurns.set(e.turnId, { ...current, steps: [...current.steps, { usage: result.usage }] })
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const open = openTurns.get(e.turnId)
    openTurns.delete(e.turnId)
    if (!open?.plan?.decision) return done
    const plan = open.plan
    try {
      await serial(async () => {
        if (open.kind === 'main') {
          const id = await sessionId($)
          let finished: TurnRecord | undefined
          // Computed inside the update, so a /route issued meanwhile is not overwritten.
          await update($, sessionAtom, (stored) => {
            const state = stored && stored.sessionId === id ? stored : router.newSession(id)
            const result = router.finishTurn({ state, plan, steps: open.steps })
            finished = result.record
            return result.state
          })
          if (finished) {
            await record($, finished)
            $.ui.status(smr.statusLine(finished))
          }
        } else {
          await record($, router.finishTurn({ state: null, plan, steps: open.steps }).record)
        }
      })
    } catch (error) {
      warn($, 'recording', error)
    }
    await flushQuietly($, target)
    return done
  })

  on('agent.spawn', async ($, e, next) => {
    let spawnKey: string | null = null
    let pending: (SubagentPlan & { prompt: string }) | null = null
    try {
      const settings = smr.withTuning(smr.withMode(baseSettings, await read($, modeAtom)), tuning)
      if (settings.routing.mode !== 'off') {
        const createdAt = await nowIso($)
        const id = await sessionId($)
        spawnKey = `${id}:spawn:${e.tool_use_id || createdAt}`
        const plan = router.decideSubagent({
          settings,
          sessionId: id,
          prompt: e.prompt,
          model: e.model,
          subagentType: e.subagentType,
          ids: { decisionId: spawnKey, turnId: null },
          createdAt,
        })
        if (plan.decision) {
          pending = { plan, settings, createdAt, prompt: e.prompt }
          bounded(pendingSpawns, spawnKey, pending)
          await announce($, smr.liveMessage({ decision: plan.decision, applies: plan.shouldApply, subagentType: e.subagentType }))
        }
      }
    } catch (error) {
      warn($, 'subagent routing', error)
      pending = null
    }

    const plan = pending?.plan
    const result = await next(plan?.shouldApply && plan.agentModel ? { ...e, model: plan.agentModel } : e)
    // Not yet taken by the subagent's first turn: hand it over by agentId.
    if (spawnKey && pending && pendingSpawns.get(spawnKey) === pending) {
      pendingSpawns.delete(spawnKey)
      if (result.agentId) bounded(subagentPlans, result.agentId, { plan: pending.plan, settings: pending.settings, createdAt: pending.createdAt })
    }
    return result
  })
}
