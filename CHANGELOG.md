# Dəyişikliklər

## Buraxılmamış

- **Canlı routing mesajları:** model seçilən anda transcript-də ikonlu sətir görünür (▼ ucuz modelə, ▲ güclü modelə, ■ sticky, ◇ shadow, ✎ override, ⚑ qayda, ↳ subagent). Bundan əlavə, prompt-un üstündə rəngli zolaq çıxır və status sətri yenilənir. Səviyyəsi yeni `liveMessages` ayarı ilə seçilir: `on`, `band` və ya `off`. Hook modulu `register.tsx` oldu.
- **Sticky yalnız bahalı modelə keçiddə:** `minScoreGain` artıq ucuz modelə keçidi bloklamır. Real testdə "Rename the variable" sonnet-də qalırdı, halbuki haiku 0.025 daha yaxşı idi. Shell əmri də opus-da qalırdı, halbuki sonnet 0.13 daha yaxşı idi.
- **`/route` model üçün qeyd buraxır:** əmrin cavabı əvvəlki kimi yalnız istifadəçiyə göstərilir. Model isə əmrin plugin tərəfindən işləndiyi barədə sabit bir qeyd alır. Əvvəl model hər dəfə "/route skill-i qeydiyyatda deyil" yazırdı.
- **Ölçü sifətləri:** "small", "simple", "kiçik" kimi sözlər artıq yaradılan şeyi təsvir edəndə trivial sayılmır. Məsələn, "Create a small Express API" əvvəl haiku-ya gedirdi, indi sonnet-ə gedir. "Fix the small typo" isə əvvəlki kimi haiku-da qalır.
- **İlk turn-da sticky yoxdur:** `minScoreGain` yalnız router sessiyada artıq qərar verəndən sonra işləyir. Əvvəl yeni sessiya default modeldə (opus) qalırdı, çünki sonnet cəmi 0.083 fərqlə daha yaxşı idi.
- **Keçid xərci qiymətə görə hesablanır:** model dəyişmənin cəriməsi indi kontekst yükü × hədəf modelin nisbi qiymətidir, aşağı hədd 0.25. Real `/route` testində ~73k kontekstlə opus-dan sonra gələn typo opus-da qalırdı. İndi haiku-ya keçir. Bahalı modelə keçid əvvəlki kimi tam cərimələnir.
- **Classifier kalibrasiyası:** yeni `mechanical` və `destructive` siqnalları əlavə olundu. `profile.js` kimi fayl adları artıq analiz sayılmır. `migrate` feli və azərbaycanca autentifikasiya sözləri tanınır. Benchmark 26/30-dan 30/30-a qalxdı. Yeni `holdout.json` dəstində nəticə köklənmədən əvvəl 10/12 idi, köhnə classifier bu dəstdə 6/12 göstərirdi.

## 0.1.0 — 2026-11-19

İlk buraxılış (MVP), altı mərhələdə.

- **Phase 1 — Foundation:** npm workspaces, Zod schema-ları, config (OS-ə görə qovluqlar, atomik yazma), redaksiyalı logger, `node:sqlite` + miqrasiyalar + backup, adapter müqaviləsi.
- **Phase 2 — Routing engine:** təmiz core: rules classifier, AI classifier müqaviləsi (privacy rejimləri), qaydalar, effort, mənbəli qiymətlərlə xərc, scoring, sticky routing, `decide()`.
- **Phase 3 — Claude Code inteqrasiyası:** Mods API ilə turn və subagent səviyyəsində model və effort seçimi, shadow rejimi default, `/route` komandaları, real Claude Code ilə headless yoxlama.
- **Phase 4 — CLI və lokal daemon:** `mr` (init, start, stop, status, agents, models, rules, stats, history, config, doctor, benchmark). Fastify daemon (loopback, token, HMAC kimlik sübutu). Mod-dan daemon-a buferli ötürmə. Offline benchmark.
- **Phase 5 — Web Dashboard:** Overview, Routing history, Routing rules, Agents, Models, Settings. Birdəfəlik kodla giriş (`mr dashboard`), session açarı. Qaydalar və scoring ayarları mod-a daemon-dan çatır.
- **Phase 6 — Hardening və release:**
  - asılılıqsız release paketi (`npm run release`), quraşdırılmış paketin smoke testi;
  - Claude Code üçün lokal marketplace;
  - `mr uninstall [--purge --yes]`;
  - Windows-da token faylına yalnız sahibinin ACL-i, `mr doctor` bunu yoxlayır;
  - Linux-da (Docker) tam yoxlama və orada tapılan backup xətasının düzəlişi;
  - GitHub Actions matrisi (Windows/Linux/macOS, Node 22/24 + 22.13 runtime);
  - quraşdırma/yeniləmə/silmə bələdçisi, qəbul meyarları cədvəli.
