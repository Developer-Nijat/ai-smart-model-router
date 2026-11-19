# ADR-005: Dashboard — Vite + React SPA

**Status:** Qəbul edildi (2026-11-18), DISCUSSION-dakı Next.js seçimini əvəz edir. Phase 5-də (2026-11-19) tətbiq olundu.

## Kontekst
Dashboard tək istifadəçi üçün, lokal, 127.0.0.1-də işləyir. SSR, routing serveri və ayrıca Node prosesi lazım deyil.

## Qərar
Vite + React + Tailwind CSS ilə SPA. Build nəticəsi statik fayllardır və Fastify daemon-u tərəfindən verilir: bir proses, bir port.

shadcn/ui-nin CLI-si əvəzinə onun üslubunda bir neçə komponent (`Card`, `Table`, `Button`, `Badge`...) əl ilə yazıldı (`apps/dashboard/src/components/ui.jsx`). Dashboard-a cəmi bir neçə komponent lazımdır, shadcn isə onsuz da kodu layihəyə kopyalayır. Radix və əlavə asılılıq gətirmək dəyməzdi.

## Nəticələr
- `mr start` yalnız bir server işə salır; `mr dashboard` brauzeri giriş edilmiş halda açır.
- API token-i brauzerə verilmir. `mr dashboard` birdəfəlik kod alır, SPA onu session açarına dəyişir və açarı `sessionStorage`-də saxlayır. Cookie istifadə olunmur, çünki cookie port-a bağlı deyil. Bax [dashboard.md](../dashboard.md).
- Vite dev server istifadə olunmur (başqa origin); UI build edilib daemon üzərindən yoxlanır.
