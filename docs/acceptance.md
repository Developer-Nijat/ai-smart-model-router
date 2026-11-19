# Qəbul meyarları (AC-1 … AC-15): vəziyyət

Meyarlar [00-feasibility-and-phase1-plan.md](00-feasibility-and-phase1-plan.md)-dən götürülüb. Vəziyyət 2026-11-19, Phase 6 sonuna aiddir.

| AC | Meyar | Vəziyyət | Sübut |
|---|---|---|---|
| AC-1 | Sadə tapşırıq AI classifier çağırmadan yönləndirilir | ✅ | `packages/core/test/hybrid.test.js` (AC-1) |
| AC-2 | Qeyri-müəyyən tapşırıqda AI classifier işə düşür (rejim icazə veribsə) | ✅ | `hybrid.test.js` (AC-2) |
| AC-3 | Manual override hər şeydən üstündür | ✅ | `decide.test.js` (AC-3); mod: `register.test.ts` "a manual override applies even in shadow mode" |
| AC-4 | Effort modelin dəstəklədiyi səviyyə ilə məhdudlaşır | ✅ | `decide.test.js`, `rules-effort-cost.test.js` (AC-4). Effort-un Claude Code-da tətbiqi real probe ilə ölçülüb ([integration](claude-code-integration.md#real-yoxlama-2026-11-19-claude-code-21328-headless)) |
| AC-5 | Paralel sessiyalar bir-birinə toxunmur | ✅ | `decide.test.js`, `scoring-session.test.js` (AC-5); core-un təmizliyi `purity.test.js` ilə yoxlanır |
| AC-6 | Böyük kontekstdə lazımsız keçid olmur | ✅ | `decide.test.js` (AC-6) |
| AC-7 | Yüksək riskli tapşırıq sticky-ni keçə bilir | ✅ | `decide.test.js` (AC-7) |
| AC-8 | Adapter dəstəkləmədiyi əməliyyatı icra olunmuş göstərmir | ✅ | `decide.test.js` (AC-8), `packages/adapters/test`, `tests/contract` |
| AC-9 | Turn daxilində model sabitdir | ✅ (qismən real) | Plan turn başlayanda bir dəfə qurulur və hər `turn.step`-də eyni model/effort göndərilir (`register.test.ts`). Real headless sessiyalarda cavab verən model plana uyğun idi. Çox addımlı tool loop ayrıca ölçülməyib |
| AC-10 | Shadow mode modeli dəyişmir | ✅ real | headless: `shadow`-da sessiyanın modeli qaldı; `register.test.ts` "shadow mode changes nothing" |
| AC-11 | Classifier/daemon əlçatmaz olanda işləmə davam edir | ✅ real | `hybrid.test.js` (AC-11); `register.test.ts` "without a daemon the records stay buffered"; real: daemon yoxkən toplanan qeydlər sonrakı sessiyada çatdı |
| AC-12 | Dashboard real history göstərir | ✅ | `tests/integration/daemon-lifecycle.test.js` (AC-12, real proseslər); `scripts/smoke-release.js` (quraşdırılmış paket); brauzerdə əl ilə yoxlanıb |
| AC-13 | Yeniləmədə məlumat qorunur | ✅ | `packages/storage/test/storage.test.js`: v1 → v2 miqrasiyası məlumatı saxlayır, əvvəlcə backup, uğursuz backup yeniləməni dayandırır (Linux-da tapılan xəta Phase 6-da düzəldildi) |
| AC-14 | Lokal təhlükəsizlik | ✅ | `apps/server/test/*.test.js`: yalnız loopback Host, token-siz 401, yad Origin 403, session-suz `/api/*` 401; qeyd sxemi `strict`dir (`prompt` sahəsi rədd edilir); `decide.test.js` (AC-14) |
| AC-15 | Uydurma rəqəm yoxdur | ✅ | Hər qiymətin `sourceUrl` və `asOf`-u var (schema məcburi edir). Bilinməyən qiymət `—` göstərilir, heç vaxt `$0` yox. Müqayisə yalnız bütün modellər üçün qiyməti məlum olan turn-lar üzərindədir. Dashboard-da mənbəsi olmayan vidjet yoxdur |

## Açıq qalanlar (bilinən məhdudiyyətlər)

- **İnteraktiv `/route`** real interaktiv sessiyada əl ilə yoxlanmayıb. Komandalar `claude plugin test` ilə yoxlanılır, headless `-p` rejimində isə mod komandaları işləmir. İstifadəçinin qərarı: mod hazır olana qədər onun Claude Code-unda aktiv edilmir.
- **macOS** yalnız CI matrisindədir və burada işə salınmayıb.
- **Effort geri oxunmur:** Claude Code usage-də effort-u qaytarmır. `appliedEffort` göndərilən səviyyədir.
- **Cache write** 5 dəqiqəlik tariflə hesablanır (aşağı hədd).
- **Classifier kalibrasiyası:** benchmark 30/30, holdout 10/12 (köklənmədən əvvəl). Etiketlər mühakimədir və dəstlər kiçikdir: real istifadədə `mr stats` ilə izləmək lazımdır (bax `cli.md`).
- **Dashboard telefon eni** vizual yoxlanmayıb.
- **CI action-ları** `@v4` tag-ları ilə bağlanıb, commit SHA-ları ilə yox.
- **`mr doctor` ACL yoxlaması** SYSTEM və Administrators-u ingiliscə adlarına görə tanıyır. Lokallaşdırılmış Windows-da yanlış xəbərdarlıq verə bilər, amma xəta vermir. DENY qaydalarına baxmır.
- **Paylaşılan `SMR_HOME`:** başqalarının yaza bildiyi qovluqda əvvəlcədən qoyulmuş token qəbul oluna bilər (bax `install.md`).
