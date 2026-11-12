ALTER TABLE `plan_slots` ADD `servings` integer;--> statement-breakpoint
ALTER TABLE `settings` ADD `meal_servings` text DEFAULT '{}' NOT NULL;