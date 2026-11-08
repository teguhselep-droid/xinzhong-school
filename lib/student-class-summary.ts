import { sql } from 'drizzle-orm';

export const studentClassSummary = {
  // Retain the imported class label only until there is a roster history in this system.
  currentClass: sql<string>`
    case when exists (
      select 1 from student_class_assignments e where e.student_id = students.id and e.class_id is not null
    ) then coalesce((
      select group_concat(active.name, ', ') from (
        select c.name from student_class_assignments e
        join classes c on c.id = e.class_id
        where e.student_id = students.id and e.removed_at is null
          and exists (select 1 from class_days d where d.class_id = c.id and d.recorded_at is null)
        order by c.name, c.code
      ) active
    ), '') else students.current_class end
  `,
  lastAttendanceDate: sql<string | null>`
    nullif(max(coalesce(students.last_attendance_date, ''), coalesce((
      select max(d.date) from student_class_assignments e
      join class_attendance a on a.assignment_id = e.id
      join class_days d on d.id = a.day_id
      where e.student_id = students.id and a.present = 1 and d.recorded_at is not null
    ), '')), '')
  `,
};
