# Smart Model Router — Texniki mümkünlük icmalı və Phase 1 planı

> Status: **təsdiqləndi (2026-11-18)** — 5 sualın hamısına "ok". Spike tamamlandı ([hesabat](spike-claude-code.md)), Phase 1 tamamlandı.
> Bu sənəd MASTER_PROMPT-dakı "FIRST ACTION" tələbinin cavabıdır. ADR-lər ayrıca: [docs/adr/](adr/README.md).
>
> Phase 1 zamanı plandan kənarlaşmalar (code review nəticəsində):
> - Data yerləri: Windows-da DB və loglar `LOCALAPPDATA`-da, config `APPDATA`-da; Linux-da XDG config/data/state ayrıca (bax [architecture.md](architecture.md)).
> - Adapter capability-lərinə `modelDiscovery` və `sessionContext` əlavə olundu; `applyModel` (sessiya daxilində) və `applyStartupModel` ayrıldı.
> - Settings cədvəli yalnız schema-sı qeydə alınmış açarları qəbul edir.
> Tarix: 2026-11-18 · Yoxlanılan mühit: Claude Code `2.1.327`, Node `v22.15.0`, npm `10.9.2`, Windows 11.

---

## 1. Claude Code inteqrasiyası — texniki mümkünlük

### 1.1. Necə yoxlanıldı

Fərziyyə və köhnə nümunələrə yox, quraşdırılmış versiyanın öz tip təsvirlərinə baxıldı:
`claude-code.d.ts` (build `2.1.327`, Mods API, ~20 000 sətir). Aşağıdakı hər iddia oradan götürülüb.
Real Claude Code üzərində işlək test hələ edilməyib — o, Phase 3-ün ilk addımıdır (spike).

### 1.2. Əsas nəticə: dinamik routing **mümkündür**

DISCUSSION.md-də "Mods API yoxlanmalıdır" deyilən sual cavablandı:

| Tələb | Mods API-də nə var | Nəticə |
|---|---|---|
| Hər model sorğusundan əvvəl modeli dəyişmək | `on('turn.step', ...)` — engine model sorğusunu göndərməzdən əvvəl çağırılır. `next({ ...e, model })` başqa modeli adlandırır (alias `haiku` və ya tam id) | ✅ Dəstəklənir |
| Effort dəyişmək | Eyni hook-da `next({ ...e, effort })` — `low`/`medium`/`high`/`xhigh`/`max` | ✅ Dəstəklənir, **məhdudiyyətlə** (bax 1.3) |
| Subagent routing | `turn.step` və `turn.start` subagent-lər üçün də işləyir, `e.agentId` ilə ayrılır | ✅ Dəstəklənir |
| Turn sərhədləri | `turn.start` (turnId), `turn.complete` (səbəb, cavab) | ✅ |
| Prompt mətnini almaq | `on('prompt.submit')` və ya `$.session.messages()` (`turn.step`-də prompt yoxdur, yalnız `messageCount`) | ✅ |
| Real usage | `turn.step` nəticəsi `usage: TurnUsage` qaytarır (API-nin bildirdiyi token-lər və cavab verən model) | ✅ Faktiki rəqəmlər, uydurma yox |
| `/route` slash komandası | `$.command.register({ name, description })` + `command.run` hook-u | ✅ |
| AI classifier | `$.model.classify(text, labels)` və `$.model.complete({ model: 'haiku', ... })` — istifadəçinin öz Claude Code sessiyası ilə, **ayrıca API açarı olmadan** | ✅ Böyük üstünlük |
| Sessiya üzrə vəziyyət | `$.state` (sessiyaya aid), `$.store` (sessiyalar arası) | ✅ Paralel sessiyalar təbii olaraq izolə olunur |
| Status göstərmək | `$.ui.status(text)`, `$.ui.toast`, `AbovePrompt` band | ✅ |
| Lokal API ilə əlaqə | `$.http.fetch('http://127.0.0.1:...')` | ✅ (təşkilatın web-fetch siyasəti qadağan etməyibsə) |

### 1.3. Məhdudiyyətlər və risklər (sənədləşdirilməli)

