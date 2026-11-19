'use strict';

const { RoutingDecisionSchema, parseOrThrow } = require('@smr/shared');
const { classifyByRules } = require('./classify-rules');
const { evaluateRules } = require('./rules');
const { desiredEffort, clampEffort } = require('./effort');
const { relativeCosts } = require('./cost');
const { scoreCandidates, requiredTier } = require('./scoring');
const { contextLoad, contextUtilization } = require('./session');
const { round, truncate } = require('./util');

const MAX_REASON = 500;
const MAX_ALTERNATIVES = 3;

/**
 * Picks the model and effort for one turn (main agent or one subagent).
 *
 * Order (master prompt, ADR-010): manual override > custom rule > automatic scoring,
 * with sticky routing able to keep the current model. Never throws: any failure yields a
 * `fallback` decision that keeps the current model and applies nothing.
 *
 * `shouldApply` tells the caller to have the adapter apply the selection; the decision's
 * status stays `recommended` until the caller records what the adapter answered
 * (applied / failed). Holds no prompt text: `text` is read, never returned.
 *
 * @param {{
 *   ids: { decisionId: string, turnId?: string | null },
 *   createdAt: string,
 *   agent: { id: string, capabilities: object },
 *   settings: object,
 *   registry: object,
 *   rules?: readonly object[],
 *   session: object,
 *   text?: string,
 *   classified?: { classification: object, source: string },
 * }} input
 * @returns {{ decision: object | null, shouldApply: boolean, trace: string[] }}
 */
function decide(input) {
  try {
    return decideOrThrow(input);
  } catch (error) {
    return fallback(input, error);
  }
}

function decideOrThrow(input) {
  const { settings, registry, session, agent } = input;
  const trace = [];
  const candidates = registry.candidatesFor(agent.id);
  if (candidates.length === 0) throw new Error(`no enabled model for agent ${agent.id}`);
  // The adapter may report a native name (`sonnet`) instead of a registry id.
  const current = session.currentModel
    ? (registry.get(session.currentModel) ?? registry.fromAgentModelName(agent.id, session.currentModel))
    : null;
  const classified = input.classified ?? {
    ...classifyByRules({ text: input.text, contextTokens: session.contextTokens }),
    source: 'classifier-rules',
  };
  const { classification } = classified;

  if (settings.routing.mode === 'off') {
    const model = current ?? candidates[0];
    return finish(input, { model, effort: null, source: 'default', classification, alternatives: [] }, ['router is off'], trace, {
      status: 'skipped',
      shouldApply: false,
    });
  }

  const choice = choose({ input: { ...input, session: { ...session, currentModel: current?.id ?? null } }, candidates, current, classified, trace });
  const effort = chooseEffort(choice, classification, trace);
  if (!agent.capabilities.effortControl && effort.effort) trace.push(`${agent.id} cannot set effort; effort is advisory`);
  const outcome = applyOutcome(settings.routing.mode, choice.source, agent, trace);
  return finish(input, { ...choice, effort: effort.effort, classification }, [...choice.reasons, ...effort.reasons], trace, outcome);
}

