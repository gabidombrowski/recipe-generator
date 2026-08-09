ALTER TABLE `settings` ADD `meals` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `planned_meal` text DEFAULT 'Dinner' NOT NULL;--> statement-breakpoint
-- Backfill for an existing database. The column default ('[]') would leave an
-- upgraded install with no meals at all, and the daily targets are divided
-- across this list — an empty one is a division by zero waiting to happen, not
-- a neutral starting state.
UPDATE `settings`
SET `meals` = '["Breakfast","Lunch","Dinner"]'
WHERE `meals` = '[]';
