CREATE TABLE `inventory_categories` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`update_token` text
);
--> statement-breakpoint
CREATE TABLE `inventory_products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`category_id` integer NOT NULL,
	`sales_price` integer NOT NULL,
	`quantity` integer NOT NULL,
	`creation_token` text NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `inventory_categories`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_products_creation_token_unique` ON `inventory_products` (`creation_token`);--> statement-breakpoint
CREATE INDEX `inventory_product_category_idx` ON `inventory_products` (`category_id`);