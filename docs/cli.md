# CLI və lokal daemon (Phase 4)

`mr` — Smart Model Router-in terminal komandası. Lokal daemon (`apps/server`) Claude Code mod-unun göndərdiyi qərarları SQLite-a yazır (ADR-003); `mr` həmin bazanı oxuyur.

```
Claude Code + mod ──(qərar, $.store buferi)──► POST /v1/records ──► daemon ──► smr.db ◄── mr stats / history
                     daemon işləmirsə buferdə qalır, növbəti turn-da göndərilir
```

## Komandalar

| Komanda | Nə edir |
|---|---|
| `mr init [--show-token] [--json]` | `config.json`, API token-i (yalnız sahibinə açıq fayl) və bazanı yaradır, mod üçün Claude Code ayarlarını çap edir. Token default olaraq gizlədilir; `--show-token` onu çap edir |
| `mr start` / `mr stop` | Daemon-u `127.0.0.1:<server.port>`-da işə salır / dayandırır. Hər ikisi əvvəl dinləyənin token-i bildiyini yoxlayır (aşağıda, HMAC sübutu). Stop token-li `/v1/shutdown` istəyir; dayanmasa, yalnız sübut verən daemon-un bildirdiyi pid pid faylındakı ilə eynidirsə onu öldürür |
| `mr dashboard [--no-open]` | Web Dashboard-u brauzerdə giriş edilmiş halda açır: daemon-dan birdəfəlik kod alır (token brauzerə getmir). `--no-open` linki çap edir. Bax [dashboard.md](dashboard.md) |
| `mr uninstall [--purge] [--yes]` | Daemon-u dayandırır. `--purge --yes` config, token, qaydalar, baza (+ backup-lar) və logları silir; `--purge` tək başına yalnız siyahını göstərir. Bax [install.md](install.md) |
| `mr status [--json]` | Daemon, token, rejim, saxlanmış qərar sayı, fayl yolları, quraşdırma qovluğu (`install: <qovluq> (source|release)`). Portu başqa proqram tutubsa bunu deyir; problem olsa xəta atmır, `problem:` sətri yazır |
| `mr agents [--json]` | Claude Code, Codex, Gemini CLI-ni tapır (`--version`) və nəyi dəstəklədiyini göstərir; nəticə bazaya yazılır |
| `mr models [--json]` | Registry: Claude Code adı, tier, status, qiymət, tarix, mənbə |
| `mr rules [list\|validate [file]\|path] [--json]` | Göndərilən və istifadəçi qaydaları (`rules.json`) |
| `mr stats [--since 24h\|7d\|2w\|all] [--json]` | Turn sayı (əsas/subagent), cavab verən modellər, statuslar, tapşırıq tipləri, token-lər, xərc; eyni token-lərin hər modeldə qiyməti |
| `mr history [--limit N] [--session id] [--status s] [--since p] [--reasons] [--json]` | Son qərarlar |
| `mr config [list\|get <key>\|set <key> <value>\|path]` | Ayarlar; `set` bütün faylı validasiya edir, səhv dəyər yazılmır |
| `mr doctor [--json]` | Node, ayarlar, token, baza (integrity), registry (qiymətlərin yaşı), qaydalar, daemon, Claude Code, mod build-i; `FAIL` varsa exit 1 |
| `mr benchmark [--file f] [--json]` | Router-i sabit strategiyalarla (həmişə haiku/sonnet/opus) etiketli prompt dəsti üzərində müqayisə edir; model çağırmır |

Xəta olanda `mr` bir sətir yazır və exit 1 qaytarır; stack trace göstərmir (lokal yollar ola bilər). `node:sqlite`-ın `ExperimentalWarning`-i yalnız o xəbərdarlıq üçün gizlədilir.

## Mod-u daemon-a qoşmaq

```bash
mr init            # mod ayarlarını çap edir (token gizlidir)
mr start
npm run build:mod
claude --plugin-dir dist/claude-code-mod --settings '<mr init-in çap etdiyi JSON>'
```

