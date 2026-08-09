# The macro engine

Nothing is hardcoded. Every number on every screen derives from the live profile,
and the Settings page renders the formulas **with the numbers substituted in**,
so the arithmetic can be checked by eye rather than taken on faith.

```
BMR   = 10 × kg + 6.25 × cm − 5 × age − 161      (Mifflin-St Jeor, female)
TDEE  = BMR × activity factor                     (rounded to the nearest 10)
target = TDEE − daily deficit                     (the weekly average)

training day = target × 1.09                      (rounded to the nearest 25)
rest day     = (target × 7 − training × n) / (7 − n)

protein = protein/kg × kg     every day
fat     = fat/kg × kg         every day
carbs   = (day kcal − protein × 4 − fat × 9) / 4  (rounded up to the nearest 5)
```

The 9% training-day surplus is a policy choice, not a derivation, so it lives as
a named constant in `src/lib/macros.ts` rather than buried in an expression.

Rounding daily targets to the nearest 25 kcal means the realised weekly mean
drifts slightly above the target. The Settings page **shows both numbers** rather
than hiding the difference.

`src/lib/macros.test.ts` pins the whole chain against a reference profile.

---
