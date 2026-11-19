# ADR-004: `node:sqlite` + öz migration runner-i

**Status:** Qəbul edildi (2026-11-18)

## Kontekst
`better-sqlite3` native moduldur: hər Node versiyası və OS üçün prebuild və ya kompilyator tələb edir. Node 22.13+ daxili `node:sqlite` (`DatabaseSync`) flag-sız işləyir, amma `ExperimentalWarning` verir.

## Qərar
- `node:sqlite` istifadə olunur; `engines.node` = `>=22.13.0`.
- Migration-lar `packages/storage/src/migrations/NNN_name.sql` faylları, hər biri ayrıca transaction-da; `schema_migrations` cədvəlində versiya və SHA-256 checksum.
- Runner bunları rədd edir: tətbiq olunmuş faylın dəyişməsi, proqramdan yeni DB versiyası, ardıcıl olmayan nömrələr.
- Məlumatı olan DB yenilənməzdən əvvəl `VACUUM INTO` ilə backup yazılır.
- File DB-lər WAL rejimində, `foreign_keys=ON`, `busy_timeout=5000`.

## Nəticələr
- Native build yoxdur — Windows/Linux/macOS quraşdırması sadədir.
- API experimental olduğu üçün bütün SQLite çağırışları `packages/storage` arxasındadır; lazım olsa `better-sqlite3`-ə keçid yalnız həmin paketi dəyişir.
- `ExperimentalWarning` CLI-da Phase 4-də idarə olunacaq.
