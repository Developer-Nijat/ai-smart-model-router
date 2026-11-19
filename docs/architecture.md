# Arxitektura

Smart Model Router agent-dən asılı olmayan routing nüvəsi və ona qoşulan agent inteqrasiyalarından ibarətdir. Qərarların səbəbləri [ADR-lərdə](adr/README.md) yazılıb.

## Komponentlər

```
 Claude Code (mod)        mr (CLI)         Dashboard (Vite SPA)
   │  turn.start/step        │                    │
   │  bundled @smr/core      │                    │ session, 127.0.0.1
   │                         ▼                    ▼
   └── $.http.fetch ──► apps/server (Fastify) ◄───┘
                              │
                  @smr/storage (node:sqlite)
```

| Paket | Məsuliyyət | Status |
|---|---|---|
| `@smr/shared` | Sabitlər, xəta tipləri, Zod schema-ları (model, pricing, rule, classification, decision, agent, settings) | Phase 1 ✅ |
| `@smr/config` | OS-ə görə data qovluğu, `config.json` oxuma/validasiya/atomik yazma; `data/` (modellər, qiymətlər, qaydalar) yükləyicisi | Phase 1–2 ✅ |
| `@smr/logger` | Strukturlu JSON log, secret və prompt redaksiyası | Phase 1 ✅ |
| `@smr/storage` | `node:sqlite`, migration runner, backup, repository-lər; turn qeydlərinin ingest-i, history/stats sorğuları (migration 002) | Phase 1 ✅, Phase 4 ✅ |
| `@smr/adapters` | `BaseAgentAdapter` müqaviləsi, capability → əməliyyat xəritəsi, nəticə tipləri; `ClaudeCodeAdapter` (aşkarlama, modellər), Codex və Gemini CLI (yalnız aşkarlama) | Phase 1 ✅, Phase 3 ✅ |
| `@smr/core` | Təmiz routing nüvəsi: registry, rules classifier, AI classifier müqaviləsi, qaydalar, effort, xərc, scoring, sticky, sessiya state-i, `decide()` — bax [routing-engine.md](routing-engine.md); CLI və API üçün ortaq hesabat funksiyaları (`costComparison`, `describeModels`) | Phase 2 ✅, Phase 5 ✅ |
| `apps/cli` (`mr`) | Terminal komandaları — bax [cli.md](cli.md) | Phase 4 ✅ |
| `apps/server` | Fastify lokal daemon: `/health`, token-li `/v1/records`, `/v1/routing`, `/v1/dashboard/code`, `/v1/shutdown`; session-lu `/api/*` və dashboard-un statik faylları | Phase 4 ✅, Phase 5 ✅ |
| `apps/dashboard` | Vite + React + Tailwind SPA — bax [dashboard.md](dashboard.md) | Phase 5 ✅ |
| `@smr/claude-code-mod` (`packages/claude-code-mod`) | Claude Code mod-u: routing məntiqi (JS, test olunur) + TS hook modulu, esbuild ilə bir ES modula yığılır — bax [claude-code-integration.md](claude-code-integration.md) | Phase 3 ✅ |

## Layout: mənbə və release

Proqramın öz faylları (data, miqrasiyalar, daemon girişi, dashboard, mod) `@smr/config`-in `layout()` funksiyasından tapılır. Mənbədə yollar repo strukturuna görədir. `npm run release` bundle-ları `globalThis.__SMR_RELEASE_ROOT__`-u paketin qovluğuna qoyur və yollar oradan hesablanır. Bax [install.md](install.md).

## Asılılıq qaydası

```
shared  ◄── config, logger, storage, adapters, core
core    ◄── (heç bir I/O paketi; yalnız shared)
claude-code-mod/src ◄── core, shared (mod-a bundle olunur: Node API-siz)
apps    ◄── hamısı
```

`core` heç vaxt `storage`, `logger`, `config` və ya Node I/O modullarını import etmir (ADR-001, `purity.test.js`).

