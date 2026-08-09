# Planning: cook days, leftover days, and the week

The week's shape is derived from settings, never hardcoded:

1. Each configured **cook day** gets a cook slot — cook for two.
2. The day **after** each cook day is a leftover day — eat the second portion.
3. **Assembly days** alternate assembly and quick.
4. Anything left over is a quick day.

Cook wins over leftover when they collide, so back-to-back cook days both cook
rather than the second one trying to eat a portion that is also today's dinner.

This is the rule the app exists to enforce: **a refrigerated portion is
tomorrow's food.** Fridge items older than a day get a prominent warning; freezer
items never do.

The deterministic planner applies constraints as a **ladder** rather than
all-or-nothing — with a library of a few dozen recipes, a strict pass can
genuinely run out of candidates, and a half-empty week is worse than one that
repeats a dish sooner than ideal. Each relaxation is recorded and shown in the
run status. **Exclusions are the one rung that never bends.**

---
