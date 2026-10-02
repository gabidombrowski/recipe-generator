CREATE TABLE `context_chunks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ordinal` integer NOT NULL,
	`heading` text,
	`body` text NOT NULL,
	`content_hash` text NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
