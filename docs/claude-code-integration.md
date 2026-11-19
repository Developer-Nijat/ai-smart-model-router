# Claude Code inteqrasiyası (Phase 3)

Router Claude Code-un içində **mod** kimi işləyir (ADR-002, ADR-003): hər turn-un modelini və effort-unu, subagent-lərin modelini seçir. Qərar mod-un içində verilir, Claude Code-un cavabını gözləmədən; heç bir ayrıca proses lazım deyil.

## Hissələr

| Yer | Nə edir |
|---|---|
| `packages/claude-code-mod/src/` | Mod-un routing məntiqi (CommonJS, vitest ilə test olunur): `createRouter`, `/route` parser-i və formatlar, userConfig → settings, usage çevrilməsi. Prompt mətni heç bir nəticəyə düşmür. |
| `packages/claude-code-mod/mod-src/` | Mod-un özü: `plugin.json` (userConfig), `hooks/register.tsx` (yalnız hook-lar ilə router arasında dəyər daşıyır), tiplər. |
| `packages/claude-code-mod/scripts/build.js` | `src/` + `@smr/core` + `data/` (modellər, qiymətlər, qaydalar) → bir ES modul `lib/router.mjs` (minify, Node API-siz). Nəticə: `dist/claude-code-mod/`. |
| `packages/claude-code-mod/mod-test/` | Mod-un engine-kit testləri (`claude plugin test`), model çağırmadan. |
| `packages/adapters/src/claude-code.js` | `ClaudeCodeAdapter`: sessiyadan kənarda (CLI, daemon) quraşdırmanı tapır (`claude --version`, minimum `2.1.327`) və modelləri sadalayır. Canlı sessiya əməliyyatları `failed` + səbəb qaytarır: onları mod edir. |
| `packages/adapters/src/detect-only.js` | Codex və Gemini CLI: yalnız aşkarlama, heç bir capability iddia olunmur. |

## Hook-lar

```
session.start     → /route komandasını qeydiyyata alır
turn.start        → (əsas sessiya) classify: qaydalar, icazə varsa AI classifier ($.model.complete, haiku/low)
turn.step         → ilk addımda decide(); hər addımda shouldApply-sa model + effort yenidən yazılır
                    (rewrite bir addım sürür — ADR-010), addımın usage-i yadda saxlanılır
turn.complete     → applied / failed / təsdiqlənməyib; xərc; sessiya state-i; qeyd ($.state log + $.store buferi)
agent.spawn       → subagent-in modeli tapşırığına görə (çağırış modeli adlandırıbsa və ya fork-dursa toxunulmur)
classic.SessionStart (source: clear) → kontekst 0 sayılır (keçid xərci yoxdur)
command.run route → /route
```

Hər hook-un iki qaydası var:

- **Routing heç vaxt turn-u pozmur.** Router, `$.state` və ya `$.store` xətası tutulur, status sətrində qısa xəbərdarlıq göstərilir və hadisə Claude Code-a dəyişmədən ötürülür (`next(e)` `try`-dan kənardadır, bir dəfə çağırılır). Test: `$.store.set` xəta atanda turn yenə gedir.
- **Yazılar növbə ilədir.** Əsas turn və subagent-lər eyni vaxtda bitə bilər; log və `$.store` buferi bir-bir yazılır, sessiya state-i `update` callback-inin içində hesablanır (arada verilmiş `/route` əmri itmir).

Subagent planı: engine subagent-in ilk turn-unu `agent.spawn`-ın `next()`-i qayıtmamış başlada bilər. Ona görə plan əvvəlcə "gözləyən spawn" kimi saxlanılır və subagent turn-u onu ya `agentId` ilə, ya da eyni tapşırıq mətni ilə götürür; mətn plan götürülən kimi yaddaşdan silinir.

Prompt mətni yalnız `turn.start`-dan birinci addımdakı qərara qədər yaddaşda (modul dəyişənində) qalır, sonra silinir. `$.state`, `$.store` və status sətrində yalnız etiketlər, model adları, token sayları və xərc olur.

## Statuslar

| Status | Mənası |
|---|---|
| `recommended` | Shadow rejimi: tövsiyə edildi, tətbiq olunmadı. `appliedModel` faktiki cavab verən modeldir. |
| `applied` | Router modeli istədi və turn-un **hər** addımı həmin modellə cavab verdi (`usage.model` ilə yoxlanılır). |
| `failed` | Router istədi, amma ən azı bir addım başqa modellə cavab verdi. |
| `skipped` | Router `off`-dur və ya xəta oldu (cari model saxlanılır). |
| təsdiqlənməyib | Heç bir addım usage göndərmədi (məs. çox tez dayandırılıb): status dəyişmir, `verified: false`; `once` override xərclənmir, növbəti turn-a qalır. |

