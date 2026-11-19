# ADR-008: Qiymətlər yalnız mənbə və tarixlə

**Status:** Qəbul edildi (2026-11-18)

## Kontekst
Uydurma və ya köhnəlmiş qiymətlər xərc analitikasını yanlış edir. Subscription istifadəçisinin real xərci API qiymətinə bərabər deyil.

## Qərar
- `PricingSchema`: hər qiymət qeydində `sourceUrl` (https) və `asOf` (tarix) məcburidir; qiymətlər `null` ola bilər.
- `model_pricing` cədvəli versiyalıdır: hər model üçün tarixə görə bir sətir.
- Context window və digər rəqəmlər rəsmi mənbədən alınana qədər `null` qalır.
- Dashboard iki dəyəri ayırır: "Estimated API equivalent cost" və (yalnız real billing məlumatı olanda) "Actual provider cost".

## Nəticələr
- Köhnəlmiş qiymət xəbərdarlıqla göstərilir; mənbəsiz qiymət schema-dan keçmir.
