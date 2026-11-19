# Spike: Claude Code-da per-turn model routing

Atılacaq kod — yalnız texniki mümkünlüyü sübut etmək üçün. Nəticələr: [docs/spike-claude-code.md](../../docs/spike-claude-code.md). Phase 3-də `integrations/claude-code-mod` bunu əvəz edəcək.

## Tərkib

- `core.cjs` — kiçik CommonJS qayda funksiyası (routing core-un yerində).
- `mod/` — Claude Code mod-u: `turn.start` qərar verir, `turn.step` modeli/effort-u dəyişir, `/route` komandası.
- `mod/lib/core.mjs` — `core.cjs`-in ESM bundle-ı.

## Yenidən qurmaq

```bash
cd spikes/claude-code-routing
npx esbuild@0.24.0 core.cjs --bundle --format=esm --platform=neutral --legal-comments=none --outfile=mod/lib/core.mjs
claude plugin validate mod
```

## Sınamaq

```bash
# shadow (default): model dəyişmir
claude -p 'Fix the typo in the word "helo". Reply with only the corrected word.' --plugin-dir mod --output-format json

# auto: "typo" qaydası haiku seçir
claude -p 'Fix the typo in the word "helo". Reply with only the corrected word.' --plugin-dir mod --output-format json \
  --settings '{"pluginConfigs":{"smr-spike@inline":{"options":{"defaultMode":"auto"}}}}'
```

Cavab verən model JSON-dakı `modelUsage` açarlarında görünür. İnteraktiv sessiyada: `/route auto`, `/route haiku`, `/route clear`, `/route explain`.