Sessiyanın cari modeli həmişə **faktiki cavab verən** modelə bərabər tutulur, tövsiyəyə yox.

Xərc hər addımın öz modelinin qiyməti ilə hesablanır. Bir addım belə usage göndərməyibsə və ya qiyməti bilinmirsə xərc `null`-dur (`costComplete: false`): yarımçıq cəm dəqiq rəqəm kimi görünməsin.

## `/route`

```
/route                      status: rejim, override, son qərar
/route auto|shadow|off      rejimi dəyiş
/route <model> [effort] [once]
                            manual override (shadow-da da tətbiq olunur): /route opus, /route sonnet high once
/route clear                override-u götür
/route explain              son əsas turn niyə bu modeli aldı (səbəb, classification, alternativlər, trace)
/route stats                son 50 qeyd (əsas + subagent ayrıca sayılır): modellər, statuslar, təxmini xərc
```

Model adları registry-dən gəlir (`haiku`, `sonnet`, `opus`, tam id-lər); Claude Code-un işlədə bilmədiyi və ya söndürülmüş model (Fable default söndürülüb) qəbul olunmur.

## Canlı mesajlar

Router turn-un modelini seçən anda (turn-un ilk addımında) bunu göstərir. Turn-un sonunu gözləmir.

- **Transcript sətri:** məsələn, `▼ router · opus → haiku/low · light bug fix · a cheaper model is enough`. Söhbətdə qalır.
- **Prompt-un üstündə zolaq:** turn işləyərkən rəngli və qalın görünür, bitəndə solğun "last turn" kimi qalır. `/route off` zolağı təmizləyir.
- **Status sətri:** `router ▼ opus → haiku/low`.

| İşarə | Hal | Rəng |
|---|---|---|
| ▼ | daha ucuz modelə keçid | success (yaşıl) |
| ▲ | daha güclü modelə keçid, lazım olanda "needs deeper reasoning" ilə | warning (sarı) |
| ● | eyni model | suggestion |
| ■ | sticky: niyə qalındığı yazılır (keçid xərci, kiçik fərq, qayda) | inactive |
| ◇ | shadow: "would use …", sessiya öz modelində qalır | subtle |
| ✎ | `/route` override | permission |
| ⚑ | istifadəçi qaydası | merged |
| ↳ | subagent-in modeli | claude |

Mesajlar yalnız etiketlərdən və score-lardan qurulur (`src/live.js`), prompt-un mətnindən heç nə daxil olmur. `liveMessages` ilə səviyyəsini azaltmaq və ya söndürmək olur.

## Ayarlar (userConfig)

| Açar | Dəyərlər | Default |
|---|---|---|
| `defaultMode` | `shadow`, `auto`, `off` | `shadow` (ADR-006) |
| `privacyMode` | `local-only`, `local-ai`, `cloud-ai`, `hybrid` | `local-only` |
| `aiClassifier` | `off`, `on` | `off` — `on` yalnız `cloud-ai`/`hybrid` ilə işləyir (ADR-007) |
| `liveMessages` | `on`, `band`, `off` | `on`: transcript-də sətir və prompt-un üstündə zolaq; `band`: yalnız zolaq; `off`: heç biri |

Yanlış dəyər xəta vermir: təhlükəsiz default götürülür və `/route` statusunda xəbərdarlıq göstərilir.

## Build və yoxlama

```bash
npm run build:mod                       # dist/claude-code-mod/
claude plugin validate dist/claude-code-mod
node packages/claude-code-mod/scripts/build.js --with-tests && claude plugin test dist/claude-code-mod
claude --plugin-dir dist/claude-code-mod   # yalnız bu sessiya üçün yüklənir
```

Daimi quraşdırma (Phase 6): release paketindəki lokal marketplace ilə, `claude plugin marketplace add <paket qovluğu>` və `claude plugin install smart-model-router@smart-model-router-local`. Bax [install.md](install.md). Bu ardıcıllıq izolə edilmiş config qovluğunda yoxlanıb. İstifadəçinin öz Claude Code-unda mod hələ aktiv edilməyib.

## Real yoxlama (2026-11-19, Claude Code 2.1.328, headless)

`claude -p "<prompt>" --plugin-dir dist/claude-code-mod --settings '{"pluginConfigs":{"smart-model-router@inline":{"options":{"defaultMode":"auto"}}}}' --output-format json`; cavab verən model `modelUsage`-dən oxundu. Sessiyanın öz modeli Opus 5.5 idi.

