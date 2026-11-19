# Lokal Web Dashboard (Phase 5)

Dashboard lokal daemon-un (`apps/server`) verdiyi Vite + React SPA-dır (ADR-005): ayrıca server və ya port yoxdur, `mr start` hər ikisini işə salır. Bütün məlumat lokal SQLite bazasından və `config.json` / `rules.json` fayllarından gəlir. İnternetə heç nə göndərilmir.

## İşə salmaq

```bash
npm run build:dashboard   # apps/dashboard/dist/ — daemon bunu başlayanda yaddaşa oxuyur
mr start                  # build-dən sonra daemon-u yenidən başladın (mr stop && mr start)
mr dashboard              # brauzeri giriş edilmiş halda açır
mr dashboard --no-open    # linki çap edir (brauzer açılmırsa)
```

Build olunmayıbsa daemon `/` ünvanında `dashboard not built: npm run build:dashboard` cavabı verir.

## Səhifələr

| Səhifə | Nə göstərir / nə edir |
|---|---|
| **Overview** | Dövr seçimi (24 saat, 7, 30, 90 gün, hamısı). Turn sayı (əsas/subagent), sessiyalar, təxmini API-ekvivalent xərc, token-lər. Paylanmalar: cavab verən model, router-in seçdiyi model, tapşırıq tipi, status, qərar mənbəyi, rejim. "Same tokens priced on one model" cədvəli |
| **Routing history** | Hər qərar, ən yenisi əvvəldə; status/dövr/say filtrləri. "Why" klassifikasiyanı, səbəbi, token-ləri və sessiyanı açır. Prompt mətni saxlanmır |
| **Routing rules** | Göndərilən və istifadəçi qaydaları. İstifadəçi qaydasını aktiv/deaktiv etmək, silmək, JSON kimi redaktə etmək, şablonla əlavə etmək. Hər yazma bütün siyahını validasiya edir: bir səhv qayda varsa heç nə yazılmır |
| **Agents** | Aşkarlanan agentlər, versiyalar, routing imkanları (turn, subagent, effort); "Detect again" |
| **Models** | Registry, mənbəli qiymətlər (input, output, cache read/write) və qiymət tarixi. Qiyməti olmayan xana `—` göstərir |
| **Settings** | `config.json` formu. Validasiya serverdədir; port/host dəyişəndə restart lazım olduğu deyilir |

Tema: dark default; light seçimi brauzerdə (localStorage) yadda qalır.

## Nə Claude Code-a çatır

Mod hər sessiya başlayanda, daemon HMAC sübutu verdikdən sonra `GET /v1/routing` ilə bunları alır:

- **qaydalar**: göndərilənlər + istifadəçinin `rules.json`-u (dashboard-da redaktə olunan). Yalnız aktiv olanlar, prioritet sırası ilə;
- **scoring tənzimləmələri**: `routing.sticky` və `routing.weights`.

Mod son alınan nüsxəni `$.store`-da saxlayır: daemon işləməyəndə həmin nüsxəni istifadə edir. Etibarsız qaydalar heç vaxt etibarlıları əvəz etmir. `/route` statusu mənbəni göstərir: `rules: N (from the daemon | last copy from the daemon | shipped with the build)`.

**Çatmayanlar (qəsdən):** routing rejimi, privacy rejimi və AI classifier. Bunlar razılıqdır, tənzimləmə deyil. Claude Code-da modun öz ayarlarından (`/plugin` → configure) və `/route`-dan gəlir. Settings səhifəsi bunu yazır. Dashboard-dakı dəyərlər `mr init`-in mod üçün çap etdiyi başlanğıc dəyərlərdir.

## Təhlükəsizlik

API token-i brauzerə heç vaxt çatmır:

