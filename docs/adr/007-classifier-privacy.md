# ADR-007: Classifier privacy rejimləri

**Status:** Qəbul edildi (2026-11-18)

## Kontekst
AI classifier prompt mətnini modelə göndərir. İstifadəçi bunu bilməlidir.

## Qərar
- `privacy.mode`: `local-only` (default, yalnız qaydalar), `local-ai` (Ollama və s.), `cloud-ai`, `hybrid` (əvvəl qaydalar, qeyri-müəyyən olanda icazə verilmiş AI).
- `classifier.enabled` default `false`.
- `classifier.provider`: `agent-session` (coding agent-in öz sessiyası, məs. Claude Code-un `$.model.classify`; ayrıca açar tələb etmir), `ollama`, `anthropic-api`, `openai-api`, `google-api`.
- Classifier-in öz model çağırışı əsas agent-in modelini dəyişmir.
- `privacy.storePrompts` default `false`: tam prompt heç yerə yazılmır.

## Nəticələr
- Prompt xaricə getməzdən əvvəl istifadəçiyə açıq bildiriş göstərilir (Phase 2/3).
- Logger `prompt`, `text`, `content`, `messages` və s. sahələri `[OMITTED]` edir.