## Routing pipeline (Phase 2-3)

1. Manual override yoxlanılır.
2. Custom qaydalar (prioritet azalan, bərabərdə `id` üzrə).
3. Qaydalarla classification; confidence < `classifier.confidenceThreshold` və privacy rejimi icazə veribsə AI classifier.
4. Capability və adapter dəstəyi üzrə model filtri.
5. Xərc, latency, kontekst və keçid xərci (sticky).
6. Model və effort seçimi; effort modelin dəstəklədiyi səviyyəyə endirilir.
7. Adapter vasitəsilə tətbiq (yalnız `auto` və ya manual).
8. Qərar səbəbi ilə saxlanılır (prompt mətni yox).
9. İstənilən addımda xəta → təhlükəsiz fallback: model dəyişdirilmir.

## Məlumat yeri

| OS | `config.json` | `smr.db` | `logs/` |
|---|---|---|---|
| Windows | `%APPDATA%\smart-model-router` | `%LOCALAPPDATA%\smart-model-router` | `%LOCALAPPDATA%\smart-model-router\logs` |
| macOS | `~/Library/Application Support/smart-model-router` | eyni | `~/Library/Logs/smart-model-router` |
| Linux | `$XDG_CONFIG_HOME` (və ya `~/.config`) `/smart-model-router` | `$XDG_DATA_HOME` (və ya `~/.local/share`) `/smart-model-router` | `$XDG_STATE_HOME` (və ya `~/.local/state`) `/smart-model-router/logs` |

- Windows-da DB roaming profilə qoyulmur: profil sinxronizasiyası işləyən WAL bazasını poza bilər.
- Nisbi XDG dəyərləri XDG spesifikasiyasına görə nəzərə alınmır.
- `SMR_HOME` hamısını bir qovluğa yığır (`config.json`, `smr.db`, `logs/`).
- Mövcud bazanı yeniləməzdən əvvəl yanında `smr.db.bak-v<köhnə versiya>-<vaxt>` backup-ı yazılır və `integrity_check` ilə yoxlanılır.

## Təhlükəsizlik prinsipləri (Phase 1-də tətbiq olunanlar)

- Settings schema-sı `server.host` üçün yalnız `127.0.0.1` və `::1` qəbul edir.
- Settings faylı `0600` icazəsi ilə, atomik yazılır; pozuq fayl heç vaxt səssizcə default ilə əvəz olunmur.
- DB-də prompt mətni üçün sütun yoxdur (test ilə yoxlanılır).
- Bütün SQL sorğuları parametrlidir.
- Logger həm mesajı, həm sahələri redaksiya edir: açar adının sözlərinə görə (`apiKey`, `userPrompt`, `system_prompt` …) və dəyər formalarına görə (`sk-ant-…`, `Bearer …`, `AIza…`, `ghp_…`, `github_pat_…`, `xox…`, `AKIA…`, JWT, URL-dəki parol, `password=…`). Rəqəmlər (`maxTokens`) toxunulmaz qalır. Sahələr `ts`/`level`/`msg`-i əvəz edə bilmir; logger heç vaxt çağırana xəta atmır.
- Migration-lar paralel başlayan proseslərə qarşı təhlükəsizdir (hər migration öz write lock-u daxilində yenidən yoxlanılır), foreign key-lər migration zamanı söndürülür və commit-dən əvvəl `foreign_key_check` keçməlidir.
- `settings` cədvəli yalnız schema-sı qeydə alınmış açarları qəbul edir (təsadüfən credential saxlanmasın), dəyər ≤ 64 KB.

## Məlum məhdudiyyətlər

- `node:sqlite` hələ experimental-dır və hər prosesdə `ExperimentalWarning` çap edir.
- `npm audit`: 2026-11-19 tarixinə zəiflik yoxdur (Phase 1-dəki `picomatch` advisory-si asılılıqlar yenilənəndən sonra aradan qalxdı).
