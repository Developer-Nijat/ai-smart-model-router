# ADR-001: Routing Core təmiz funksiyalardır

**Status:** Qəbul edildi (2026-11-18)

## Kontekst
Routing qərarı üç fərqli yerdə işləməlidir: Claude Code mod-unun içində (Node yoxdur), CLI-da və lokal serverdə. Paralel sessiyalar bir-birinin state-inə toxunmamalıdır (AC-5).

## Qərar
`packages/core` yalnız təmiz funksiyalardan ibarətdir: `(input, settings, registry, sessionState) → decision`. Fayl, şəbəkə, proses, saat (`Date.now`), təsadüfi ədəd və qlobal dəyişən state yoxdur. Vaxt və id lazım olanda çağıran tərəf ötürür.

## Nəticələr
- Core esbuild ilə ESM-ə bundle olunub mod-a qoyula bilir (ADR-003).
- Sessiya state-i çağıranın əlindədir, ona görə izolyasiya təbiidir.
- `packages/core/test/purity.test.js` qadağan olunmuş modul və qlobalları mənbə kodda axtarır.
- Persistensiya, log və AI classifier çağırışı core-dan kənarda — adapter/server qatındadır.
