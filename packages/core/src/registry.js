'use strict';

const { ProviderSchema, ModelSchema, PricingSchema, parseOrThrow, ValidationError } = require('@smr/shared');
const { deepFreeze } = require('./util');

function indexUnique(items, label) {
  const index = new Map();
  for (const item of items) {
    if (index.has(item.id)) throw new ValidationError(`Duplicate ${label} id: ${item.id}`, [`id: ${item.id} repeated`]);
    index.set(item.id, item);
  }
  return index;
}

function buildAliasIndex(models) {
  const index = new Map();
  const claim = (name, modelId) => {
    const key = name.toLowerCase();
    const owner = index.get(key);
    if (owner && owner !== modelId) {
      throw new ValidationError(`Name "${name}" is used by both ${owner} and ${modelId}`, [`alias: ${name} ambiguous`]);
    }
    index.set(key, modelId);
  };
  for (const model of models) {
    claim(model.id, model.id);
    for (const alias of model.aliases) claim(alias, model.id);
  }
  return index;
}

/** Sorted newest first by `asOf`, grouped by model id. */
function buildPricingIndex(pricing, modelsById) {
  const index = new Map();
  for (const record of pricing) {
    if (!modelsById.has(record.modelId)) {
      throw new ValidationError(`Pricing for unknown model ${record.modelId}`, [`modelId: ${record.modelId} not in registry`]);
    }
    const list = index.get(record.modelId) ?? [];
    if (list.some((other) => other.asOf === record.asOf)) {
      throw new ValidationError(`Two prices for ${record.modelId} on ${record.asOf}`, ['asOf: duplicate']);
    }
    index.set(record.modelId, [...list, record].sort((a, b) => (a.asOf < b.asOf ? 1 : -1)));
  }
  return index;
}

/**
 * The model registry: providers, models and dated prices, validated once and frozen.
 * Independent of any agent: an agent reaches a model only through `agentModelIds`.
 *
 * @param {{ providers?: unknown[], models?: unknown[], pricing?: unknown[] }} [data]
 */
function createRegistry(data = {}) {
  const providers = (data.providers ?? []).map((p, i) => parseOrThrow(ProviderSchema, p, `provider #${i + 1}`));
  const models = (data.models ?? []).map((m, i) => parseOrThrow(ModelSchema, m, `model #${i + 1}`));
  const pricing = (data.pricing ?? []).map((p, i) => parseOrThrow(PricingSchema, p, `pricing #${i + 1}`));

  const providersById = indexUnique(providers, 'provider');
  const modelsById = indexUnique(models, 'model');
  for (const model of models) {
    if (!providersById.has(model.provider)) {
      throw new ValidationError(`Model ${model.id} names unknown provider ${model.provider}`, ['provider: unknown']);
    }
  }
  const aliases = buildAliasIndex(models);
  const prices = buildPricingIndex(pricing, modelsById);
  deepFreeze(providers);
  deepFreeze(models);
  deepFreeze(pricing);

  const isUsable = (model) => model.status === 'enabled' && providersById.get(model.provider).status === 'enabled';

  /** @returns the model named by a registry id or any alias (case-insensitive), or null */
  function resolve(name) {
    if (typeof name !== 'string' || name.length === 0) return null;
    const id = aliases.get(name.toLowerCase());
    return id ? modelsById.get(id) : null;
  }

  return Object.freeze({
    providers: () => providers,
    models: () => models,

    /** @returns the model with exactly this registry id, or null */
    get: (id) => modelsById.get(id) ?? null,

    resolve,

    /** True when the model is enabled and so is its provider. */
    isUsable: (model) => Boolean(model) && isUsable(model),

    /** Enabled models (of enabled providers) that `agentId` can run, strongest last. */
    candidatesFor(agentId) {
      return models
        .filter((model) => isUsable(model) && typeof model.agentModelIds[agentId] === 'string')
        .sort((a, b) => (a.tier ?? 0) - (b.tier ?? 0) || (a.id < b.id ? -1 : 1));
    },

    /** How `agentId` names the model, e.g. `sonnet` for Claude Code; null when it cannot run it. */
    agentModelId: (modelId, agentId) => modelsById.get(modelId)?.agentModelIds[agentId] ?? null,

    /**
     * Maps a name an agent reports (`opus`, `claude-opus-5-5`) back to a registry model.
     * @returns the model, or null when the name is unknown
     */
    fromAgentModelName(agentId, name) {
      if (typeof name !== 'string') return null;
      const direct = models.find((model) => model.agentModelIds[agentId] === name);
      return direct ?? resolve(name);
    },

    /**
     * The price in force on `onDate` (YYYY-MM-DD), else the newest; null when none is recorded.
     * @param {string} modelId
     * @param {string} [onDate]
     */
    pricingFor(modelId, onDate) {
      const list = prices.get(modelId);
      if (!list) return null;
      if (!onDate) return list[0];
      return list.find((record) => record.asOf <= onDate) ?? null;
    },
  });
}

module.exports = { createRegistry };
