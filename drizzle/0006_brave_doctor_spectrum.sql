ALTER TABLE `students` ADD `login_status` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `students` ADD `failed_login_attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `students` ADD `last_failed_login_at` text;--> statement-breakpoint
ALTER TABLE `students` ADD `login_locked_at` text;--> statement-breakpoint
ALTER TABLE `students` ADD `login_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `students` ADD `login_access_version` integer DEFAULT 0 NOT NULL;