# Smart Model Router

Coding agent-lər (ilk növbədə Claude Code) üçün tapşırığa görə model və reasoning effort seçən, agent-dən asılı olmayan lokal routing platforması.

> **Status:** 0.1.0 (MVP): altı mərhələnin hamısı tamamlandı. Foundation, routing engine, Claude Code inteqrasiyası, CLI + lokal daemon, Web Dashboard, hardening və release paketi. Qəbul meyarları: [docs/acceptance.md](docs/acceptance.md). Dəyişikliklər: [CHANGELOG.md](CHANGELOG.md).
> Plan: [docs/00-feasibility-and-phase1-plan.md](docs/00-feasibility-and-phase1-plan.md)

## Tələblər

- Node.js **22.13+** proqramın işləməsi üçün (daxili `node:sqlite`); development testləri üçün **22.22+** və ya 24
- npm 10+
- Windows, Linux və ya macOS
- Claude Code 2.1.327+ (mod üçün)

## Claude Code plugin-i (marketplace)

Claude Code-da (2.1.275+), bir sətirlə:

```
/plugin install smart-model-router --marketplace Developer-Nijat/ai-smart-model-router
```

Və ya iki addımda:

```
/plugin marketplace add Developer-Nijat/ai-smart-model-router
/plugin install smart-model-router@smart-model-router
```

Plugin `shadow` rejimində başlayır: model dəyişmir, yalnız tövsiyələri yazır. `/route auto` onu işə salır, `/route help` bütün əmrləri göstərir. Daemon olmadan da işləyir, qərarlar plugin-in öz yaddaşında saxlanır. Tarixçə, dashboard və öz qaydaların üçün aşağıdakı CLI və daemon-u qur. Sonra `/plugin configure smart-model-router@smart-model-router` ilə `daemonToken`-i (`mr init --show-token`) daxil et.

## Quraşdırma (istifadə)

```bash
npm run release                                    # release/smart-model-router-0.1.0.tgz
npm install -g release/smart-model-router-0.1.0.tgz
mr init && mr start && mr doctor
```

Claude Code mod-u, yeniləmə, silmə və problemlər: [docs/install.md](docs/install.md).

## Quraşdırma (development)

```bash
git clone https://github.com/Developer-Nijat/ai-smart-model-router.git smart-model-router
cd smart-model-router
npm install
npm test          # bütün testlər
npm run coverage  # coverage hesabatı (hədd 80%)
npm run lint
node apps/cli/bin/mr.js --version
npm run build:mod  # Claude Code mod-u → dist/claude-code-mod/
node apps/cli/bin/mr.js init     # config, token, baza; mod ayarlarını çap edir
npm run build:dashboard          # Web Dashboard → apps/dashboard/dist/
npm run release                  # asılılıqsız paket → release/ (+ node scripts/smoke-release.js)
node apps/cli/bin/mr.js start    # lokal daemon + dashboard
node apps/cli/bin/mr.js dashboard  # brauzerdə, giriş edilmiş halda
node apps/cli/bin/mr.js doctor
```

## Struktur

```
.claude-plugin/      marketplace.json: bu repo Claude Code marketplace-dir
plugins/             qurulmuş plugin (npm run build:plugin; CI mənbə ilə uyğunluğunu yoxlayır)
apps/cli/            mr komandası (init, start, stop, status, dashboard, agents, models, rules, stats, history, config, doctor, benchmark, uninstall)
apps/server/         lokal daemon: mod-un qərarlarını SQLite-a yazır, mod-a qaydaları verir, dashboard-u və API-sini verir
apps/dashboard/      Web Dashboard (Vite + React + Tailwind SPA)
packages/shared/     sabitlər, xətalar, Zod schema-ları
packages/config/     data qovluğu, config.json
packages/logger/     redaksiyalı JSON logger
packages/storage/    node:sqlite, migration-lar, repository-lər
packages/adapters/   agent adapter müqaviləsi; Claude Code, Codex, Gemini CLI adapterləri
packages/claude-code-mod/  Claude Code mod-u: routing məntiqi (src/), mod faylları (mod-src/), build
packages/core/       təmiz routing nüvəsi: classifier, qaydalar, scoring, decide()
data/                model registry, qiymətlər (mənbə + tarix), default qaydalar, benchmark dəsti
scripts/             release paketi (release.js) və onun smoke testi (smoke-release.js)
.github/workflows/   CI: Windows/Linux/macOS × Node 22/24, Node 22.13-də quraşdırılmış paket
tests/contract/      adapter contract testləri
spikes/              atılacaq texniki sınaqlar
docs/                arxitektura, ADR-lər, spike hesabatları
```

## Sənədlər

- [Arxitektura](docs/architecture.md)
- [Routing engine](docs/routing-engine.md)
- [Claude Code inteqrasiyası](docs/claude-code-integration.md)
- [CLI və lokal daemon](docs/cli.md)
- [Web Dashboard](docs/dashboard.md)
- [Quraşdırma, yeniləmə, silmə](docs/install.md)
- [Qəbul meyarları](docs/acceptance.md)
- [Architecture Decision Records](docs/adr/README.md)
- [Claude Code spike hesabatı](docs/spike-claude-code.md)

## Məxfilik

Default olaraq: routing yalnız lokal qaydalarla (`privacy.mode = local-only`), AI classifier söndürülüb, tam prompt mətni heç yerə yazılmır, lokal API yalnız `127.0.0.1`-də.
