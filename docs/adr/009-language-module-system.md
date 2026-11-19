# ADR-009: Backend JavaScript/CommonJS, mod TypeScript

**Status:** Qəbul edildi (2026-11-18)

## Kontekst
Master prompt backend üçün JavaScript + CommonJS tələb edir. Claude Code mod-ları isə `.ts`/`.tsx` hooks modulu kimi yazılır və ES module kimi yüklənir.

## Qərar
- `packages/*` və `apps/cli`, `apps/server`: JavaScript, CommonJS, JSDoc tipləri, `'use strict'`.
- `integrations/claude-code-mod`: TypeScript (Mods API-nin tələbi), nazik qat — məntiq core-dadır.
- Core mod-a ESM bundle kimi daxil olur (ADR-003).

## Nəticələr
- İki dil var, amma TS yalnız inteqrasiya sərhədindədir.