1. **Rewrite yalnız bir addım üçündür.** `turn.step`-də model/effort dəyişikliyi həmin sorğuya aiddir. Bir turn daxilində tool loop-u çoxlu addım edir — mod qərarı turn-un başında (`index === 0`) verib, həmin turn-un bütün addımlarına tətbiq etməlidir. Turn ortasında model dəyişmək olmaz.
2. **Effort səssizcə azaldıla bilər.** Model effort qəbul etmirsə, effort göndərilmir; limit (`maxEffortLevel`) onu aşağı sala bilər. Router qərarında "istənən effort" və "faktiki tətbiq olunan effort" ayrı saxlanmalıdır (faktiki olan `usage`/nəticədən götürülür).
3. **Model keçidi prompt cache-i sıfırlayır.** Cache modelə bağlıdır; keçid böyük kontekstdə bahalıdır. Bu, sticky routing və transition-cost üçün əsas arqumentdir.
4. **Mod modulu Node mühiti deyil.** Hook modulunda DOM və Node yoxdur — `require('better-sqlite3')` və ya `fs` birbaşa işləmir; hər şey `$` vasitəsilə (`$.fs`, `$.http`, `$.process`). Nəticə: SQLite mod-un içində yox, ayrıca prosesdə yaşamalıdır (bax ADR-003).
5. **Mod-lar TypeScript/TSX-dir.** `register.tsx/.ts` formatındadır. Backend-də TS istifadə etməmək qərarı qorunur — inteqrasiya qatı nazik TS faylıdır, Routing Core isə təmiz CommonJS JS olaraq qalır.
6. **Core-u mod-a bundle etmək imkanı yoxlanmalıdır.** Mod modulunun nisbi import-ları və ya bundle edilmiş JS faylını necə yüklədiyi Phase 3 spike-da təsdiqlənməlidir. Alternativ: mod lokal daemon-a HTTP ilə müraciət edir.
7. **API versiyası dəyişə bilər.** Mods API yenidir; `mr doctor` Claude Code versiyasını yoxlamalı, dəstəklənən aralıqdan kənarda adapter `turnLevelRouting: false` rejiminə (yalnız tövsiyə) keçməlidir.
8. **Subscription istifadəçisi üçün xərc.** `usage` token-ləri realdır, amma pul xərci deyil — dashboard "Estimated API equivalent cost" kimi göstərməlidir (DISCUSSION 6.1 ilə uyğun).

### 1.4. Codex və Gemini CLI

Bu maşında `codex`, `gemini` və `ollama` quraşdırılmayıb. MVP-də yalnız aşkarlama və capability hesabatı olacaq; quraşdırılmayıbsa `not installed` göstəriləcək, heç bir imkan "var" kimi göstərilməyəcək. Real capability-lər həmin alətlər quraşdırılanda onların öz sənədləri ilə yoxlanacaq.

### 1.5. SQLite

`node:sqlite` (`DatabaseSync`) Node 22.15-də flag-sız işləyir (yoxlanıldı), amma `ExperimentalWarning` verir. Native build tələb etmir — Windows/Linux/macOS üçün `better-sqlite3`-dən rahatdır. Bax ADR-004.

---

## 2. Architecture Decision Records (ADR)

