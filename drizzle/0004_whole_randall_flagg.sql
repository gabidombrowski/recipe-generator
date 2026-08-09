DROP INDEX `plan_slots_date_unique`;--> statement-breakpoint
ALTER TABLE `plan_slots` ADD `meal` text DEFAULT 'Dinner' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `plan_slots_date_meal_unique` ON `plan_slots` (`date`,`meal`);--> statement-breakpoint
ALTER TABLE `settings` ADD `planned_meals` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `main_meal` text DEFAULT 'Dinner' NOT NULL;--> statement-breakpoint
-- Backfill. The column defaults above say 'Dinner', which is right for a fresh
-- install and wrong for an existing one: every slot already in the table belongs
-- to whichever meal the owner had configured, and silently relabelling their
-- plan as "Dinner" would be a lie about their own data.
--
-- Safe with respect to the new unique index: every existing row takes the same
-- meal value, and (date) was already unique, so (date, meal) stays unique.
UPDATE `plan_slots`
SET `meal` = COALESCE((SELECT `planned_meal` FROM `settings` WHERE `id` = 1), 'Dinner');--> statement-breakpoint
-- `json_array` rather than string concatenation, so a meal name containing a
-- quote produces valid JSON instead of a broken column.
UPDATE `settings`
SET `planned_meals` = json_array(`planned_meal`),
    `main_meal` = `planned_meal`
WHERE `planned_meals` = '[]';
