# ADR-010: Qərar turn səviyyəsindədir

**Status:** Qəbul edildi (2026-11-18), spike ilə təsdiqləndi

## Kontekst
`turn.step`-də model dəyişikliyi yalnız bir sorğuya aiddir. Bir turn tool loop-u ilə çox addımdan ibarət ola bilər. Prompt cache modelə bağlıdır: keçid cache-i sıfırlayır.

## Qərar
- Qərar `turn.start`-da verilir və həmin turn-un **bütün** `turn.step`-lərinə eyni şəkildə tətbiq olunur.
- Prioritet: manual override > custom rule > sticky > avtomatik seçim > fallback.
- Subagent turn-ları (`agentId`) ayrıca qərar alır.

## Nəticələr
- Turn ortasında model dəyişmir (AC-9). Spike-da 2 addımlı turn tamamilə eyni modeldə qaldı.
- Sticky routing keçidin cache xərcini nəzərə alır (Phase 2).
