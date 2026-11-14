CREATE TABLE `school_payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token` text NOT NULL,
	`request_hash` text NOT NULL,
	`kind` text NOT NULL,
	`payment_date` text NOT NULL,
	`bank_id` text NOT NULL,
	`category_id` text NOT NULL,
	`student_id` integer,
	`student_transaction_id` text,
	`class_id` text,
	`student_number` text,
	`student_name` text,
	`class_code` text,
	`class_name` text,
	`total` integer NOT NULL,
	`memo` text NOT NULL,
	`detail` text DEFAULT '[]' NOT NULL,
	`photo_mime` text,
	`photo_data` text,
	`recorded_at` text NOT NULL,
	`recorded_by` text NOT NULL,
	`voided_at` text,
	`voided_by` text,
	FOREIGN KEY (`bank_id`) REFERENCES `accounting_accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`category_id`) REFERENCES `accounting_accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`student_transaction_id`) REFERENCES `student_transactions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "school_payment_positive_total" CHECK("school_payments"."total" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `school_payments_token_unique` ON `school_payments` (`token`);--> statement-breakpoint
CREATE INDEX `school_payment_kind_idx` ON `school_payments` (`kind`,`id`);--> statement-breakpoint
CREATE TABLE `tuition_coverage` (
	`payment_id` integer NOT NULL,
	`student_id` integer NOT NULL,
	`day_id` text NOT NULL,
	`released` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`payment_id`, `day_id`),
	FOREIGN KEY (`payment_id`) REFERENCES `school_payments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tuition_coverage_current_unique` ON `tuition_coverage` (`student_id`,`day_id`) WHERE "tuition_coverage"."released" = 0;--> statement-breakpoint
CREATE INDEX `tuition_coverage_day_idx` ON `tuition_coverage` (`day_id`);
