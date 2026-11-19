# Smart Model Router

Coding agent-lər (ilk növbədə Claude Code) üçün hər turn-a model və reasoning effort seçən lokal router: CLI (`mr`), lokal daemon, Web Dashboard və Claude Code mod-u.

Bu, `npm run release` ilə yığılmış paketdir. Asılılığı yoxdur, Node.js **22.13+** kifayətdir (daxili `node:sqlite`).

## Quraşdırma

```bash
npm install -g smart-model-router-<versiya>.tgz
mr init          # config, token, baza
mr start         # daemon + dashboard (127.0.0.1)
mr doctor        # hər şey qaydasındadırmı
mr dashboard     # Web Dashboard
```

## Claude Code mod-u

Mod default olaraq **shadow** rejimindədir: modeli dəyişmir, yalnız tövsiyə yazır.

Quraşdırma (paketin qovluğu `mr status`-da `install:` sətrində görünür):

```bash
claude plugin marketplace add "<paketin qovluğu>"
claude plugin install smart-model-router@smart-model-router-local
claude plugin configure smart-model-router@smart-model-router-local   # daemonToken: mr init --show-token
```

Söndürmək: `claude plugin disable smart-model-router@smart-model-router-local`.
Silmək: `claude plugin uninstall smart-model-router@smart-model-router-local`.

## Silmə

```bash
mr uninstall                  # daemon-u dayandırır, nəyin qaldığını deyir
mr uninstall --purge --yes    # + config, token, baza və loglar silinir (geri qaytarılmır)
npm uninstall -g smart-model-router
```

Ətraflı: layihənin `docs/install.md` faylı.
