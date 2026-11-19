# ADR-003: Qərar mod-da, persistensiya daemon-da

**Status:** Qəbul edildi (2026-11-18), bundle hissəsi spike ilə təsdiqləndi

## Kontekst
`turn.step` hər model sorğusunun yolundadır (hot path). Mod modulunda Node yoxdur, ona görə SQLite orada açıla bilməz. Mod faylları başqa plugin fayllarını `import` edə bilir, amma hamısı ES module kimi yüklənir.

## Qərar
- **Qərar mod-un içində verilir:** `packages/core` (CommonJS) esbuild ilə `--format=esm --platform=neutral` bundle edilir və mod qovluğuna qoyulur. Şəbəkə gecikməsi və daemon asılılığı yoxdur.
- **Persistensiya ayrıca daemon-dadır:** `mr start` Fastify + SQLite prosesini 127.0.0.1-də işə salır. Mod qərarları `$.http.fetch` ilə göndərir.
- **Daemon işləmirsə:** qərarlar `$.store`-da məhdud ölçülü buferdə saxlanır və daemon qayıdanda göndərilir. Routing dayanmır (AC-11).

## Nəticələr
- Core-un I/O-suz olması məcburidir (ADR-001).
- Bundle addımı build-ə əlavə olunur; bundle-dakı mütləq yollar (esbuild şərhləri) release build-də `--legal-comments=none` və nisbi yollarla təmizlənməlidir.