/** Override, then rule, then scoring with sticky routing. */
function choose({ input, candidates, current, classified, trace }) {
  const { settings, registry, session, agent } = input;
  const { classification } = classified;
  const inCandidates = (model) => Boolean(model) && candidates.some((c) => c.id === model.id);

  const rules = evaluateRules(input.rules ?? [], {
    classification,
    text: typeof input.text === 'string' ? input.text : '',
    agentId: agent.id,
    contextUtilization: current ? contextUtilization(session, current) : null,
  });
  if (rules.matched.length > 0) trace.push(`rules matched: ${rules.matched.join(', ')}`);

  const needed = requiredTier(classification);
  const mustUpgrade =
    current !== null &&
    current.tier !== null &&
    (classification.risk === 'high' || classification.reasoning === 'high') &&
    current.tier < Math.round(needed);
  const costs = relativeCosts(candidates, (id) => registry.pricingFor(id));
  const scoreInput = {
    candidates,
    classification,
    weights: settings.routing.weights,
    costs: costs.byModel,
    currentId: current?.id ?? null,
    contextLoad: contextLoad(session),
    exemptFromTransitionAtTier: mustUpgrade ? Math.round(needed) : null,
  };
  const scored = scoreCandidates(scoreInput);
  /** The ranking with switching free: tells whether switch cost alone kept the current model. */
  const scoredFreeSwitch = current ? scoreCandidates({ ...scoreInput, currentId: null }) : scored;
  trace.push(`required tier ${round(needed, 2)}; cost basis ${costs.basis}`);
  const alternativesFor = (model) => alternatives(scored, model.id);

  const override = session.override ? registry.resolve(session.override.model) : null;
  if (session.override && !inCandidates(override)) trace.push(`override ${session.override.model} ignored: not available to ${agent.id}`);
  if (inCandidates(override)) {
    return pick(override, 'manual', [`manual override: ${override.id}`], alternativesFor(override), {
      effortHint: session.override.effort,
    });
  }

  const ruleModel = rules.model ? registry.resolve(rules.model.value) : null;
  if (rules.model && !inCandidates(ruleModel)) trace.push(`rule ${rules.model.ruleId} names ${rules.model.value}, not available; ignored`);
  if (inCandidates(ruleModel)) {
    return pick(ruleModel, 'rule', [`rule ${rules.model.ruleId}`], alternativesFor(ruleModel), { effortRule: rules.effort });
  }

  if (mustUpgrade) {
    return upgrade({ scored, current, neededTier: Math.round(needed), classified, rules, alternativesFor });
  }
  // The first routed turn of a session has no earlier choice to hold on to.
  const routedBefore = (session.turns ?? 0) > 0;
  return automatic({ scored, scoredFreeSwitch, current, inCandidates, classified, rules, settings, alternativesFor, routedBefore });
}

/**
 * High-risk or high-reasoning work on a model below the needed tier: sticky routing and
 * switch cost never keep it there (AC-7). Best-scoring model at or above the needed tier,
 * else the strongest available.
 */
function upgrade({ scored, current, neededTier, classified, rules, alternativesFor }) {
  if (scored.length === 0) throw new Error('no candidate model has a tier for automatic routing');
  const strongEnough = scored.filter((entry) => entry.model.tier >= neededTier);
  const target = strongEnough[0] ?? [...scored].sort((a, b) => b.model.tier - a.model.tier)[0];
  const reachesTier = target.model.tier >= neededTier;
  // Say what actually happened: staying on the strongest model is not an upgrade.
  const why =
    target.model.id === current.id
      ? `needs tier ${neededTier}; ${current.id} is the strongest available, kept`
      : reachesTier
        ? `upgrade from ${current.id} required (tier ${neededTier}); sticky routing bypassed`
        : `upgrade from ${current.id} required (tier ${neededTier}; none available, strongest taken); sticky routing bypassed`;
  return pick(
    target.model,
    classified.source,
    [`${describe(classified.classification)} → ${target.model.id}`, why],
    alternativesFor(target.model),
    { effortRule: rules.effort },
  );
}

function describe(c) {
  return `${c.taskType}, complexity ${c.complexity}, risk ${c.risk}, confidence ${c.confidence}`;
}

function automatic({ scored, scoredFreeSwitch, current, inCandidates, classified, rules, settings, alternativesFor, routedBefore }) {
  const best = scored[0];
  if (!best) throw new Error('no candidate model has a tier for automatic routing');
  const why = describe(classified.classification);
  const effortRule = rules.effort;
  const stickyOn = settings.routing.sticky.enabled;

  const freeBest = scoredFreeSwitch[0];
  if (stickyOn && current && best.model.id === current.id && freeBest.model.id !== current.id) {
    return pick(current, 'sticky', [`kept ${current.id}: switching to ${freeBest.model.id} would re-read the context without cache (switch cost)`], alternativesFor(current), { effortRule });
  }

  if (inCandidates(current) && best.model.id !== current.id) {
    if (rules.avoidModelSwitch?.value) {
      return pick(current, 'sticky', [`kept ${current.id}: rule ${rules.avoidModelSwitch.ruleId} avoids model switches`], alternativesFor(current), { effortRule });
    }
    const currentScore = scored.find((entry) => entry.model.id === current.id);
    const gain = currentScore ? round(best.score - currentScore.score) : Infinity;
    // minScoreGain stops flip-flopping between the router's own choices; the model a
    // session merely started on is not one, so the first turn goes to the best score
    // (the switch cost above still counts).
    // Only a move to a dearer model must clear minScoreGain: moving to a cheaper one
    // already paid its switch cost in the score, and holding it back twice kept sessions
    // on opus for work sonnet or haiku scored better on.
    const movesUp = (best.parts.cost ?? 0) > (currentScore?.parts.cost ?? 0);
    if (stickyOn && routedBefore && movesUp && gain < settings.routing.sticky.minScoreGain) {
      return pick(current, 'sticky', [`kept ${current.id}: ${best.model.id} better by only ${gain} (< ${settings.routing.sticky.minScoreGain})`], alternativesFor(current), { effortRule });
    }
  }
  return pick(best.model, classified.source, [`${why} → ${best.model.id} (score ${best.score})`], alternativesFor(best.model), { effortRule });
}

