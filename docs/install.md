# Quraşdırma, yeniləmə, silmə (Phase 6)

## Tələblər

| | Versiya | Niyə |
|---|---|---|
| Node.js (proqramın işləməsi) | **22.13+** | daxili `node:sqlite` |
| Node.js (development: testlər) | **22.22+** və ya 24 | dashboard UI testlərindəki jsdom 31 |
| Claude Code (mod üçün) | **2.1.327+** | Mods API |
| OS | Windows, Linux, macOS | bax "Platformalar" |

## 1. Release paketindən (tövsiyə olunur)

Paketi yığmaq (repo-da):

```bash
npm ci
npm run release        # release/smart-model-router-<versiya>.tgz
```

Paket öz-özünə kifayətdir: CLI və daemon esbuild ilə bundle olunub, `node_modules` lazım deyil. Dashboard və Claude Code mod-u da qurulmuş halda içindədir.

```bash
npm install -g release/smart-model-router-0.1.0.tgz
mr init            # config, token (yalnız sahibinə açıq), SQLite baza
mr start           # daemon + dashboard, 127.0.0.1:4747
mr doctor          # yoxlama: hamısı ok/warn olmalıdır
mr dashboard       # brauzerdə
```

`mr status` paketin qovluğunu göstərir: `install: <qovluq> (release)`.

## 2. Claude Code mod-unu qoşmaq

Mod default olaraq **shadow** rejimindədir: modeli dəyişmir, yalnız nə seçərdiyini yazır. `/route auto` ilə və ya ayarlardan `defaultMode: auto` ilə işə düşür.

```bash
claude plugin marketplace add "<install qovluğu>"
claude plugin install smart-model-router@smart-model-router-local
```

Sonra Claude Code-da `/plugin` → `smart-model-router` → configure:
- `daemonToken`: `mr init --show-token` ilə görünən token. Claude Code bu sahəni secure storage-da saxlayır;
- `daemonUrl`: port dəyişibsə `http://127.0.0.1:<port>`;
- `defaultMode`: `shadow` (default) / `auto` / `off`.

Yoxlama: Claude Code sessiyasında `/route` statusu göstərməlidir: rejim, `daemon: http://127.0.0.1:4747 (0 buffered)`, `rules: N (from the daemon)`.

| Əməliyyat | Komanda |
|---|---|
| Müvəqqəti söndürmək | `claude plugin disable smart-model-router@smart-model-router-local` (və ya sessiyada `/route off`) |
| Yenidən qoşmaq | `claude plugin enable smart-model-router@smart-model-router-local` |
| Silmək | `claude plugin uninstall smart-model-router@smart-model-router-local` |

Marketplace qovluqdur, ona görə Claude Code mod-u birbaşa həmin qovluqdan oxuyur. Paketi yenilədikdən sonra Claude Code-da `/reload-plugins` kifayətdir.

Bu ardıcıllıq (marketplace add, install, list, disable, uninstall) 2026-11-19-da Claude Code 2.1.328 ilə **izolə edilmiş config qovluğunda** (`CLAUDE_CONFIG_DIR`) yoxlanıb. İnteraktiv sessiyada `/route` komandasının əl ilə yoxlanması istifadəçiyə qalır: mod hazır olana qədər onun öz Claude Code-unda aktiv edilmədi.

## 3. Mənbədən (development)

```bash
git clone <repo> smart-model-router && cd smart-model-router
npm ci
npm run build:dashboard
npm run build:mod
node apps/cli/bin/mr.js init && node apps/cli/bin/mr.js start
claude --plugin-dir dist/claude-code-mod      # mod yalnız bu sessiyada
```

## Yeniləmə

```bash
mr stop
npm install -g release/smart-model-router-<yeni>.tgz
mr start           # açılanda baza miqrasiya olunur
```

- Məlumat proqramın qovluğunda yox, istifadəçi qovluğunda saxlanır (aşağıda). Yeniləmə ona toxunmur.
- Miqrasiyadan əvvəl baza avtomatik `smr.db.bak-v<köhnə versiya>-<vaxt>` faylına kopyalanır (`VACUUM INTO`, yoxlanır). Miqrasiya alınmasa baza dəyişmir.
- Yeni proqram köhnəni qəbul edir, əksinə yox: köhnə proqram yeni sxemli bazanı açmaqdan imtina edir.
- `config.json` schema ilə yoxlanır; yeni sahələr default dəyərlə doldurulur.

