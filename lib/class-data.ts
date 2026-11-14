import { and, asc, count, desc, eq, isNull, like, or, sql, type SQL } from 'drizzle-orm';
import { getDb } from '@/db';
import { classAttendance, classDays, classes, studentClassAssignments, students, teachers } from '@/db/schema';
import { canManageClasses, canTakeAttendance, classPageSize, meetingStart, type ClassHistoryPage, type ClassLeave } from '@/lib/class-fields';
import { currentClassEnrollment } from '@/lib/student-class-summary';

export const dayCode = sql<string>`${classes.code} || printf('%02d', ${classDays.dayNumber})`;
export const actualTeacher = sql<number>`coalesce(${classDays.teacherId}, ${classes.teacherId})`;
export const teacherName = sql<string>`trim(${teachers.nameId} || ' ' || ${teachers.nameZh})`;
export const teacherClassCount = sql<number>`(
  select count(distinct c.id) from classes c join class_days d on d.class_id = c.id
  where coalesce(d.teacher_id, c.teacher_id) = teachers.id
)`;
export const teacherMeetingCount = sql<number>`(
  select count(*) from class_days d where d.teacher_id = teachers.id and d.recorded_at is not null
)`;
const studentName = sql<string>`trim(${students.nameId} || ' ' || ${students.nameZh})`;
const totalPresent = sql<number>`(select count(*) from class_attendance a where a.day_id = ${classDays.id} and a.present = 1)`;
const classColumns = {
  id: classes.id, code: classes.code, name: classes.name, location: classes.location,
  teacherId: classes.teacherId, teacher: teacherName, revision: classes.revision,
  createdAt: classes.createdAt, recordedBy: classes.recordedBy,
  start: sql<string | null>`(select min(d.date) from class_days d where d.class_id = ${classes.id})`,
  finish: sql<string | null>`(select max(d.date) from class_days d where d.class_id = ${classes.id})`,
  dayCount: sql<number>`(select count(*) from class_days d where d.class_id = ${classes.id})`,
  studentCount: sql<number>`(select count(*) from student_class_assignments e join students s on s.id = e.student_id
    where e.class_id = ${classes.id} and e.removed_at is null and s.active = 1)`,
  latestAttendance: sql<number | null>`(
    select (select count(*) from class_attendance a where a.day_id = d.id and a.present = 1)
    from class_days d where d.class_id = ${classes.id} and d.recorded_at is not null
    order by d.date desc, d.time desc, d.day_number desc limit 1
  )`,
};

export function classQuery(db: ReturnType<typeof getDb>) {
  return db.select(classColumns).from(classes).innerJoin(teachers, eq(teachers.id, classes.teacherId));
}

export async function classList(db: ReturnType<typeof getDb>, query: URLSearchParams) {
  const search = (query.get('search') ?? '').trim().slice(0, 150);
  const where = search ? or(...[classes.name, classes.code, classes.location, teacherName].map(col => like(col, `%${search}%`))) : undefined;
  const [{ total }] = await db.select({ total: count() }).from(classes)
    .innerJoin(teachers, eq(teachers.id, classes.teacherId)).where(where);
  const page = pageNumber(query, total);
  const rows = await classQuery(db).where(where).orderBy(desc(classes.code))
    .limit(classPageSize).offset((page - 1) * classPageSize);
  return { rows, total, page };
}

export function classRoster(db: ReturnType<typeof getDb>, classId: string) {
  return db.select({
    assignmentId: studentClassAssignments.id, id: students.id, nameId: students.nameId,
    nameZh: students.nameZh, registrationNumber: students.registrationNumber,
  }).from(studentClassAssignments).innerJoin(students, eq(students.id, studentClassAssignments.studentId))
    .where(and(eq(studentClassAssignments.classId, classId), isNull(studentClassAssignments.removedAt), eq(students.active, true)))
    .orderBy(asc(students.nameId), asc(students.id));
}

export async function classDetails(db: ReturnType<typeof getDb>, id: string, staff: { role: string }) {
  const [group] = await classQuery(db).where(eq(classes.id, id));
  if (!group) return null;
  const days = await db.select({
    id: classDays.id, code: dayCode, date: classDays.date, time: classDays.time, minutes: classDays.minutes,
    teacherId: actualTeacher, teacher: teacherName,
    location: sql<string>`coalesce(${classDays.location}, ${classes.location})`,
    attendance: sql<number | null>`case when ${classDays.recordedAt} is not null then ${totalPresent} end`,
    recordedAt: classDays.recordedAt, revision: classDays.revision,
  }).from(classDays).innerJoin(classes, eq(classes.id, classDays.classId))
    .innerJoin(teachers, eq(teachers.id, actualTeacher)).where(eq(classes.id, id)).orderBy(asc(classDays.dayNumber));
  const now = Date.now();
  return {
    group,
    days: days.map(day => ({
      ...day,
      canRecord: !day.recordedAt && canTakeAttendance(staff.role),
      canRemove: !day.recordedAt && canManageClasses(staff.role) && meetingStart(day.date, day.time) > now,
    })),
    roster: await classRoster(db, id),
    leaves: canManageClasses(staff.role) ? await db.all<ClassLeave>(sql`
      select l.id, l.assignment_id as assignmentId, l.starts_on as startsOn, l.ends_on as endsOn,
        trim(s.name_id || ' ' || s.name_zh) as student, s.registration_number as registrationNumber,
        l.reason, l.recorded_by as recordedBy, l.recorded_at as recordedAt
      from class_leaves l join student_class_assignments e on e.id = l.assignment_id
      join students s on s.id = e.student_id where e.class_id = ${id}
      order by l.starts_on desc, l.id
    `) : [],
  };
}

