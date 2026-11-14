ALTER TABLE `teachers` ADD `active` integer DEFAULT true NOT NULL;
--> statement-breakpoint
CREATE TRIGGER class_teacher_requires_active BEFORE INSERT ON classes
WHEN EXISTS (SELECT 1 FROM teachers WHERE id = NEW.teacher_id AND active = 0)
BEGIN
  SELECT RAISE(ABORT, 'INACTIVE_TEACHER_ASSIGNMENT');
END;
--> statement-breakpoint
CREATE TRIGGER class_reassigned_teacher_requires_active BEFORE UPDATE OF teacher_id ON classes
WHEN NEW.teacher_id <> OLD.teacher_id
  AND EXISTS (SELECT 1 FROM teachers WHERE id = NEW.teacher_id AND active = 0)
BEGIN
  SELECT RAISE(ABORT, 'INACTIVE_TEACHER_ASSIGNMENT');
END;
--> statement-breakpoint
CREATE TRIGGER meeting_reassigned_teacher_requires_active BEFORE UPDATE OF teacher_id ON class_days
WHEN NEW.teacher_id <> COALESCE(OLD.teacher_id, (SELECT teacher_id FROM classes WHERE id = OLD.class_id))
  AND EXISTS (SELECT 1 FROM teachers WHERE id = NEW.teacher_id AND active = 0)
BEGIN
  SELECT RAISE(ABORT, 'INACTIVE_TEACHER_ASSIGNMENT');
END;
