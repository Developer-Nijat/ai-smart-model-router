# Spike: Claude Code-da dinamik model routing

**Tarix:** 2026-11-18 · **Claude Code:** `2.1.327` · **Node:** `v22.15.0` · **OS:** Windows 11
**Kod:** [`spikes/claude-code-routing/`](../spikes/claude-code-routing/) (atılacaq kod; Phase 3-də `integrations/claude-code-mod` əvəz edəcək)

## Məqsəd
Phase 3-dən əvvəl ən böyük riski yoxlamaq: Claude Code mod-u hər turn üçün modeli real olaraq dəyişə bilirmi və CommonJS core mod-un içində işləyə bilirmi?

## Nə quruldu
- `core.cjs` — kiçik CommonJS qayda funksiyası (`typo` → haiku, `security` → opus, qalan → sonnet).
- esbuild ilə `--bundle --format=esm --platform=neutral` → `lib/core.js`; mod onu `import core from '../lib/core.js'` ilə yükləyir.
- Mod hook-ları: `turn.start` (qərar), `turn.step` (`next({ ...e, model, effort })`), `turn.complete` (log, status), `/route` komandası.
- Rejim `userConfig.defaultMode` ilə: `shadow` (default) / `auto` / `off`.

## Nəticələr

| Sınaq | Gözlənilən | Faktiki | Nəticə |
|---|---|---|---|
| `claude plugin validate` | keçir | keçdi (yalnız directory xəbərdarlıqları: README/LICENSE) | ✅ |
| CJS core → ESM bundle mod-da yüklənir | hook-lar işləyir | işlədi | ✅ ADR-003 |
| `shadow`, prompt "fix the typo in helo" | session modeli qalır | `modelUsage`: yalnız `claude-opus-5-5` | ✅ ADR-006 |
| `auto`, eyni prompt | haiku cavab verir | `modelUsage`: yalnız `claude-haiku-5-5` | ✅ ADR-002 |
| `auto`, Bash tool-lu 2 addımlı turn (default qayda → sonnet) | bütün addımlar eyni modeldə | `num_turns=2`, `modelUsage`: yalnız `claude-sonnet-5-5` | ✅ ADR-010 / AC-9 |

Sınaqlar `claude -p "<prompt>" --plugin-dir <mod> --settings '{"pluginConfigs":{"smr-spike@inline":{"options":{"defaultMode":"auto"}}}}' --output-format json` ilə edildi; cavab verən model JSON-dakı `modelUsage`-dən oxundu.

## Yoxlanmayanlar (Phase 3-ə qalır)
- **Effort:** `turn.step`-də `effort` göndərildi, amma faktiki tətbiq olunan effort headless çıxışda görünmür. Phase 3-də `usage`/debug log ilə təsdiqlənməlidir.
- **Subagent routing:** `agentId` olan turn-lar real subagent ilə sınanmayıb.
- **Manual override (`/route haiku`) interaktiv sessiyada:** `$.state` sessiyaya aiddir, headless `-p` bir prosesdə bir prompt olduğu üçün sınanmadı. `claude plugin test` ilə unit test yazılmalıdır.
- **Daemon-a göndərmə və `$.store` buferi:** spike-da yoxdur.
- **Bundle-da mütləq yol:** esbuild çıxışı mənbə faylın mütləq yolunu şərhdə və açarda saxlayır — release build-də təmizlənməlidir.

## Phase 3-də bağlananlar
Effort, subagent routing və `/route` (engine-kit testləri ilə) Phase 3-də yoxlandı: bax [claude-code-integration.md](claude-code-integration.md).

## Qərar
Dinamik routing Claude Code `2.1.327`-də mümkündür və real işləyir. Plan dəyişmir; ADR-002, ADR-003, ADR-010 təsdiqləndi.
