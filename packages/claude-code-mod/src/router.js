'use strict';

const core = require('@smr/core');
const { tokensOf, addTokens, contextTokensAfter } = require('./usage');

const AGENT_ID = 'claude-code';

/**
 * What the Claude Code mod can do, as verified against Claude Code 2.1.327+
 * (docs/spike-claude-code.md, docs/claude-code-integration.md). Startup selection and
 * prompt-level routing are not used: turn-level routing covers both.
 */
const CAPABILITIES = Object.freeze({
  startupModelSelection: false,
  promptLevelRouting: false,
  turnLevelRouting: true,
  subagentRouting: true,
  effortControl: true,
  usageTracking: true,
  slashCommands: true,
  modelDiscovery: true,
  sessionContext: true,
});

/** The AI classifier runs on the session's own access, on the cheapest model. */
const CLASSIFIER_CALL = Object.freeze({ model: 'haiku', maxTokens: 300, effort: 'low' });
const MAX_TRACE = 20;

/**
 * The routing side of the Claude Code mod: pure functions over immutable state, so the
 * mod's hooks only move values between Claude Code and here. Holds no prompt text.
 *
 * @param {{ data: { providers: unknown[], models: unknown[], pricing: unknown[] }, rules?: unknown[] }} input
 */
function createRouter({ data, rules = [] }) {
  const registry = core.createRegistry(data);
  const compiledRules = core.compileRules(rules);
  const agent = Object.freeze({ id: AGENT_ID, capabilities: CAPABILITIES });

  /** Registry id for a name Claude Code reports (`opus`, `claude-opus-5-5`, `claude-opus-5-5[1m]`). */
  function modelIdOf(name) {
    if (typeof name !== 'string' || name.length === 0) return null;
    const plain = name.replace(/\[[^\]]*\]$/, '');
    return registry.fromAgentModelName(AGENT_ID, plain)?.id ?? null;
  }

  function newSession(sessionId, subagentId = null) {
    return core.createSessionState({ sessionId, agentId: AGENT_ID, subagentId });
  }

  /** The `$.model.complete` request for the AI classifier, built from the core's request. */
  function classifierCall(request, settings) {
    return Object.freeze({
      ...CLASSIFIER_CALL,
      system: request.system,
      prompt: request.prompt,
      timeoutMs: settings.classifier.timeoutMs,
    });
  }

  /**
   * Classifies a turn: rules first, the AI classifier only when settings allow it and the
   * rules are unsure. `complete` sends a classifier call and resolves to its text.
   *
   * @param {{ text: string, state: object, settings: object, complete?: (call: object) => Promise<string> }} input
   */
  function classify({ text, state, settings, complete }) {
    const aiClassifier = typeof complete === 'function' ? (request) => complete(classifierCall(request, settings)) : undefined;
    return core.classifyHybrid({ text, contextTokens: state.contextTokens }, { settings, aiClassifier });
  }

  /**
   * Decides one main-session turn. `observedModel` is the model Claude Code is about to use
   * (the first step's model); it stands in for the current model when none is known yet.
   */
  function decideTurn({ state, settings, text, classified, ids, createdAt, observedModel }) {
    const session = state.currentModel ? state : Object.freeze({ ...state, currentModel: modelIdOf(observedModel) });
    const result = core.decide({ ids, createdAt, agent, settings, registry, rules: compiledRules, session, text, classified });
    return toPlan(result);
  }

  /**
   * Decides the model of a subagent from its task. Skipped when the call named a model
   * (the caller chose deliberately) or for a fork (Claude Code ignores the model there).
   * Manual session overrides do not reach subagents.
   *
   * @param {{ settings: object, sessionId: string, prompt: string, model?: string, subagentType: string, ids: object, createdAt: string }} input
   */
  function decideSubagent({ settings, sessionId, prompt, model, subagentType, ids, createdAt }) {
    if (typeof model === 'string' && model.length > 0) return skipped('the call names its own model');
    if (subagentType === 'fork') return skipped('a fork always runs on its parent model');
    if (settings.routing.mode === 'off') return skipped('router is off');
    // A subagent starts with an empty context: no cache to lose by picking any model.
    const session = core.withContext(newSession(sessionId, ids.decisionId), 0);
    const result = core.decide({ ids, createdAt, agent, settings, registry, rules: compiledRules, session, text: prompt });
    return toPlan(result);
  }

  function toPlan(result) {
    const decision = result.decision;
    const agentModel = decision && result.shouldApply ? registry.agentModelId(decision.selection.model, AGENT_ID) : null;
    const shouldApply = Boolean(agentModel);
    return Object.freeze({
      decision,
      shouldApply,
      agentModel,
      agentEffort: shouldApply ? decision.selection.effort : null,
      trace: result.trace.slice(0, MAX_TRACE),
      skipReason: decision ? null : 'router error and no current model to keep',
    });
  }

  /**
   * Closes a turn with what Claude Code reported, step by step.
   *
   * - applied: the router asked for a model and every step answered with it;
   * - failed: it asked and some step answered with another model;
   * - unverified: it asked but no step reported usage (aborted early) — status unchanged.
   *
   * Effort cannot be read back from Claude Code, so `appliedEffort` is the level the step
   * was sent with, not a confirmation.
   *
   * @param {{ state: object | null, plan: object, steps: { usage?: object | null }[] }} input
   * @returns {{ state: object | null, record: object }}
   */
  function finishTurn({ state, plan, steps }) {
    const { decision } = plan;
    const answered = [...new Set(steps.map((step) => step.usage?.model).filter((name) => typeof name === 'string'))];
    const answeredIds = answered.map(modelIdOf);
    const verified = answered.length > 0;
    const applied = plan.shouldApply && verified && answeredIds.every((id) => id === decision.selection.model);
    const status = !plan.shouldApply || !verified ? decision.status : applied ? 'applied' : 'failed';
    const perStep = steps.map((step) => tokensOf(step.usage));
    const record = Object.freeze({
      decision: Object.freeze({
        ...decision,
        status,
        appliedModel: answered.at(-1) ?? null,
        appliedEffort: applied ? decision.selection.effort : null,
        estimatedCostUsd: costOf(steps, decision.createdAt),
      }),
      verified,
      answeredBy: answered,
      steps: steps.length,
      tokens: addTokens(perStep),
      costComplete: steps.length > 0 && steps.every((step) => Boolean(step.usage)),
      trace: plan.trace,
    });
    return { state: state ? nextState(state, record.decision, { applied, verified }, steps) : null, record };
  }

  function nextState(state, decision, { applied, verified }, steps) {
    const after = core.afterDecision(state, decision, applied);
    // A once-override is spent only by a turn that ran: an aborted turn keeps it.
    const moved = verified ? after : Object.freeze({ ...after, override: state.override });
    const last = steps.findLast((step) => step.usage);
    const answeredId = modelIdOf(last?.usage?.model);
    const withModel = answeredId ? Object.freeze({ ...moved, currentModel: answeredId }) : moved;
    const context = contextTokensAfter(last?.usage);
    return context === null ? withModel : core.withContext(withModel, context);
  }

  /**
   * Sum over steps, each priced by the model that answered it. Null when any part is
   * unknown, including a step that reported no usage: a partial sum would read as exact.
   */
  function costOf(steps, createdAt) {
    if (steps.length === 0 || steps.some((step) => !step.usage)) return null;
    const priced = steps;
    const day = createdAt.slice(0, 10);
    let total = 0;
    for (const step of priced) {
      const modelId = modelIdOf(step.usage.model);
      const cost = modelId ? core.estimateCostUsd(tokensOf(step.usage), registry.pricingFor(modelId, day)) : null;
      if (cost === null) return null;
      total += cost;
    }
    return Math.round(total * 1e6) / 1e6;
  }

  /** Models a person can name in `/route <model>`: enabled ones Claude Code can run. */
  function manualModels() {
    return registry.candidatesFor(AGENT_ID).map((model) => ({ id: model.id, name: model.agentModelIds[AGENT_ID], efforts: model.supportedEffort }));
  }

  /** The registry model a `/route` word names, when Claude Code can run it; else null. */
  function resolveManual(word) {
    const model = registry.resolve(word) ?? registry.fromAgentModelName(AGENT_ID, word);
    return model && registry.candidatesFor(AGENT_ID).some((c) => c.id === model.id) ? model : null;
  }

  return Object.freeze({
    agentId: AGENT_ID,
    capabilities: CAPABILITIES,
    registry,
    modelIdOf,
    newSession,
    classifierCall,
    classify,
    decideTurn,
    decideSubagent,
    finishTurn,
    manualModels,
    resolveManual,
    /** The registry tier of a model id, or null: tells an upgrade from a downgrade. */
    tierOf: (id) => registry.resolve(id)?.tier ?? null,
  });
}

function skipped(reason) {
  return Object.freeze({ decision: null, shouldApply: false, agentModel: null, agentEffort: null, trace: [], skipReason: reason });
}

module.exports = { createRouter, AGENT_ID, CAPABILITIES };