| # | Qərar | Seçim | Səbəb |
|---|---|---|---|
| ADR-001 | Nüvənin asılılığı | Routing Core **təmiz funksiyalardır**: I/O yox, global state yox, `(input, config, registry) → decision` | Agent-dən asılı olmamaq, test edilə bilmək, mod-a bundle edilə bilmək, paralel sessiyalarda təhlükəsizlik |
| ADR-002 | Claude Code inteqrasiyası | Mods API: `turn.start` + `turn.step` (model/effort), `prompt.submit`, `command.run` (`/route`), `turn.complete` (usage) | Yeganə rəsmi, dəstəklənən dinamik yol. Shell hook-lar yalnız fallback/monitoring |
| ADR-003 | Proses modeli | **Qərar mod-un içində** (bundle edilmiş core ilə, sinxron, aşağı latency). **Persistensiya ayrıca lokal daemon-da** (`mr start`, Fastify + SQLite). Daemon işləmirsə qərarlar `$.store`-da buferlənir, sonra göndərilir | Hot path-də (hər model sorğusu) HTTP və daemon asılılığı olmasın. Daemon düşsə routing dayanmasın. *Spike nəticəsindən asılıdır — bundle mümkün deyilsə, HTTP + qısa timeout + pass-through fallback* |
| ADR-004 | Verilənlər bazası | `node:sqlite`, öz kiçik migration runner-i (`schema_migrations` cədvəli, nömrəli SQL faylları) | Native asılılıq yox; experimental status sənədləşdirilir. Lazım olsa `better-sqlite3`-ə keçid DB qatı arxasında gizlədilir |
| ADR-005 | Dashboard | **Vite + React SPA**, Tailwind + shadcn/ui, Fastify tərəfindən statik fayl kimi verilir | Next.js lokal tək-istifadəçi alət üçün artıqdır: ayrıca server, SSR lazım deyil. Bir proses, bir port |
| ADR-006 | Default rejim | Quraşdırmadan sonra **Shadow Mode**: router analiz edir, tövsiyəni yazır, modeli **dəyişmir**. `auto` opt-in | DISCUSSION-dakı tövsiyə; real data toplamadan model dəyişmək riskli. Etibar qazanmaq üçün |
| ADR-007 | Classifier privacy | Default `local-only` (yalnız qaydalar). `claude-session` rejimi (`$.model.classify` ilə, ayrıca açar yox) opt-in və açıq bildirişlə | Prompt xaricə gedirsə istifadəçi bilməlidir |
| ADR-008 | Qiymət məlumatı | Registry `pricing` sahələri `null` ilə gəlir; hər qiymət `sourceUrl` + `asOf` tarixi ilə daxil edilir; köhnəlmiş qiymət xəbərdarlıqla göstərilir | Uydurma qiymət olmasın |
| ADR-009 | Dil və modul sistemi | Backend: JS + CommonJS + JSDoc tipləri. İnteqrasiya mod-u: TS (Mods API tələbi) | Master prompt tələbi; mod istisnası məcburidir |
| ADR-010 | Router-in əsas modeli dəyişmə qaydası | Qərar turn başında verilir və turn boyu sabit qalır; manual override > custom rule > sticky > auto | Turn ortasında keçid cache-i və ardıcıllığı pozur |

---

## 3. Repository strukturu (təklif)

DISCUSSION-dakı strukturdan fərq: daha az paket. 11 paket MVP üçün artıq bölgüdür; modul sərhədləri qovluqlarla qorunur, ayrıca paket yalnız ayrıca yüklənən hissələr üçündür.

```
smart-model-router/
├── package.json                 # npm workspaces, engines: node >=22
├── apps/
│   ├── cli/                     # `mr` komandası (Commander.js)
│   ├── server/                  # Fastify lokal API (127.0.0.1 + token) + dashboard statik faylları
│   └── dashboard/               # Vite + React SPA
├── packages/
│   ├── core/                    # TƏMİZ routing nüvəsi (I/O yox)
│   │   └── src/
│   │       ├── classifier/      # rules classifier + AI classifier müqaviləsi
│   │       ├── rules/           # custom rules engine, prioritet, konflikt həlli
│   │       ├── selection/       # scoring, effort clamp, sticky/transition cost
│   │       ├── registry/        # model + provider registry (data-dan oxunan)
│   │       └── cost/            # cost hesablamaları
│   ├── shared/                  # Zod schema-ları, error tipləri, sabitlər
│   ├── config/                  # config yükləmə/validasiya, yollar (OS-ə görə)
│   ├── storage/                 # node:sqlite, migration-lar, repository-lər
│   ├── logger/                  # strukturlu JSON log (redaksiya ilə)
│   └── adapters/                # BaseAgentAdapter müqaviləsi + capability schema
│       ├── claude-code/         # adapter (detection, capability, doctor)
│       ├── codex/               # yalnız detection
│       └── gemini-cli/          # yalnız detection
├── integrations/
│   └── claude-code-mod/         # Claude Code mod-u (TS): turn.step, /route
├── data/
│   ├── models/                  # model registry JSON
│   ├── pricing/                 # versiyalanmış qiymətlər (sourceUrl, asOf)
│   └── routing-rules/           # default qaydalar
├── tests/                       # integration/ contract/ fixtures/
│                                # (unit testlər hər paketin yanında)
└── docs/
    ├── adr/
    └── 00-feasibility-and-phase1-plan.md
```

