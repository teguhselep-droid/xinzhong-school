CREATE TABLE `tuition_bills` (
	`student_id` integer NOT NULL,
	`class_id` text NOT NULL,
	`month` text NOT NULL,
	`fee` integer NOT NULL,
	PRIMARY KEY(`student_id`, `class_id`, `month`),
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "tuition_bill_positive_fee" CHECK("tuition_bills"."fee" > 0)
);
--> statement-breakpoint
CREATE INDEX `tuition_bill_month_idx` ON `tuition_bills` (`month`);--> statement-breakpoint
ALTER TABLE `school_payments` ADD `tuition_month` text;--> statement-breakpoint
ALTER TABLE `school_payments` ADD `monthly_fee` integer;--> statement-breakpoint
CREATE INDEX `school_payment_tuition_month_idx` ON `school_payments` (`tuition_month`,`student_id`,`class_id`);
--> statement-breakpoint
CREATE TRIGGER school_payment_post AFTER INSERT ON school_payments
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM accounting_accounts WHERE id = NEW.bank_id AND kind = 'bank'
  ) THEN RAISE(ABORT, 'PAYMENT_BANK_INVALID') END;

  INSERT INTO student_transactions (id, student_id, created_at)
  SELECT NEW.student_transaction_id, NEW.student_id, NEW.recorded_at WHERE NEW.student_id IS NOT NULL;

  SELECT CASE WHEN NEW.kind = 'tuition' AND NOT EXISTS (
    SELECT 1 FROM student_class_assignments WHERE student_id = NEW.student_id AND class_id = NEW.class_id
  ) THEN RAISE(ABORT, 'PAYMENT_ENROLLMENT_MISSING') END;
  INSERT INTO tuition_bills (student_id, class_id, month, fee)
  SELECT NEW.student_id, NEW.class_id, NEW.tuition_month, NEW.monthly_fee WHERE NEW.kind = 'tuition'
  ON CONFLICT (student_id, class_id, month) DO NOTHING;
  SELECT CASE WHEN NEW.kind = 'tuition' AND EXISTS (
    SELECT 1 FROM tuition_bills
    WHERE student_id = NEW.student_id AND class_id = NEW.class_id AND month = NEW.tuition_month
      AND fee <> NEW.monthly_fee
  ) THEN RAISE(ABORT, 'PAYMENT_FEE_CHANGED') END;
  SELECT CASE WHEN NEW.kind = 'tuition' AND (
    SELECT sum(total) FROM school_payments
    WHERE student_id = NEW.student_id AND class_id = NEW.class_id AND tuition_month = NEW.tuition_month
      AND voided_at IS NULL
  ) > NEW.monthly_fee THEN RAISE(ABORT, 'PAYMENT_EXCEEDS_DUE') END;
  SELECT CASE WHEN NEW.kind = 'tuition' AND EXISTS (
    SELECT 1 FROM json_each(NEW.detail) j
    LEFT JOIN class_days d ON d.id = json_extract(j.value, '$.id') AND d.class_id = NEW.class_id
    WHERE d.id IS NULL OR d.date <> json_extract(j.value, '$.date') OR substr(d.date, 1, 7) <> NEW.tuition_month
      OR NEW.class_code || printf('%02d', d.day_number) <> json_extract(j.value, '$.code')
  ) THEN RAISE(ABORT, 'PAYMENT_DAYS_CHANGED') END;
  SELECT CASE WHEN NEW.kind = 'tuition' AND EXISTS (
    SELECT 1 FROM json_each(NEW.detail) j JOIN tuition_coverage t
      ON t.day_id = json_extract(j.value, '$.id')
    WHERE t.student_id = NEW.student_id AND t.released = 0
  ) THEN RAISE(ABORT, 'PAYMENT_DAY_ALREADY_PAID') END;
  INSERT INTO tuition_coverage (payment_id, student_id, day_id)
  SELECT NEW.id, NEW.student_id, json_extract(j.value, '$.id') FROM json_each(NEW.detail) j
  WHERE NEW.kind = 'tuition';

  SELECT CASE WHEN NEW.kind = 'purchase' AND EXISTS (
    SELECT 1 FROM json_each(NEW.detail) j
    LEFT JOIN inventory_products p ON p.id = json_extract(j.value, '$.productId')
    WHERE p.id IS NULL OR p.quantity < json_extract(j.value, '$.quantity')
      OR p.sales_price <> json_extract(j.value, '$.price')
  ) THEN RAISE(ABORT, 'PAYMENT_STOCK_CHANGED') END;
  UPDATE inventory_products
  SET quantity = quantity - json_extract(j.value, '$.quantity')
  FROM json_each(NEW.detail) j
  WHERE NEW.kind = 'purchase' AND inventory_products.id = json_extract(j.value, '$.productId');

  INSERT INTO accounting_entries (
    token, transaction_date, recorded_at, recorded_by, notes, amount, debit_account_id, credit_account_id
  ) VALUES (
    'school-payment:' || NEW.token, NEW.payment_date, NEW.recorded_at, NEW.recorded_by, NEW.memo, NEW.total,
    CASE WHEN NEW.kind = 'expense' THEN NEW.category_id ELSE NEW.bank_id END,
    CASE WHEN NEW.kind = 'expense' THEN NEW.bank_id ELSE NEW.category_id END
  );
END;
--> statement-breakpoint
CREATE TRIGGER school_payment_reverse AFTER UPDATE OF voided_at ON school_payments
WHEN OLD.voided_at IS NULL AND NEW.voided_at IS NOT NULL
BEGIN
  UPDATE tuition_coverage SET released = 1 WHERE payment_id = NEW.id;
  SELECT CASE WHEN NEW.kind = 'purchase' AND EXISTS (
    SELECT 1 FROM json_each(NEW.detail) j JOIN inventory_products p ON p.id = json_extract(j.value, '$.productId')
    WHERE p.quantity > 999999999 - json_extract(j.value, '$.quantity')
  ) THEN RAISE(ABORT, 'PAYMENT_STOCK_LIMIT') END;
  UPDATE inventory_products
  SET quantity = quantity + json_extract(j.value, '$.quantity')
  FROM json_each(NEW.detail) j
  WHERE NEW.kind = 'purchase' AND inventory_products.id = json_extract(j.value, '$.productId');

  INSERT INTO accounting_entries (
    token, transaction_date, recorded_at, recorded_by, notes, amount, debit_account_id, credit_account_id
  )
  SELECT 'school-reversal:' || NEW.token, transaction_date, NEW.voided_at, NEW.voided_by,
    'Pembalikan / 冲销 · ' || notes, amount, credit_account_id, debit_account_id
  FROM accounting_entries WHERE token = 'school-payment:' || NEW.token;
END;
--> statement-breakpoint
CREATE TRIGGER class_day_protect_tuition BEFORE DELETE ON class_days
WHEN EXISTS (SELECT 1 FROM tuition_coverage WHERE day_id = OLD.id AND released = 0)
BEGIN
  SELECT RAISE(ABORT, 'PAYMENT_DAY_ALREADY_PAID');
END;
