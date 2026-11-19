import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { RouteEntry, RouteMode } from '../types'
import core from '../lib/core.mjs'

// Feasibility spike for Smart Model Router (ADR-002/003/010).
// Default mode comes from userConfig (`shadow` unless set): the router only records what it would pick.
const modeRef = { plugin: 'smr-spike', key: 'mode' } as const
const override = atom({ plugin: 'smr-spike', key: 'override' } as const, '', { shape: 'override-1' })
const log = atom({ plugin: 'smr-spike', key: 'log' } as const, [] as RouteEntry[], { shape: 'log-1' })

const MODES: readonly RouteMode[] = ['shadow', 'auto', 'off']
const MAX_LOG = 50
const MAX_OPEN_TURNS = 200

type OpenTurn = {
  entry: RouteEntry
  effort?: 'low' | 'medium' | 'high'
  answered: Set<string>
}

// Keyed by turnId: one entry per running turn, removed at turn.complete.
const openTurns = new Map<string, OpenTurn>()

function describe(entries: readonly RouteEntry[]): string {
  if (entries.length === 0) return 'No routed turns yet.'
  return entries
    .slice(-10)
    .map((r) => {
      const who = r.agentId ? `subagent ${r.agentId.slice(0, 8)}` : 'main'
      const did = r.applied ? 'APPLIED' : 'recommended'
      return `[${r.mode}] ${who}: ${did} ${r.recommendedModel}${r.recommendedEffort ? `/${r.recommendedEffort}` : ''} (${r.reason}); session model ${r.requestedModel}; answered by ${r.answeredBy ?? '?'}; steps ${r.steps}`
    })
    .join('\n')
}

export const register: Register = (on, options) => {
  const configured = String(options.defaultMode ?? 'shadow')
  const initialMode: RouteMode = (MODES as readonly string[]).includes(configured) ? (configured as RouteMode) : 'shadow'
  const mode = atom(modeRef, initialMode, { shape: 'mode-1' })

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'route',
      description: 'Model router spike: /route [auto|shadow|off|haiku|sonnet|opus|clear|explain]',
    })
    return next(e)
  })

  on('command.run', { command: 'route' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if ((MODES as readonly string[]).includes(arg)) {
      await update($, mode, () => arg as RouteMode)
      return { text: `router mode: ${arg}`, isTextDisplayOnly: true }
    }
    if (core.MANUAL_MODELS.includes(arg)) {
      await update($, override, () => arg)
      return { text: `manual override: ${arg} (applies from the next turn; /route clear to remove)`, isTextDisplayOnly: true }
    }
    if (arg === 'clear') {
      await update($, override, () => '')
      return { text: 'manual override cleared', isTextDisplayOnly: true }
    }
    const current = await read($, mode)
    const ov = await read($, override)
    const entries = await read($, log)
    return {
      text: `mode: ${current}; override: ${ov || 'none'}\n${describe(entries)}`,
      isTextDisplayOnly: true,
    }
  })

  on('turn.start', async ($, e, next) => {
    const current = await read($, mode)
    const ov = await read($, override)
    const decision = core.decide(e.text, { override: ov || undefined })
    const applied = current !== 'off' && (decision.source === 'manual' || current === 'auto')
    if (openTurns.size >= MAX_OPEN_TURNS) openTurns.clear()
    openTurns.set(e.turnId, {
      effort: decision.effort,
      answered: new Set(),
      entry: {
        turnId: e.turnId,
        agentId: e.agentId,
        mode: current,
        source: decision.source,
        reason: decision.reason,
        requestedModel: '',
        recommendedModel: decision.model,
        recommendedEffort: decision.effort,
        applied,
        steps: 0,
      },
    })
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const open = openTurns.get(e.turnId)
    if (!open) return yield* next(e)

    if (e.index === 0) open.entry = { ...open.entry, requestedModel: e.model }
    const sent = open.entry.applied
      ? { ...e, model: open.entry.recommendedModel, ...(open.effort ? { effort: open.effort } : {}) }
      : e
    const result = yield* next(sent)

    open.entry = { ...open.entry, steps: open.entry.steps + 1 }
    if (result.usage?.model) open.answered.add(result.usage.model)
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const open = openTurns.get(e.turnId)
    if (open) {
      openTurns.delete(e.turnId)
      const entry: RouteEntry = { ...open.entry, answeredBy: [...open.answered].join(',') || undefined }
      await update($, log, (list) => [...list, entry].slice(-MAX_LOG))
      if (!entry.agentId) {
        $.ui.status(`router[${entry.mode}] ${entry.applied ? '→' : '≈'} ${entry.recommendedModel} · answered ${entry.answeredBy ?? '?'}`)
      }
    }
    return done
  })
}