İstifadəçi məlumatları layihə qovluğunda yox, OS-ə uyğun data qovluğunda: `%APPDATA%\smart-model-router` (Windows), `~/.config/smart-model-router` (Linux), `~/Library/Application Support/smart-model-router` (macOS). Bu, yeniləmədə məlumatın qorunmasını təmin edir.

---

## 4. MVP acceptance criteria (yoxlanıla bilən formada)

| # | Meyar | Necə yoxlanır |
|---|---|---|
| AC-1 | Sadə tapşırıq AI classifier çağırmadan yönləndirilir | Unit: rules confidence ≥ hədd → `classifierCalls === 0` |
| AC-2 | Qeyri-müəyyən tapşırıqda AI classifier işə düşür (rejim icazə veribsə) | Unit: confidence < hədd + `hybrid` → classifier mock-u çağırılır |
| AC-3 | Manual override hər şeydən üstündür | Unit: override + əks qayda → override qalib gəlir, `decisionSource: "manual"` |
| AC-4 | Effort modelin dəstəklədiyi səviyyə ilə məhdudlaşır | Unit: `max` istənir, model `high`-a qədər → `high`, səbəb yazılır |
| AC-5 | Paralel sessiyalar bir-birinə toxunmur | Unit: iki sessiya eyni vaxtda, state-lər ayrı; global mutable state yoxdur (lint/review) |
| AC-6 | Böyük kontekstdə lazımsız keçid olmur | Unit: yüksək context + kiçik keyfiyyət fərqi → cari model saxlanır |
| AC-7 | Yüksək riskli tapşırıq sticky-ni keçə bilir | Unit: security tapşırığı → güclü modelə keçid |
| AC-8 | Adapter dəstəkləmədiyi əməliyyatı icra olunmuş göstərmir | Contract: `applyModel` dəstəklənmirsə `status: "unsupported"`, `applied` yox |
| AC-9 | Turn daxilində model sabitdir | Integration (real Claude Code): tool loop-lu turn-da bütün addımlar eyni model |
| AC-10 | Shadow mode modeli dəyişmir | Integration: `turn.step` `e.model` dəyişməz qalır, tövsiyə yazılır |
| AC-11 | Classifier/daemon əlçatmaz olanda işləmə davam edir | Integration: daemon söndürülüb → routing qaydalarla davam, qərarlar buferlənir |
| AC-12 | Dashboard real history göstərir | E2E: qərar yaradılır → dashboard-da görünür |
| AC-13 | Yeniləmədə məlumat qorunur | Integration: köhnə schema DB → migration → data yerindədir |
| AC-14 | Lokal təhlükəsizlik | Integration: server yalnız 127.0.0.1; token-siz sorğu → 401; prompt mətni DB-yə yazılmır |
| AC-15 | Uydurma rəqəm yoxdur | Review: registry-də mənbəsiz qiymət yoxdur; dashboard boş data-nı "məlumat yoxdur" kimi göstərir |

---

## 5. Phase 1 — detallı implementasiya planı

**Məqsəd:** işlək skeleton — workspace, schema-lar, config, SQLite + migration-lar, logger, test infrastrukturu. Routing məntiqi yoxdur.

