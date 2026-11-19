# ADR-002: Claude Code inteqrasiyası Mods API ilə

**Status:** Qəbul edildi (2026-11-18), spike ilə təsdiqləndi — bax [spike hesabatı](../spike-claude-code.md)

## Kontekst
Shell hook-ları (`PreToolUse` və s.) model sorğusunun modelini dəyişə bilmir. Claude Code `2.1.327`-nin Mods API-si (`claude-code.d.ts`) isə hər model sorğusunu hook-a verir.

## Qərar
İnteqrasiya Claude Code mod-u kimi yazılır:

| Hook / API | İstifadə |
|---|---|
| `turn.start` | Prompt mətni (`e.text`), `turnId`, `agentId` → routing qərarı |
| `turn.step` | `next({ ...e, model, effort })` ilə qərarın tətbiqi; nəticədəki `usage` (real token-lər, cavab verən model) |
| `turn.complete` | Turn-un bağlanması, qərarın qeydə alınması |
| `$.command.register` + `command.run` | `/route` komandaları |
| `$.model.classify` / `$.model.complete` | İstəyə bağlı AI classifier, ayrıca API açarı olmadan |
| `$.state` / `$.store` | Sessiya state-i / sessiyalar arası bufer |
| `$.http.fetch` | Lokal daemon-a qərarların göndərilməsi |

Shell hook-ları yalnız fallback/monitoring üçün nəzərdə tutulur.

## Nəticələr
- Dəstəklənən Claude Code versiya aralığı `mr doctor` tərəfindən yoxlanmalıdır; aralıqdan kənarda adapter `turnLevelRouting: false` elan edir və yalnız tövsiyə verir.
- Mods API yenidir; dəyişikliklər üçün contract testlər real quraşdırmaya qarşı işlədilir.