Mod ayarları: `daemonUrl` (default `http://127.0.0.1:4747`) və `daemonToken` (`sensitive`, Claude Code onu secure storage-da saxlayır). Mod yalnız loopback ünvanına (`127.0.0.1`, `localhost`, `[::1]`, `http`) göndərir — başqa ünvan yazılsa göndərmə söndürülür. Token yoxdursa qeydlər yalnız mod-un buferində qalır (`/route` statusu sayını göstərir).

Göndərmə: hər turn-dan sonra və sessiya başlayanda ən köhnə 50 qeyd göndərilir (hər sorğu 3 saniyə ilə məhdudlaşır). Əvvəl `GET /health?nonce=…` ilə daemon-un token-i bildiyi yoxlanır; sübut düz deyilsə token və qeydlər göndərilmir, səbəb `/route` statusunda görünür. daemon hər qeydə cavab verir (qəbul, təkrar, rədd), buna görə uğurlu cavabdan sonra paket buferdən silinir. Eyni qeydin təkrar göndərilməsi təhlükəsizdir (qərar id-si ilə təkrar sayılır).

## Daemon (`apps/server`)

| Endpoint | Auth | |
|---|---|---|
| `GET /health[?nonce=<32–64 hex>]` | yox | `{ ok, service, version, pid, proof? }`; `proof = HMAC-SHA256(token, "smr-health:" + nonce)` |
| `POST /v1/records` | Bearer token | `{ records: [...] }`, ən çox 500; cavab `{ accepted, duplicates, rejected: [{ index, reason }] }` |
| `POST /v1/shutdown` | Bearer token | cavabdan sonra dayanır |
| `GET /v1/routing` | Bearer token | agent inteqrasiyaları üçün qüvvədə olan qaydalar və scoring tənzimləmələri `{ rules, tuning }`; `rules.json` etibarsızdırsa 400 |
| `POST /v1/dashboard/code` | Bearer token | dashboard üçün birdəfəlik giriş kodu (60 saniyə) |
| `/api/*` | session açarı (`x-smr-session`) | dashboard API-si — bax [dashboard.md](dashboard.md) |
| `GET /`, `/assets/*` | yox | dashboard-un statik faylları |

Lokal müdafiə:
- yalnız `127.0.0.1`-də dinləyir (`server.host` yalnız loopback ola bilər);
- `Host` başlığı loopback ad + port olmalıdır (DNS rebinding) — yoxsa 421;
- `Origin` başlığı olan sorğu yalnız dashboard-un öz origin-indən (`http://<host>:<port>`) və yalnız `/v1/*` və `/health`-dən kənarda qəbul olunur, qalanı 403;
- token müqayisəsi sabit vaxtlıdır; body limiti 8 MB; 500 xətalarında detal qaytarılmır; saxlama xətası (dublikat deyil) bütün paketi 500 ilə rədd edir, göndərən paketi buferdə saxlayır;
- kimlik sübutu: klient (mod, `mr`) təsadüfi nonce göndərir, daemon HMAC ilə cavab verir. Bu yolla portu tutan başqa proqram nə token-i alır, nə də `mr stop` onun pid-ini öldürür;
- id və model sahələri yalnız identifikator simvolları qəbul edir (sərbəst mətn — prompt hissəsi — yazıla bilməz);
- qeyd sxemi `strict`-dir: tanınmayan sahə (məs. `prompt`) qeydi rədd etdirir.

Log: `<logDir>/server.log` (JSON, redaksiyalı); başlama xətaları da ora yazılır. Pid faylı (`0600`) daemon dinləməyə başlayanda yazılır, dayananda silinir.

Token faylı: POSIX-də `0600` ilə yaradılır və oxunanda yoxlanır (başqasına aid və ya qrupa/hamıya açıq fayl rədd edilir). **Windows-da** fayl icazəsi (mode) işləmir: fayl istifadəçi profilinin ACL-i ilə qorunur (`%USERPROFILE%` altında). Profil qovluğu başqalarına açıqdırsa token da açıqdır — açıq məsələ.

## Xərc