export async function meetingRoster(db: ReturnType<typeof getDb>, classId: string) {
  const [roster, leaves] = await Promise.all([
    classRoster(db, classId),
    db.all<{ assignmentId: string; startsOn: string; endsOn: string }>(sql`
      select l.assignment_id as assignmentId, l.starts_on as startsOn, l.ends_on as endsOn
      from class_leaves l join student_class_assignments e on e.id = l.assignment_id where e.class_id = ${classId}
    `),
  ]);
  return roster.map(student => ({
    ...student, present: null, notes: '', leaves: leaves.filter(leave => leave.assignmentId === student.assignmentId),
  }));
}

export async function attendanceList(db: ReturnType<typeof getDb>, query: URLSearchParams) {
  const search = (query.get('search') ?? '').trim().slice(0, 150);
  const classId = query.get('class');
  const dayId = query.get('day');
  const where = and(
    classId ? eq(classes.id, classId) : undefined,
    dayId ? eq(classDays.id, dayId) : undefined,
    search ? or(...[dayCode, classes.name, teacherName, studentName].map(col => like(col, `%${search}%`))) : undefined,
  );
  const records = db.select({
    code: dayCode, className: classes.name, date: classDays.date, time: classDays.time, minutes: classDays.minutes,
    teacher: teacherName, student: studentName, present: classAttendance.present, onLeave: classAttendance.onLeave,
    notes: classAttendance.notes,
    classId: classes.id, dayId: classDays.id, assignmentId: classAttendance.assignmentId,
  }).from(classAttendance).innerJoin(classDays, eq(classDays.id, classAttendance.dayId))
    .innerJoin(classes, eq(classes.id, classDays.classId))
    .innerJoin(teachers, eq(teachers.id, classDays.teacherId))
    .innerJoin(studentClassAssignments, eq(studentClassAssignments.id, classAttendance.assignmentId))
    .innerJoin(students, eq(students.id, studentClassAssignments.studentId)).where(where).$dynamic();
  // Both the records and the count use the same joins and filters.
  const [{ total }] = await db.all<{ total: number }>(sql`select count(*) as total from (${records})`);
  const page = pageNumber(query, total);
  const rows = await records
    .orderBy(desc(classDays.date), desc(classDays.time), desc(dayCode), asc(students.nameId), asc(students.id))
    .limit(classPageSize).offset((page - 1) * classPageSize);
  return { rows, page, total };
}

export function teacherClassHistory(db: ReturnType<typeof getDb>, query: URLSearchParams) {
  const teacherId = Number(query.get('teacher'));
  const pending = query.get('period') === 'previous' ? 0 : 1;
  const classesForTeacher = sql`
    select c.id, c.code, c.name
    from classes c join class_days d on d.class_id = c.id
    where coalesce(d.teacher_id, c.teacher_id) = ${teacherId}
    group by c.id
    having max(d.recorded_at is null) = ${pending}
  `;
  return classHistoryPage(db, classesForTeacher, query);
}

export function studentClassHistory(db: ReturnType<typeof getDb>, studentId: number, query: URLSearchParams) {
  const active = query.get('period') !== 'previous';
  return classHistoryPage(db, sql`
    select c.id, c.code, c.name
    from student_class_assignments e join classes c on c.id = e.class_id
    where e.student_id = ${studentId}
      and ${active ? currentClassEnrollment : sql`not (${currentClassEnrollment})`}
  `, query);
}

async function classHistoryPage(db: ReturnType<typeof getDb>, history: SQL, query: URLSearchParams): Promise<ClassHistoryPage> {
  const [{ total }] = await db.all<{ total: number }>(sql`select count(*) as total from (${history})`);
  const page = pageNumber(query, total);
  const rows = await db.all<ClassHistoryPage['rows'][number]>(sql`
    ${history} order by c.code desc limit ${classPageSize} offset ${(page - 1) * classPageSize}
  `);
  return { rows, page, total };
}

function pageNumber(query: URLSearchParams, total: number) {
  const requested = Math.max(1, Math.trunc(Number(query.get('page'))) || 1);
  return Math.min(requested, Math.max(1, Math.ceil(total / classPageSize)));
}