| # | Tapşırıq | Nəticə | Claude vaxtı |
|---|---|---|---|
| 1.1 | Root `package.json` (workspaces, `engines.node >=22`), `.gitignore`, `.editorconfig`, Vitest root config, ESLint (flat config, CommonJS) | `npm install` və `npm test` işləyir | 3–5 dəq |
| 1.2 | Paket skeletləri: `core`, `shared`, `config`, `storage`, `logger`, `adapters`, `apps/cli` (yalnız `mr --version`) | Hər paket `require` oluna bilir | 4–7 dəq |
| 1.3 | `shared`: Zod schema-ları — `Model`, `Provider`, `Pricing` (`sourceUrl`, `asOf`), `RoutingRule`, `Classification`, `RoutingDecision`, `AgentCapabilities`, `Settings` (privacy mode, routing mode: `shadow`/`auto`/`off`) | Schema-lar + unit testlər (valid/invalid nümunələr) | 6–10 dəq |
| 1.4 | `config`: OS-ə görə data qovluğu, default config, faylı oxu → Zod validasiya → aydın xəta mesajı, atomik yazma (temp + rename) | Unit testlər (Windows/POSIX yolları, pozuq config) | 4–7 dəq |
| 1.5 | `logger`: strukturlu JSON log, səviyyələr, **redaksiya** (API açarı, token, prompt sahələri), fayl + stderr | Redaksiya testləri | 3–5 dəq |
| 1.6 | `storage`: `node:sqlite` qatı, migration runner (`schema_migrations`, transaction daxilində, geri qaytarılmaz addımdan əvvəl backup), `001_initial.sql`: `agents`, `providers`, `models`, `model_pricing`, `routing_rules`, `sessions`, `routing_decisions`, `usage_records`, `settings`, `benchmark_runs` | Migration testləri: boş DB, təkrar işə salma (idempotent), köhnə versiyadan yeniləmə | 8–14 dəq |
| 1.7 | Repository-lər (minimal): `decisions.insert/list`, `settings.get/set` — parametrli sorğular | Unit testlər (in-memory DB) | 4–7 dəq |
| 1.8 | `adapters`: `BaseAgentAdapter` müqaviləsi + `AgentCapabilities` schema; contract test şablonu (hər adapter üçün təkrar istifadə olunan) | Contract test infrastrukturu | 3–5 dəq |
| 1.9 | `docs/adr/` — yuxarıdakı ADR-ləri ayrıca fayllara; `docs/architecture.md`; README (quraşdırma) | Sənədlər | 3–5 dəq |
| 1.10 | Bütün testlərin işlədilməsi, düzəliş raundları, Phase 1 hesabatı | Yaşıl test, hesabat | 5–15 dəq |

**Phase 1-ə daxil deyil:** routing alqoritmi, classifier, CLI komandalarının əksəriyyəti, server, dashboard, Claude Code mod-u.

### Phase 1-dən əvvəl tövsiyə: Phase 3 spike (ayrıca, kiçik)

Ən böyük texniki risk Claude Code inteqrasiyasıdır. Təklif: Phase 1-ə paralel və ya ondan əvvəl **15–40 dəqiqəlik spike** — minimal mod:

- `turn.step`-də `index === 0` olanda modeli dəyişir (məs. `/route haiku` ilə), həmin turn-un qalan addımlarına da tətbiq edir;
- `usage` nəticəsindən cavab verən modeli `$.ui.status`-da göstərir;
- core-un bundle edilmiş JS faylını mod-dan import etməyi sınayır (ADR-003-ü təsdiq/rədd etmək üçün).

Spike mod-u `~/.claude/dev-mods/` altında yazılır; işə salınmazdan əvvəl Claude Code sizdən bir dəfə "mod-ları aktiv edim?" deyə soruşacaq.

---

## 6. Estimate

| Hissə | Təxmin |
|---|---|
| Claude-un vaxtı — Phase 1 (kod + test + düzəliş raundları) | 45–80 dəq |
| Claude-un vaxtı — Phase 3 spike | 15–40 dəq |
| Sənin vaxtın (bu sənədin review-u, Phase 1 review, qərarlar) | 45–90 dəq |
| Xarici gözləmə | yoxdur |

- **Əsas:** öz tarixçəndən kalibrasiya (2583 tapşırıq): XL feature p50–p75 = 23–35 dəq + düzəliş raundları; spike üçün naməlum inteqrasiya olduğu üçün p90 götürülüb.
- **Uzada bilər:** `node:sqlite` experimental API fərqləri, Windows yol/kodlaşdırma problemləri, mod-un bundle edilmiş faylı yükləyə bilməməsi (onda ADR-003 HTTP variantına keçir).

---

## 7. Təsdiq üçün suallar

1. **ADR-005:** Next.js əvəzinə Vite + React SPA — razısınız?
2. **ADR-003:** Qərar mod-un içində, persistensiya daemon-da — razısınız? (Spike nəticəsi ilə təsdiqlənəcək.)
3. **ADR-006:** Default rejim Shadow Mode — razısınız?
4. **Spike:** Phase 1-dən əvvəl Claude Code spike edək, yoxsa birbaşa Phase 1?
5. **Git:** Layihə hələ git repo deyil. `git init` etməyimi istəyirsinizmi? (Commit-ləri yalnız siz dedikdə edəcəyəm.)
