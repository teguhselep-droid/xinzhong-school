ALTER TABLE `students` ADD `active` integer DEFAULT true NOT NULL;
--> statement-breakpoint
CREATE TRIGGER student_enrollment_requires_active BEFORE INSERT ON student_class_assignments
WHEN NEW.class_id IS NOT NULL AND NEW.removed_at IS NULL
  AND EXISTS (SELECT 1 FROM students WHERE id = NEW.student_id AND active = 0)
BEGIN
  SELECT RAISE(ABORT, 'INACTIVE_STUDENT_ENROLLMENT');
END;
--> statement-breakpoint
CREATE TRIGGER student_reenrollment_requires_active BEFORE UPDATE OF removed_at ON student_class_assignments
WHEN NEW.class_id IS NOT NULL AND NEW.removed_at IS NULL AND OLD.removed_at IS NOT NULL
  AND EXISTS (SELECT 1 FROM students WHERE id = NEW.student_id AND active = 0)
BEGIN
  SELECT RAISE(ABORT, 'INACTIVE_STUDENT_ENROLLMENT');
END;
