CREATE TABLE `class_attendance` (
	`day_id` text NOT NULL,
	`assignment_id` text NOT NULL,
	`present` integer NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	PRIMARY KEY(`day_id`, `assignment_id`),
	FOREIGN KEY (`day_id`) REFERENCES `class_days`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`assignment_id`) REFERENCES `student_class_assignments`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `class_days` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`day_number` integer NOT NULL,
	`date` text NOT NULL,
	`time` text NOT NULL,
	`minutes` integer NOT NULL,
	`teacher_id` integer,
	`location` text,
	`recorded_at` text,
	`recorder_id` text,
	`revision` integer DEFAULT 0 NOT NULL,
	`update_token` text,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`recorder_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `class_day_number_unique` ON `class_days` (`class_id`,`day_number`);--> statement-breakpoint
CREATE INDEX `class_day_teacher_idx` ON `class_days` (`teacher_id`);--> statement-breakpoint
CREATE TABLE `classes` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`teacher_id` integer NOT NULL,
	`location` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`update_token` text,
	FOREIGN KEY (`teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `classes_code_unique` ON `classes` (`code`);--> statement-breakpoint
ALTER TABLE `student_class_assignments` ADD `class_id` text REFERENCES classes(id) ON DELETE RESTRICT;--> statement-breakpoint
CREATE UNIQUE INDEX `class_enrollment_unique` ON `student_class_assignments` (`class_id`,`student_id`);
