CREATE TABLE `dietary_guidelines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tag` text,
	`max_per_recipe` integer,
	`max_cook_per_week` integer,
	`note` text DEFAULT '' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `excluded_ingredients` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`name_lower` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `excluded_ingredients_name_unique` ON `excluded_ingredients` (`name_lower`);--> statement-breakpoint
CREATE TABLE `generation_feedback` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`recipe_id` integer NOT NULL,
	`verdict` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`promoted_to_fixture` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `generation_feedback_recipe_idx` ON `generation_feedback` (`recipe_id`);--> statement-breakpoint
CREATE TABLE `grocery_checks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`week_start` text NOT NULL,
	`line_key` text NOT NULL,
	`checked` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `grocery_checks_week_line_unique` ON `grocery_checks` (`week_start`,`line_key`);--> statement-breakpoint
CREATE TABLE `leftover_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`recipe_name` text NOT NULL,
	`cooked_date` text NOT NULL,
	`storage` text NOT NULL,
	`portions` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `leftover_items_cooked_date_idx` ON `leftover_items` (`cooked_date`);--> statement-breakpoint
CREATE TABLE `pantry_staples` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`on_hand` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pantry_staples_name_unique` ON `pantry_staples` (`name`);--> statement-breakpoint
CREATE TABLE `plan_slots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`meal_source` text NOT NULL,
	`recipe_id` integer,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plan_slots_date_unique` ON `plan_slots` (`date`);--> statement-breakpoint
CREATE INDEX `plan_slots_recipe_idx` ON `plan_slots` (`recipe_id`);--> statement-breakpoint
CREATE TABLE `profile` (
	`id` integer PRIMARY KEY NOT NULL,
	`weight_kg` real NOT NULL,
	`height_cm` real NOT NULL,
	`age` integer NOT NULL,
	`sex` text NOT NULL,
	`activity_factor` real NOT NULL,
	`deficit_kcal` real NOT NULL,
	`protein_per_kg` real NOT NULL,
	`fat_per_kg` real NOT NULL,
	`training_days` text NOT NULL,
	`cook_days` text NOT NULL,
	`assembly_days` text NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `recipe_embeddings` (
	`recipe_id` integer PRIMARY KEY NOT NULL,
	`content_hash` text NOT NULL,
	`dimensions` integer NOT NULL,
	`model` text NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `recipes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`cuisine` text NOT NULL,
	`cook_minutes` integer NOT NULL,
	`servings` integer NOT NULL,
	`meal_type` text NOT NULL,
	`ingredients` text NOT NULL,
	`steps` text NOT NULL,
	`search_blob` text DEFAULT '' NOT NULL,
	`macros_per_serving` text NOT NULL,
	`favorite` integer DEFAULT false NOT NULL,
	`tag_counts` text DEFAULT '{}' NOT NULL,
	`source` text NOT NULL,
	`prompt_hash` text,
	`model_string` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recipes_name_unique` ON `recipes` (`name`);--> statement-breakpoint
CREATE INDEX `recipes_meal_type_idx` ON `recipes` (`meal_type`);--> statement-breakpoint
CREATE INDEX `recipes_favorite_idx` ON `recipes` (`favorite`);--> statement-breakpoint
CREATE TABLE `scheduler_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`started_at` text DEFAULT (current_timestamp) NOT NULL,
	`finished_at` text,
	`week_start` text NOT NULL,
	`mode` text NOT NULL,
	`fell_back` integer DEFAULT false NOT NULL,
	`status` text NOT NULL,
	`slots_created` integer DEFAULT 0 NOT NULL,
	`ai_recipes_created` integer DEFAULT 0 NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`verifier_verdicts` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `scheduler_runs_week_idx` ON `scheduler_runs` (`week_start`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`shopping_day` text NOT NULL,
	`generation_day` text NOT NULL,
	`generation_time` text NOT NULL,
	`timezone` text NOT NULL,
	`ai_novel_recipes_per_week` integer NOT NULL,
	`repeat_window_weeks` integer NOT NULL,
	`planner_mode` text NOT NULL,
	`setup_complete` integer DEFAULT false NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
