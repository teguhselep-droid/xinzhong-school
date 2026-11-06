ALTER TABLE `students` ADD `registration_token` text;--> statement-breakpoint
CREATE UNIQUE INDEX `students_registration_token_unique` ON `students` (`registration_token`);