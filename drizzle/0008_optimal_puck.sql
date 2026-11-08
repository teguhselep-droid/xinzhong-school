CREATE TABLE `student_registration_sequences` (
	`period` text PRIMARY KEY NOT NULL,
	`last_sequence` integer DEFAULT 110 NOT NULL
);
--> statement-breakpoint
ALTER TABLE `students` ADD `registration_number` text;--> statement-breakpoint
CREATE UNIQUE INDEX `students_registration_number_unique` ON `students` (`registration_number`);--> statement-breakpoint
CREATE TRIGGER students_assign_registration_insert AFTER INSERT ON students
WHEN NEW.registration_number IS NULL
BEGIN
 SELECT CASE WHEN NEW.registered_date NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' OR date(NEW.registered_date,'+0 days') IS NULL OR date(NEW.registered_date,'+0 days') <> NEW.registered_date THEN RAISE(ABORT,'INVALID_REGISTRATION_DATE') END;
 INSERT INTO student_registration_sequences(period,last_sequence) VALUES(substr(NEW.registered_date,1,7),110) ON CONFLICT(period) DO NOTHING;
 UPDATE student_registration_sequences SET last_sequence=last_sequence+1 WHERE period=substr(NEW.registered_date,1,7) AND last_sequence<999;
 SELECT CASE WHEN changes()=0 THEN RAISE(ABORT,'REGISTRATION_MONTH_FULL') END;
 UPDATE students SET registration_number=substr(NEW.registered_date,3,2)||substr(NEW.registered_date,6,2)||printf('%03d',(SELECT last_sequence FROM student_registration_sequences WHERE period=substr(NEW.registered_date,1,7))) WHERE id=NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER students_assign_registration_backfill AFTER UPDATE OF registration_number ON students
WHEN NEW.registration_number IS NULL
BEGIN
 SELECT CASE WHEN NEW.registered_date NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' OR date(NEW.registered_date,'+0 days') IS NULL OR date(NEW.registered_date,'+0 days') <> NEW.registered_date THEN RAISE(ABORT,'INVALID_REGISTRATION_DATE') END;
 INSERT INTO student_registration_sequences(period,last_sequence) VALUES(substr(NEW.registered_date,1,7),110) ON CONFLICT(period) DO NOTHING;
 UPDATE student_registration_sequences SET last_sequence=last_sequence+1 WHERE period=substr(NEW.registered_date,1,7) AND last_sequence<999;
 SELECT CASE WHEN changes()=0 THEN RAISE(ABORT,'REGISTRATION_MONTH_FULL') END;
 UPDATE students SET registration_number=substr(NEW.registered_date,3,2)||substr(NEW.registered_date,6,2)||printf('%03d',(SELECT last_sequence FROM student_registration_sequences WHERE period=substr(NEW.registered_date,1,7))) WHERE id=NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER students_keep_registration_number BEFORE UPDATE OF registration_number ON students
WHEN OLD.registration_number IS NOT NULL AND NEW.registration_number IS NOT OLD.registration_number
BEGIN
 SELECT RAISE(ABORT,'REGISTRATION_NUMBER_IMMUTABLE');
END;
