CREATE TABLE `edit_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`edited_at` text NOT NULL,
	`user_id` text NOT NULL,
	`username` text NOT NULL,
	`page` text NOT NULL,
	`record_id` text NOT NULL,
	`field` text NOT NULL,
	`from_value` text NOT NULL,
	`to_value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `students` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name_id` text NOT NULL,
	`name_zh` text DEFAULT '' NOT NULL,
	`nik` text DEFAULT '' NOT NULL,
	`birthdate` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`address` text DEFAULT '' NOT NULL,
	`city` text DEFAULT '' NOT NULL,
	`parent_name` text DEFAULT '' NOT NULL,
	`parent_phone` text DEFAULT '' NOT NULL,
	`registered_date` text NOT NULL,
	`last_attendance_date` text,
	`notes` text DEFAULT '' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`update_token` text
);
