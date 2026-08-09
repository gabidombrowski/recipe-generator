ALTER TABLE `settings` ADD `cuisines` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
-- Backfill the starter palette for a database that already exists. Without
-- this the column default ('[]') would leave an upgraded install with every
-- cuisine picker empty and the AI filler with nothing to rotate through, which
-- looks like a bug rather than a new setting. Only rows still holding the
-- column default are touched, so this cannot overwrite a real choice.
UPDATE `settings`
SET `cuisines` = '["Brazilian","Chinese","Ethiopian","Filipino","French","Georgian","Greek","Indian","Italian","Japanese","Korean","Lebanese","Malaysian","Mexican","Moroccan","Nigerian","Peruvian","Portuguese","Spanish","Thai","Turkish","Vietnamese"]'
WHERE `cuisines` = '[]';
