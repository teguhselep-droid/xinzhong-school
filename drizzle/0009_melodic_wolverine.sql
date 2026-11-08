CREATE TABLE `teachers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name_id` text NOT NULL,
	`name_zh` text DEFAULT '' NOT NULL,
	`nik` text DEFAULT '' NOT NULL,
	`birthdate` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`address` text DEFAULT '' NOT NULL,
	`city` text DEFAULT '' NOT NULL,
	`registered_date` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`update_token` text
);