## Məlumat harada saxlanır

| OS | Config, token, qaydalar | Baza, pid | Loglar |
|---|---|---|---|
| Windows | `%APPDATA%\smart-model-router` | `%LOCALAPPDATA%\smart-model-router` | `%LOCALAPPDATA%\smart-model-router\logs` |
| macOS | `~/Library/Application Support/smart-model-router` | eyni | `~/Library/Logs/smart-model-router` |
| Linux | `$XDG_CONFIG_HOME/smart-model-router` (`~/.config`) | `$XDG_DATA_HOME/smart-model-router` (`~/.local/share`) | `$XDG_STATE_HOME/smart-model-router/logs` |
| `SMR_HOME=<qovluq>` | hamısı orada | | `<qovluq>/logs` |

Token faylı: POSIX-də `0600`, oxunanda yoxlanır. Windows-da yeni token əvvəlcə boş fayl kimi yaradılır. Sonra onun ACL-i yalnız cari istifadəçinin SID-inə daraldılır (`System32\icacls.exe /inheritance:r /grant:r *<SID>:F`), token isə bundan sonra yazılır. Daraltmaq alınmasa, fayl silinir və `mr init` xəta verir. Mövcud token hər `mr init`-də və daemon başlayanda yenidən daraldılır. `mr doctor` başqa kimin oxuya bildiyini göstərir. Diqqət: `SMR_HOME` başqalarının yaza bildiyi qovluğa yönəlsə, orada əvvəlcədən qoyulmuş token qəbul oluna bilər. Data qovluğunu yalnız özünə məxsus yerdə saxla.

## Silmə

```bash
mr uninstall                    # daemon-u dayandırır, məlumatı saxlayır, nə qaldığını deyir
mr uninstall --purge            # nəyin silinəcəyini göstərir, heç nə silmir
mr uninstall --purge --yes      # config, token, qaydalar, baza (+ backup-lar), loglar silinir
claude plugin uninstall smart-model-router@smart-model-router-local
npm uninstall -g smart-model-router
```

`--purge` yalnız bu proqramın yazdığı faylları adla silir. Qovluq yalnız boş qalanda silinir, ona görə `SMR_HOME` başqa fayllar olan qovluğa baxırsa, onlar qalır.

## Platformalar

| Platforma | Necə yoxlanıb |
|---|---|
| Windows 11 (Node 24, Claude Code 2.1.328) | bütün testlər, release + smoke, brauzerdə dashboard, real Claude Code headless, izolə edilmiş plugin quraşdırması |
| Linux (Debian bookworm, Docker) | Node 22.23: lint, bütün testlər (+coverage), release + smoke. Node 22.13.0: release + smoke (proqram işləyir; dev testləri üçün 22.22+ lazımdır) |
| macOS | burada yoxlanmayıb. `.github/workflows/ci.yml` matrisi macOS-u da əhatə edir, amma repo hələ push olunmayıb |

## Problemlər

| Əlamət | Səbəb / həll |
|---|---|
| `mr start`: `port 4747 is held by a program that did not prove it is this daemon` | Portu başqa proqram tutub: `mr config set server.port <n>`, sonra mod-da `daemonUrl`-i dəyiş |
| `/route`: `daemon not reachable (mr start); records kept` | Daemon işləmir. Qeydlər mod-un buferində qalır və daemon qalxanda göndərilir |
| `/route`: `daemon refused the token (run mr init and update daemonToken)` | Mod-dakı `daemonToken` köhnədir: `mr init --show-token` |
| Dashboard: `dashboard not built` | Mənbədən işləyirsənsə: `npm run build:dashboard`, sonra `mr stop && mr start` |
| Dashboard: "your session ended" | Daemon yenidən başlayıb və ya 12 saat keçib: `mr dashboard` |
| `mr doctor`: `token ... readable by ...` (Windows) | `mr init` ACL-i yenidən daraldır |
| Sessiyalarda heç bir model dəyişmir | Rejim `shadow`-dur (default): `/route auto` |
