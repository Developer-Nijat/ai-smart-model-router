# ADR-006: Default rejim — Shadow Mode

**Status:** Qəbul edildi (2026-11-18)

## Kontekst
Router-in seçimlərinin keyfiyyəti real istifadə məlumatı olmadan bilinmir. Modeli səhv dəyişmək istifadəçinin işinə birbaşa zərər verir.

## Qərar
`routing.mode` üç dəyər alır: `shadow` (default), `auto`, `off`.
- `shadow`: router analiz edir və tövsiyəni yazır, modeli **dəyişmir**. Qərarın statusu `recommended`.
- `auto`: tövsiyə tətbiq olunur. Opt-in.
- `off`: router heç nə etmir.
- Manual override (`/route opus`) `shadow`-da da tətbiq olunur — istifadəçinin açıq əmridir.

## Nəticələr
- Dashboard "router nə tövsiyə etdi / əslində hansı model işlədi" müqayisəsini göstərə bilər.
- `auto`-ya keçid istifadəçinin qərarıdır.