1. `mr dashboard` token ilə `POST /v1/dashboard/code` edir və **birdəfəlik kod** alır (60 saniyə, bir dəfə; ən çox 10 gözləyən kod).
2. Brauzer `http://127.0.0.1:<port>/#code=<kod>` ilə açılır. Fragment serverə və Referer-ə getmir. Səhifə kodu dərhal ünvandan və tarixçədən silir.
3. SPA kodu `POST /api/session` ilə **session açarına** (12 saat; ən çox 20 aktiv) dəyişir. Açar tabın `sessionStorage`-ində saxlanır və `x-smr-session` header-i ilə göndərilir.

Niyə cookie deyil: cookie port-a bağlı deyil. Brauzer onu `127.0.0.1`-dəki **başqa portlara** da göndərərdi, oradakı istənilən lokal server onu oğurlaya bilərdi. `sessionStorage` isə origin-ə (sxem + host + port) bağlıdır. Header-lə göndərmə CSRF-i də aradan qaldırır: başqa sayt brauzerə bu header-i göndərtdirə bilməz.

Server tərəfi:
- `Host` loopback ad + port olmalıdır (DNS rebinding → 421);
- `Origin` yalnız dashboard-un öz origin-i olanda qəbul olunur, `/v1/*` və `/health`-də isə heç vaxt;
- CSP: `default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`, həmçinin `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`;
- statik fayllar başlanğıcda yaddaşa oxunur və yalnız dəqiq ad ilə tapılır. Sorğu yolu fayl sisteminə çatmır (traversal yoxdur), tanınmayan fayl tipləri verilmir;
- `/api/*` sorğu və body-ləri Fastify JSON schema ilə yoxlanır. Qaydalar (ən çox 200) və ayarlar Zod schema ilə validasiya olunur və atomik yazılır.

Daemon yenidən başlayanda bütün session-lar bitir. Səhifə bunu deyir və `mr dashboard` istəyir.

Mod daemon-dan gələn routing yükünü məhdudlaşdırır: ən çox 500 qayda, 1 MB cavab. Hər qaydada ən çox 50 açar söz (hər biri 100 simvola qədər) və 20 agent ola bilər. Səbəb: qaydalar hər turn-da yoxlanır.

Bilinən qalıq risklər:
- Giriş linki brauzeri açan prosesin komanda sətrində təxminən bir dəqiqə görünür. Eyni OS istifadəçisi üçün yeni heç nə açmır, çünki token faylı onsuz da oxunur. Çox istifadəçili maşında isə kiçik riskdir: kodu ilk işlədən 12 saatlıq session alır. Ehtiyat üçün `mr dashboard --no-open`.
- HMAC sübutu və `/v1/routing` sorğusu ayrı bağlantılardır. Real daemon işləyərkən portu tuta bilən proxy nəzəri olaraq araya girə bilər. Bunun üçün portu artıq idarə etmək lazımdır.
- Session-un sabit 12 saatlıq ömrü var; boş qalma timeout-u yoxdur.

## Development

```bash
npm run build:dashboard                # build
npx vitest run apps/dashboard          # komponent və API klient testləri (jsdom)
```

Vite dev server istifadə olunmur: daemon başqa origin-dən gələn brauzer sorğularını qəbul etmir. UI-ı build edib `mr stop && mr start` ilə yoxlayın.

Qrafiklər tək seriyalı üfüqi barlardır (bir rəng: `#2a78d6` light / `#3987e5` dark, dataviz validatorundan keçib). Hər bar sayı və payı mətnlə yazır, yəni identiklik yalnız rənglə verilmir. 8-dən çox kateqoriya "other"-ə yığılır.

## Məhdudiyyətlər

- `apps/dashboard` ESLint-dən kənardadır (JSX üçün React plugin-i yoxdur). Keyfiyyəti testlər və build yoxlayır.
- Dar ekran (telefon) üçün layout `md:` breakpoint-ləri ilə qurulub, amma vizual olaraq yalnız desktop enində yoxlanıb.
- Overview-dakı "Model switches" və "Classifier calls" vidjetləri (DISCUSSION) yoxdur: model dəyişməsi ayrıca saxlanmır, uydurma rəqəm göstərilmir. "Decided by" paylanması classifier mənbələrini göstərir.
