CREATE TABLE `class_leaves` (
	`id` text PRIMARY KEY NOT NULL,
	`assignment_id` text NOT NULL,
	`starts_on` text NOT NULL,
	`ends_on` text NOT NULL,
	`reason` text NOT NULL,
	`recorded_at` text NOT NULL,
	`recorded_by` text NOT NULL,
	FOREIGN KEY (`assignment_id`) REFERENCES `student_class_assignments`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "class_leave_dates" CHECK("class_leaves"."starts_on" <= "class_leaves"."ends_on")
);
--> statement-breakpoint
CREATE INDEX `class_leaves_assignment_idx` ON `class_leaves` (`assignment_id`,`starts_on`,`ends_on`);--> statement-breakpoint
CREATE TABLE `tuition_waivers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token` text NOT NULL,
	`student_id` integer NOT NULL,
	`class_id` text NOT NULL,
	`month` text NOT NULL,
	`amount` integer NOT NULL,
	`reason` text NOT NULL,
	`recorded_at` text NOT NULL,
	`recorded_by` text NOT NULL,
	FOREIGN KEY (`student_id`,`class_id`,`month`) REFERENCES `tuition_bills`(`student_id`,`class_id`,`month`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "tuition_waiver_positive_amount" CHECK("tuition_waivers"."amount" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tuition_waivers_token_unique` ON `tuition_waivers` (`token`);--> statement-breakpoint
CREATE INDEX `tuition_waiver_bill_idx` ON `tuition_waivers` (`month`,`student_id`,`class_id`);--> statement-breakpoint
ALTER TABLE `class_attendance` ADD `on_leave` integer DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE VIEW class_leave_days AS
SELECT e.id AS assignment_id, e.student_id, d.id AS day_id, d.class_id, d.date
FROM class_leaves l JOIN student_class_assignments e ON e.id = l.assignment_id
JOIN class_days d ON d.class_id = e.class_id AND d.date BETWEEN l.starts_on AND l.ends_on;
--> statement-breakpoint
CREATE VIEW tuition_leave_months AS
SELECT DISTINCT l.student_id, l.class_id, substr(l.date, 1, 7) AS month
FROM class_leave_days l
WHERE NOT EXISTS (
  SELECT 1 FROM class_days d
  WHERE d.class_id = l.class_id AND substr(d.date, 1, 7) = substr(l.date, 1, 7)
    AND NOT EXISTS (SELECT 1 FROM class_leave_days x WHERE x.assignment_id = l.assignment_id AND x.day_id = d.id)
);
--> statement-breakpoint
CREATE TRIGGER class_leave_validate BEFORE INSERT ON class_leaves
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM student_class_assignments e JOIN students s ON s.id = e.student_id
    WHERE e.id = NEW.assignment_id AND e.class_id IS NOT NULL AND e.removed_at IS NULL AND s.active = 1
  ) THEN RAISE(ABORT, 'LEAVE_ENROLLMENT_REQUIRED') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM class_leaves WHERE assignment_id = NEW.assignment_id
      AND starts_on <= NEW.ends_on AND ends_on >= NEW.starts_on
  ) THEN RAISE(ABORT, 'LEAVE_OVERLAP') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM class_attendance a JOIN class_days d ON d.id = a.day_id
    WHERE a.assignment_id = NEW.assignment_id AND d.recorded_at IS NOT NULL
      AND d.date BETWEEN NEW.starts_on AND NEW.ends_on
  ) THEN RAISE(ABORT, 'LEAVE_ATTENDANCE_LOCKED') END;
END;
--> statement-breakpoint
CREATE TRIGGER class_leave_revise AFTER INSERT ON class_leaves
BEGIN
  UPDATE classes SET revision = revision + 1
  WHERE id = (SELECT class_id FROM student_class_assignments WHERE id = NEW.assignment_id);
END;
--> statement-breakpoint
CREATE TRIGGER tuition_bill_skip_leave BEFORE INSERT ON tuition_bills
WHEN EXISTS (
  SELECT 1 FROM tuition_leave_months WHERE student_id = NEW.student_id AND class_id = NEW.class_id AND month = NEW.month
) AND NOT EXISTS (
  SELECT 1 FROM tuition_bills WHERE student_id = NEW.student_id AND class_id = NEW.class_id AND month = NEW.month
)
BEGIN
  SELECT RAISE(ABORT, 'TUITION_MONTH_ON_LEAVE');
END;
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
    SELECT sum(amount) FROM tuition_waivers WHERE student_id = NEW.student_id AND class_id = NEW.class_id AND month = NEW.month
  ), 0) THEN RAISE(ABORT, 'PAYMENT_EXCEEDS_DUE') END;
END;
--> statement-breakpoint
CREATE TRIGGER tuition_payment_leave_and_waiver BEFORE INSERT ON school_payments
WHEN NEW.kind = 'tuition' AND NOT EXISTS (SELECT 1 FROM school_payments WHERE token = NEW.token)
BEGIN
  SELECT CASE WHEN NEW.total + coalesce((
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
