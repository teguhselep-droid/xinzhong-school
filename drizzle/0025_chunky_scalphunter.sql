ALTER TABLE `classes` ADD `monthly_fee` integer;
--> statement-breakpoint
DROP TRIGGER school_payment_post;
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
  SELECT NEW.student_id, NEW.class_id, NEW.tuition_month, NEW.monthly_fee WHERE NEW.kind = 'tuition' AND NEW.tuition_month IS NOT NULL
  ON CONFLICT (student_id, class_id, month) DO NOTHING;
  SELECT CASE WHEN NEW.kind = 'tuition' AND NEW.tuition_month IS NOT NULL AND EXISTS (
    SELECT 1 FROM tuition_bills
    WHERE student_id = NEW.student_id AND class_id = NEW.class_id AND month = NEW.tuition_month
      AND fee <> NEW.monthly_fee
  ) THEN RAISE(ABORT, 'PAYMENT_FEE_CHANGED') END;
  SELECT CASE WHEN NEW.kind = 'tuition' AND NEW.tuition_month IS NOT NULL AND (
    SELECT sum(total) FROM school_payments
    WHERE student_id = NEW.student_id AND class_id = NEW.class_id AND tuition_month = NEW.tuition_month
      AND voided_at IS NULL
  ) > NEW.monthly_fee THEN RAISE(ABORT, 'PAYMENT_EXCEEDS_DUE') END;
  SELECT CASE WHEN NEW.kind = 'tuition' AND EXISTS (
    SELECT 1 FROM json_each(NEW.detail) j
    LEFT JOIN class_days d ON d.id = json_extract(j.value, '$.id') AND d.class_id = NEW.class_id
    WHERE d.id IS NULL OR d.date <> json_extract(j.value, '$.date') OR (NEW.tuition_month IS NOT NULL AND substr(d.date, 1, 7) <> NEW.tuition_month)
      OR NEW.class_code || printf('%02d', d.day_number) <> json_extract(j.value, '$.code')
  ) THEN RAISE(ABORT, 'PAYMENT_DAYS_CHANGED') END;
  SELECT CASE WHEN NEW.kind = 'tuition' AND EXISTS (
    SELECT 1 FROM json_each(NEW.detail) j JOIN tuition_coverage t
      ON t.day_id = json_extract(j.value, '$.id')
    WHERE t.student_id = NEW.student_id AND t.released = 0
  ) THEN RAISE(ABORT, 'PAYMENT_DAY_ALREADY_PAID') END;
  SELECT CASE WHEN NEW.kind = 'tuition' AND NEW.tuition_month IS NULL AND json_array_length(NEW.detail) = 0
    THEN RAISE(ABORT, 'PAYMENT_DAYS_REQUIRED') END;
  SELECT CASE WHEN NEW.kind = 'tuition' AND EXISTS (
    SELECT 1 FROM json_each(NEW.detail) j JOIN class_leave_days l ON l.day_id = json_extract(j.value, '$.id')
    WHERE l.student_id = NEW.student_id
  ) THEN RAISE(ABORT, 'TUITION_DAY_ON_LEAVE') END;
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
DROP TRIGGER tuition_payment_leave_and_waiver;
--> statement-breakpoint
CREATE TRIGGER tuition_payment_leave_and_waiver BEFORE INSERT ON school_payments
WHEN NEW.kind = 'tuition' AND NOT EXISTS (SELECT 1 FROM school_payments WHERE token = NEW.token)
BEGIN
  SELECT CASE WHEN NEW.tuition_month IS NOT NULL AND NEW.total + coalesce((
    SELECT sum(total) FROM school_payments WHERE student_id = NEW.student_id AND class_id = NEW.class_id
      AND tuition_month = NEW.tuition_month AND voided_at IS NULL
  ), 0) + coalesce((
    SELECT sum(amount) FROM tuition_waivers WHERE student_id = NEW.student_id AND class_id = NEW.class_id AND month = NEW.tuition_month
  ), 0) > NEW.monthly_fee THEN RAISE(ABORT, 'PAYMENT_EXCEEDS_DUE') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(NEW.detail) j JOIN class_leave_days l ON l.day_id = json_extract(j.value, '$.id')
    WHERE l.student_id = NEW.student_id
  ) THEN RAISE(ABORT, 'TUITION_DAY_ON_LEAVE') END;
END;

--> statement-breakpoint
DROP TRIGGER tuition_waiver_limit;
--> statement-breakpoint
CREATE TRIGGER tuition_waiver_limit BEFORE INSERT ON tuition_waivers
WHEN NOT EXISTS (SELECT 1 FROM tuition_waivers WHERE token = NEW.token)
BEGIN
  SELECT CASE WHEN NEW.amount > coalesce((
    SELECT fee FROM tuition_bills WHERE student_id = NEW.student_id AND class_id = NEW.class_id AND month = NEW.month
  ), 0) - coalesce((
    SELECT sum(total) FROM school_payments WHERE student_id = NEW.student_id AND class_id = NEW.class_id
      AND tuition_month = NEW.month AND voided_at IS NULL
  ), 0) - coalesce((
    SELECT sum(p.total * 1.0 / json_array_length(p.detail))
    FROM school_payments p, json_each(p.detail) j
    WHERE p.student_id = NEW.student_id AND p.class_id = NEW.class_id AND p.kind = 'tuition'
      AND p.tuition_month IS NULL AND p.voided_at IS NULL
      AND substr(json_extract(j.value, '$.date'), 1, 7) = NEW.month
  ), 0) - coalesce((
    SELECT sum(amount) FROM tuition_waivers WHERE student_id = NEW.student_id AND class_id = NEW.class_id AND month = NEW.month
  ), 0) THEN RAISE(ABORT, 'PAYMENT_EXCEEDS_DUE') END;
END;