| Sınaq | Gözlənilən | Faktiki |
|---|---|---|
| `auto`, "Fix the typo in the word 'helo'" | haiku | `claude-haiku-5-5` ✅ |
| `auto`, SQL injection auditi | opus | `claude-opus-5-5` ✅ |
| `shadow` (default), typo | sessiyanın modeli qalır | `claude-opus-5-5` ✅ |
| `auto`, general-purpose subagent ilə sadə sual | subagent haiku | bütün sorğular `claude-haiku-5-5`; debug log: subagent sorğusu `source=agent:builtin:general-purpose model=claude-haiku-5-5` ✅ |
| **Effort**: ayrıca probe mod `turn.step`-də `effort: low` / `max` göndərir, eyni tapşırıq, sonnet | max daha çox düşünür | output token: low 259 / 239, max 719 / 1174 ✅ — Claude Code `turn.step`-dəki effort-u tətbiq edir |
| `claude plugin validate` | keçir | keçir (yalnız directory xəbərdarlıqları: LICENSE, icon) ✅ |
| `claude plugin test` (7 test: auto, shadow, override once, off + səhv komanda, subagent spawn, subagent turn-u + qeyd, store xətası) | keçir | 7/7 ✅; yanlış gözləntidə həqiqətən uğursuz olur |
| Review düzəlişlərindən sonra yenidən: `auto`, typo | haiku | `claude-haiku-5-5` ✅ |

## Məhdudiyyətlər və açıq məsələlər

- **Effort geri oxunmur.** Claude Code addımın hansı effort ilə getdiyini usage-də qaytarmır; `appliedEffort` göndərilən səviyyədir, təsdiq yox. Mexanizmin işlədiyi yuxarıdakı probe ilə ölçülüb.
- **`/route` headless `-p`-də işləmir:** `-p` rejimində mod-un komandası prompt kimi modelə gedir. Komandalar `claude plugin test` ilə yoxlanılır; interaktiv sessiyada əl ilə yoxlama Phase 6-ya qalır (istifadəçinin qərarı: mod hazır olana qədər onun sessiyalarında aktiv edilmir).
- **`classic.SessionStart` başqa plugin tərəfindən ötürülə bilər:** bu maşında `cc-plugin-sec-default` hadisəni mod-dan əvvəl tutub ötürdü, ona görə `/clear`-dan sonra kontekst sıfırlanması həmişə çatmaya bilər. Nəticə: keçid xərci bir turn üçün artıq qiymətləndirilə bilər; routing pozulmur.
- **Subagent effort-u** `agent.spawn`-da verilmir (o yalnız model qəbul edir); subagent-in turn-u planı tapanda effort `turn.step`-də göndərilir. Test kit-də yoxlanılıb; real subagent-də effort ayrıca ölçülməyib.
- `ClaudeCodeAdapter` Windows-da `claude --version`-u shell ilə (`.cmd` shim-ləri üçün) və ev qovluğunda işlədir: cari qovluqdakı saxta `claude.cmd` işə düşmür.
- **İstifadəçi qaydaları** (Phase 5): mod sessiya başlayanda daemon-dan `GET /v1/routing` ilə qaydaları (göndərilən + `rules.json`) və scoring tənzimləmələrini (`routing.sticky`, `routing.weights`) alır. Bu, daemon HMAC sübutu verdikdən sonra olur. Son nüsxəni `$.store`-da (`daemon-routing`) saxlayır və daemon işləməyəndə onu istifadə edir. Etibarsız qaydalar etibarlıları əvəz etmir. Rejim, privacy və classifier daemon-dan gəlmir: onlar modun öz ayarlarında qalır. `/route` statusunda `rules: N (from the daemon | last copy from the daemon | shipped with the build)` sətri görünür. Bax [dashboard.md](dashboard.md).
- **Daemon-a ötürmə** (Phase 4): qeydlər `$.store` buferindən (`pending-records`, ən çox 500) 50-lik paketlərlə `daemonUrl`-ə göndərilir; token yalnız daemon `/health` nonce-una düz HMAC sübutu verəndən sonra göndərilir (`crypto.subtle` üzərində HMAC-SHA256); bax [cli.md](cli.md). `$.store` sessiyalar arası qalır: daemon işləməyəndə toplanan qeydlər sonrakı sessiyada çatır (real yoxlamada belə oldu).
- Bundle ~590 KB-dır (əsasən zod); mod loader-in fayl limiti 1 MiB-dir — integration test bunu yoxlayır.