function pick(model, source, reasons, alts, extra = {}) {
  return { model, source, reasons, alternatives: alts, effortHint: extra.effortHint ?? null, effortRule: extra.effortRule ?? null };
}

function alternatives(scored, chosenId) {
  return scored
    .filter((entry) => entry.model.id !== chosenId)
    .slice(0, MAX_ALTERNATIVES)
    .map((entry) => ({
      model: entry.model.id,
      score: entry.score,
      reason: `quality ${entry.parts.quality}, cost ${entry.parts.cost}, latency ${entry.parts.latency}, switch ${entry.parts.transition}`,
    }));
}

/** Manual effort > rule effort > the classification's; then limited to the model (AC-4). */
function chooseEffort(choice, classification, trace) {
  const desired = choice.effortHint ?? choice.effortRule?.value ?? desiredEffort(classification);
  const { effort, clamped } = clampEffort(desired, choice.model.supportedEffort);
  const reasons = [];
  if (choice.effortRule && !choice.effortHint) reasons.push(`effort by rule ${choice.effortRule.ruleId}`);
  if (clamped) {
    const note = effort ? `effort ${desired} → ${effort} (model limit)` : `effort ${desired} dropped: ${choice.model.id} takes no effort`;
    reasons.push(note);
    trace.push(note);
  }
  return { effort, reasons };
}

/** Shadow records only; auto and manual apply, when the agent can (AC-8). */
function applyOutcome(mode, source, agent, trace) {
  const wantsApply = source === 'manual' || mode === 'auto';
  if (!wantsApply) return { status: 'recommended', shouldApply: false };
  const canApply = agent.capabilities.turnLevelRouting === true || agent.capabilities.promptLevelRouting === true;
  if (!canApply) {
    trace.push(`${agent.id} cannot switch models during a session; recommendation only`);
    return { status: 'unsupported', shouldApply: false };
  }
  return { status: 'recommended', shouldApply: true };
}

function finish(input, choice, reasons, trace, outcome) {
  const decision = parseOrThrow(
    RoutingDecisionSchema,
    {
      id: input.ids.decisionId,
      sessionId: input.session.sessionId,
      turnId: input.ids.turnId ?? null,
      agentId: input.agent.id,
      subagentId: input.session.subagentId ?? null,
      mode: input.settings.routing.mode,
      classification: choice.classification,
      selection: { model: choice.model.id, effort: choice.effort },
      alternatives: choice.alternatives,
      reason: truncate(reasons.join('; '), MAX_REASON),
      decisionSource: choice.source,
      status: outcome.status,
      createdAt: input.createdAt,
    },
    'routing decision',
  );
  return { decision, shouldApply: outcome.shouldApply, trace };
}

/** Keeps the current model and applies nothing; null decision when even that is impossible. */
function fallback(input, error) {
  const message = truncate(String(error?.message ?? error), 200);
  const trace = [`router error: ${message}`];
  const result = RoutingDecisionSchema.safeParse({
    id: input?.ids?.decisionId,
    sessionId: input?.session?.sessionId,
    turnId: input?.ids?.turnId ?? null,
    agentId: input?.agent?.id,
    subagentId: input?.session?.subagentId ?? null,
    mode: input?.settings?.routing?.mode,
    selection: { model: input?.session?.currentModel },
    reason: truncate(`router error, current model kept: ${message}`, MAX_REASON),
    decisionSource: 'fallback',
    status: 'skipped',
    createdAt: input?.createdAt,
  });
  return { decision: result.success ? result.data : null, shouldApply: false, trace };
}

module.exports = { decide };
