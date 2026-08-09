-- Relabel three seed recipes onto cuisines the palette actually offers.
--
-- `Mediterranean` and `North African` were never in `DEFAULT_CUISINES`, so the
-- Library filter listed them while the palette did not, and the three cuisines
-- they should have been (Greek, Spanish, Moroccan) looked like they had no
-- recipe at all.
--
-- This needs to be a migration rather than an edit to the seed data, because
-- seeding is idempotent *by name*: `insertRecipeIfAbsent` skips a recipe whose
-- name already exists, so changing a field on an existing seed recipe never
-- reaches an install that already ran. Editing seed-data.ts alone would have
-- fixed new clones and left every existing database wrong.
--
-- Guarded three ways so a user's own edit is never overwritten: the row must
-- still be seed-sourced, still carry the old cuisine, and match the name.
UPDATE `recipes`
SET `cuisine` = 'Spanish'
WHERE `name` = 'Lemon Garlic Shrimp with White Beans'
  AND `cuisine` = 'Mediterranean'
  AND `source` = 'seed';--> statement-breakpoint
UPDATE `recipes`
SET `cuisine` = 'Greek'
WHERE `name` = 'Greek Yogurt Protein Bowl'
  AND `cuisine` = 'Mediterranean'
  AND `source` = 'seed';--> statement-breakpoint
UPDATE `recipes`
SET `cuisine` = 'Moroccan'
WHERE `name` = 'Harissa Chickpea Skillet'
  AND `cuisine` = 'North African'
  AND `source` = 'seed';
