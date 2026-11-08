CREATE TABLE `accounting_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	CONSTRAINT "accounting_account_kind" CHECK("accounting_accounts"."kind" in ('bank', 'income', 'expense'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounting_account_name_unique` ON `accounting_accounts` (lower("name"));--> statement-breakpoint
CREATE TABLE `accounting_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token` text NOT NULL,
	`transaction_date` text NOT NULL,
	`recorded_at` text NOT NULL,
	`recorded_by` text NOT NULL,
	`notes` text NOT NULL,
	`amount` integer NOT NULL,
	`debit_account_id` text NOT NULL,
	`credit_account_id` text NOT NULL,
	FOREIGN KEY (`debit_account_id`) REFERENCES `accounting_accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`credit_account_id`) REFERENCES `accounting_accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "accounting_entry_positive_amount" CHECK("accounting_entries"."amount" > 0),
	CONSTRAINT "accounting_entry_distinct_accounts" CHECK("accounting_entries"."debit_account_id" <> "accounting_entries"."credit_account_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounting_entries_token_unique` ON `accounting_entries` (`token`);--> statement-breakpoint
CREATE INDEX `accounting_entries_debit_date_idx` ON `accounting_entries` (`debit_account_id`,`transaction_date`,`id`);--> statement-breakpoint
CREATE INDEX `accounting_entries_credit_date_idx` ON `accounting_entries` (`credit_account_id`,`transaction_date`,`id`);
--> statement-breakpoint
INSERT INTO `accounting_accounts` (`id`, `name`, `kind`) VALUES
  ('tuition-income', 'Tuition Income', 'income'),
  ('other-income', 'Other Income', 'income'),
  ('payroll-expenses', 'Payroll Expenses', 'expense'),
  ('purchase-expenses', 'Purchase Expenses', 'expense'),
  ('office-expenses', 'Office Expenses', 'expense'),
  ('other-expenses', 'Other Expenses', 'expense')
ON CONFLICT (`id`) DO NOTHING;
