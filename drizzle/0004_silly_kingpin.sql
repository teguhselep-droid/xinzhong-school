CREATE TABLE `student_class_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `student_class_assignments_student_idx` ON `student_class_assignments` (`student_id`);--> statement-breakpoint
CREATE TABLE `student_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `student_transactions_student_idx` ON `student_transactions` (`student_id`);