- Qiymətlər `data/pricing/`-dəki tarixli qeydlərdəndir; hər turn öz gününün qiyməti ilə hesablanır. 2026-11-19 qeydi bütün cache tariflərini əhatə edir.
- Cache write 5 dəqiqəlik tariflə hesablanır; 1 saatlıq cache işlənibsə real xərc daha yüksəkdir (usage onları ayırmır).
- Qiyməti bilinməyən hissə olan turn "unknown" sayılır, sıfır yox.
- `stats`-dakı "same tokens priced on one model" — eyni token-lərin başqa modeldə qiyməti, təxminidir (başqa model eyni sayda token yazmazdı).
- Subscription istifadəçisi üçün bunlar müqayisə rəqəmləridir, ödəniş deyil.

## Benchmark

`data/benchmark/prompts.json` — 30 prompt (EN + AZ), hər birinə "işi yaxşı görən ən ucuz tier" etiketi əl ilə qoyulub. `data/benchmark/holdout.json` — 12 əlavə prompt. Bunlar classifier qaydaları dəyişəndə həddən artıq uyğunlaşmanı yoxlamaq üçündür: `mr benchmark --file data/benchmark/holdout.json`. Bu ölçmə deyil, mühakimədir; öz dəstinizi `--file` ilə verə bilərsiniz.

Metrikalar: `match` (etiketlə eyni tier), `under` (zəif model — keyfiyyət riski), `over` (güclü model — artıq xərc), qiymət indeksi (seçilən modellərin qarışıq siyahı qiymətinin ortası / həmişə ən güclü model).

İlk nəticə (2026-11-19, qaydalarla classifier, AI classifier söndürülü):

| Strategiya | Match | Under | Over | Qiymət (opus = 1) |
|---|---|---|---|---|
| router | 26/30 (87%) | 1 | 3 | 0.539 |
| həmişə haiku | 10/30 | 20 | 0 | 0.025 |
| həmişə sonnet | 10/30 | 10 | 10 | 0.5 |
| həmişə opus | 10/30 | 0 | 20 | 1 |

İlk versiyada router-in səhvləri belə idi:
- kiçik adlandırma, rəng və import işləri sonnet-ə gedirdi (over);
- "production bazasında dublikatları silən skript" sonnet-ə getdi, gözlənilən isə opus idi (under).

Kalibrasiya (2026-11-19). Core-un əmsalları dəyişmədi, yalnız classifier qaydaları dəyişdi:
- `mechanical` siqnalı. Simvolun adını dəyişmək, istifadə olunmayan import-u silmək, rəngi və ya mətni dəyişmək kimi işlərin mürəkkəbliyi 0.2-də məhdudlaşır. Tapşırıq geniş, çətin və ya riskli olsa, məhdudiyyət tətbiq olunmur.
- `destructive` siqnalı. Saxlanan datanı silmək və ya üzərinə yazmaq mürəkkəbliyə +0.2 əlavə edir və düşünmə səviyyəsini `high` edir. Kodu silmək bu siqnala düşmür.
- `profile.js` kimi fayl adı artıq analiz sayılmır.
- `migrate` feli çətin iş kimi tanınır. Azərbaycanca `autentifikasiya` və `avtorizasiya` sözləri təhlükəsizlik siqnalı sayılır.

| Dəst | Əvvəl | Sonra |
|---|---|---|
| prompts.json (köklənmə) | 26/30, qiymət 0.539 | 30/30, qiymət 0.508 |
| holdout.json | 6/12 | 10/12 (köklənmədən əvvəl ölçülüb), 12/12 (son iki lüğət boşluğu dolduruldu) |

Holdout dəsti ilk dəfə köklənmədən əvvəl ölçüldü və 10/12 göstərdi. Son iki düzəliş onun səhvlərinə baxıb edildi, ona görə 12/12 artıq müstəqil ölçü deyil. Növbəti dəyişiklik üçün yeni, görülməmiş prompt-lar lazımdır. Etiketlər isə yenə də mühakimədir, ölçmə deyil.

## Test qeydi: Stop hook

Bu maşında global Stop hook (`stop-cleanup-bg-servers.js`) hər Claude Code turn-unun sonunda 3100–3109 portlarındakı listener-ləri öldürür. Headless `claude -p` də bu hook-u işlədir, ona görə test daemon-u həmin portlarda olanda yoxlama vaxtı ölür. Uçdan-uca yoxlama `--setting-sources project` ilə (user hook-ları yüklənmədən) aparıldı. Daemon-un real portu (`4747`) bu aralıqda deyil.
