import { and, eq, sql, type SQL } from 'drizzle-orm';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { z } from 'zod';
import { getDb } from '@/db';
import { classDays, classes, teachers } from '@/db/schema';
import { classRoster, meetingRoster } from '@/lib/class-data';
import { canManageClasses, canTakeAttendance, classPages, meetingStart } from '@/lib/class-fields';
import { todayJakarta } from '@/lib/student-fields';

type DB = ReturnType<typeof getDb>;
type Staff = { id: string; role: string; username: string };
type Change = { field: string; from: string; to: string; reference?: string };

export class ClassRequestError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
const invalid = 'Data tidak valid / 数据无效';
const forbidden = 'Akses ditolak / 无访问权限';
const missing = 'Kelas atau pertemuan tidak ditemukan / 未找到班级或课次';
const stale = 'Data telah berubah. Muat ulang sebelum menyimpan. / 资料已更改，请刷新后保存。';
const recorded = 'Pertemuan yang sudah dicatat terkunci / 已记录的课次已锁定';
const futureOnly = 'Pilih pertemuan yang belum dimulai / 请选择尚未开始的课次';

const classId = z.string().uuid();
const date = z.string().regex(/^20\d{2}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const teacherId = z.number().int().positive();
const location = z.string().trim().min(1).max(200);
const minutes = z.number().int().min(1).max(1440);
const classProfile = {
  id: classId, name: z.string().trim().min(1).max(200), teacherId, location,
  studentIds: z.array(z.number().int().positive()).max(300),
};
const meetingProfile = {
  id: z.string().min(1).max(40), classId, revision: z.number().int().nonnegative(),
  date, time: clock, minutes, teacherId, location,
};
const input = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'), ...classProfile, dates: z.array(date).min(1).max(99),
    time: clock, minutes,
  }),
  z.object({
    action: z.literal('edit'), ...classProfile, revision: z.number().int().nonnegative(),
    removeStudentIds: z.array(z.number().int().positive()).max(300).default([]),
  }),
  z.object({ action: z.literal('schedule'), ...meetingProfile }),
  z.object({ action: z.literal('add-day'), classId, id: z.string().uuid(), date, time: clock, minutes }),
  z.object({ action: z.literal('remove-day'), classId, id: meetingProfile.id, revision: meetingProfile.revision }),
  z.object({ action: z.literal('add-leave'), classId, id: z.string().uuid(),
    assignmentId: z.string().min(1).max(80), startsOn: date, endsOn: date, reason: z.string().trim().min(1).max(300) }),
  z.object({
    action: z.literal('record'), ...meetingProfile,
    entries: z.array(z.object({
      assignmentId: z.string().min(1).max(80),
      present: z.boolean(), notes: z.string().trim().max(2000),
    })).max(300),
  }),
]);
type ClassInput = Extract<z.infer<typeof input>, { action: 'create' | 'edit' }>;
type MeetingInput = Extract<z.infer<typeof input>, { action: 'schedule' | 'record' }>;
type ScheduleChange = Extract<z.infer<typeof input>, { action: 'add-day' | 'remove-day' }>;

export async function classRequest(db: DB, staff: Staff, body: unknown) {
  const parsed = input.safeParse(body);
  if (!parsed.success) throw new ClassRequestError(invalid);
  const data = parsed.data;
  const manager = canManageClasses(staff.role);
  if (data.action === 'record' ? !canTakeAttendance(staff.role) : !manager) {
    throw new ClassRequestError(forbidden, 403);
  }
  if (data.action === 'add-day' || data.action === 'remove-day') return changeSchedule(db, staff, data);
  if (data.action === 'add-leave') return addClassLeave(db, staff, data);
  const teacher = await teacherLabel(db, data.teacherId);
  if (!teacher) throw new ClassRequestError('Guru tidak ditemukan / 未找到教师', 404);
  if (data.action === 'create' || data.action === 'edit') return saveClass(db, staff, data, teacher);
  return saveMeeting(db, staff, data, teacher);
}

async function addClassLeave(db: DB, staff: Staff, data: Extract<z.infer<typeof input>, { action: 'add-leave' }>) {
  if (data.startsOn > data.endsOn) throw new ClassRequestError('Tanggal akhir sebelum tanggal mulai / 结束日期早于开始日期');
  const [student] = await db.all<{ code: string; number: string | null; name: string }>(sql`
    select c.code, s.registration_number as number, s.name_id as name
    from student_class_assignments e join classes c on c.id = e.class_id join students s on s.id = e.student_id
    where e.id = ${data.assignmentId} and c.id = ${data.classId} and e.removed_at is null and s.active = 1
  `);
  if (!student) throw new ClassRequestError('Murid belum terdaftar di kelas ini / 学生未报名此班级', 404);
  const [existing] = await db.all<{ assignmentId: string; startsOn: string; endsOn: string; reason: string }>(sql`
    select assignment_id as assignmentId, starts_on as startsOn, ends_on as endsOn, reason
    from class_leaves where id = ${data.id}
  `);
  if (existing) {
    if (existing.assignmentId !== data.assignmentId || existing.startsOn !== data.startsOn ||
      existing.endsOn !== data.endsOn || existing.reason !== data.reason) throw new ClassRequestError(stale, 409);
    return { id: data.id };
  }
  await writeBatch(db, [
    sql`insert into class_leaves (id, assignment_id, starts_on, ends_on, reason, recorded_at, recorded_by)
      values (${data.id}, ${data.assignmentId}, ${data.startsOn}, ${data.endsOn}, ${data.reason},
        ${new Date().toISOString()}, ${staff.username})`,
    audit(staff, classPages.detail, student.code, [{
      field: 'Cuti murid / 学生暂停上课', from: 'Belum diisi / 未填写',
      to: [student.number, student.name, data.startsOn + ' – ' + data.endsOn, data.reason].filter(Boolean).join(' · '),
    }], sql`exists (select 1 from class_leaves where id = ${data.id})`),
  ]);
  return { id: data.id };
}

async function saveClass(db: DB, staff: Staff, data: ClassInput, teacher: string) {
  const studentIds = [...new Set(data.studentIds)];
  if (studentIds.length) {
    const [result] = await db.all<{ total: number; activeCount: number }>(sql`
      select count(*) as total, coalesce(sum(active), 0) as activeCount
      from students where id in (select value from json_each(${JSON.stringify(studentIds)}))
    `);
    if (result.total !== studentIds.length) throw new ClassRequestError('Murid tidak ditemukan / 未找到学生', 404);
    if (result.activeCount !== studentIds.length) {
      throw new ClassRequestError('Murid nonaktif tidak dapat didaftarkan / 非在读学生无法报名', 409);
    }
  }
  const token = crypto.randomUUID();
  const guard = sql`exists (select 1 from classes where id = ${data.id} and update_token = ${token})`;
  const createdAt = new Date().toISOString();
  const enroll = sql`
    insert into student_class_assignments (id, class_id, student_id, created_at)
    select ${data.id} || ':' || value, ${data.id}, value, ${createdAt}
    from json_each(${JSON.stringify(studentIds)}) where ${guard}
    on conflict (class_id, student_id) do update set removed_at = null
      where student_class_assignments.removed_at is not null
  `;
  const [old] = await db.select().from(classes).where(eq(classes.id, data.id));
  if (data.action === 'create') {
    if (old) return { id: old.id, code: old.code };
    const dates = [...new Set(data.dates)].sort();
    const period = dates[0].slice(2, 4) + dates[0].slice(5, 7);
    const create = sql`
      insert into classes (id, code, name, teacher_id, location, created_at, recorded_by, update_token)
      select ${data.id}, ${period} || printf('%02d', n + 1), ${data.name}, ${data.teacherId}, ${data.location},
        ${createdAt}, ${staff.username}, ${token}
      from (select coalesce(max(cast(substr(code, 5, 2) as integer)), 0) as n from classes where code like ${period + '%'})
      where n < 99 on conflict(id) do nothing
    `;
    const schedule = sql`
      insert into class_days (id, class_id, day_number, date, time, minutes)
      select ${data.id} || ':' || (key + 1), ${data.id}, key + 1, value, ${data.time}, ${data.minutes}
      from json_each(${JSON.stringify(dates)}) where ${guard}
    `;
    const initialSchedule = dates.map(date => ({
      field: 'Tambah jadwal / 添加课次', from: '', to: scheduleSnapshot({ ...data, date }, teacher, data.location),
    }));
    const auditInitial = sql`
      insert into edit_history (edited_at, user_id, username, page, record_id, field, from_value, to_value)
      select ${createdAt}, ${staff.id}, ${staff.username}, ${classPages.detail},
        c.code || printf('%02d', s.key + 1), json_extract(s.value, '$.field'), '', json_extract(s.value, '$.to')
      from classes c, json_each(${JSON.stringify(initialSchedule)}) s
      where c.id = ${data.id} and c.update_token = ${token}
    `;
    await writeBatch(db, [create, schedule, enroll, auditInitial]);
    const [saved] = await db.select({ code: classes.code }).from(classes).where(eq(classes.id, data.id));
    if (!saved) throw new ClassRequestError('Nomor kelas bulan ini sudah penuh / 本月班级编号已满', 409);
    return { id: data.id, code: saved.code };
  }

  if (!old) throw new ClassRequestError(missing, 404);
  if (old.revision !== data.revision) throw new ClassRequestError(stale, 409);
  const roster = await classRoster(db, data.id);
  const existing = new Map(roster.map(student => [student.id, student]));
  const removed = new Set(data.removeStudentIds);
  if ([...removed].some(id => !existing.has(id)) || studentIds.some(id => removed.has(id))) {
    throw new ClassRequestError(stale, 409);
  }
  const added = studentIds.filter(id => !existing.has(id));
  if (existing.size - removed.size + added.length > 300) {
    throw new ClassRequestError('Maksimal 300 murid per kelas / 每班最多300名学生');
  }
  const changes = compare(old, data, [
    ['name', 'Nama kelas / 班级名称'], ['teacherId', 'Guru default / 默认教师'], ['location', 'Lokasi / 地点'],
  ]);
  for (const id of added) changes.push({ field: 'Pendaftaran kelas / 班级报名', from: '', to: String(id) });
  for (const student of roster) {
    if (removed.has(student.id)) changes.push({
      field: 'Murid dikeluarkan / 移除学生',
      from: [student.registrationNumber, student.nameId, student.nameZh].filter(Boolean).join(' · '),
      to: '',
    });
  }
  if (!changes.length) return { id: data.id, code: old.code };

  const [updated] = await writeBatch(db, [
    sql`update classes set name = ${data.name}, teacher_id = ${data.teacherId}, location = ${data.location},
      revision = revision + 1, update_token = ${token} where id = ${data.id} and revision = ${old.revision}`,
    enroll,
    sql`update student_class_assignments set removed_at = ${createdAt}
      where class_id = ${data.id} and removed_at is null and ${guard}
      and student_id in (select value from json_each(${JSON.stringify([...removed])}))`,
    audit(staff, classPages.classes, old.code, changes, guard),
  ]);
  if (!updated.meta.changes) throw new ClassRequestError(stale, 409);
  return { id: data.id, code: old.code };
}

async function changeSchedule(db: DB, staff: Staff, data: ScheduleChange) {
  const [group] = await db.select().from(classes).where(eq(classes.id, data.classId));
  if (!group) throw new ClassRequestError(missing, 404);
  const days = await db.select().from(classDays).where(eq(classDays.classId, group.id));
  const target = days.find(day => day.id === data.id);
  const adding = data.action === 'add-day';
  if (adding && target) return { id: target.id };
  const now = Date.now();
  const isFuture = (day: Pick<typeof classDays.$inferSelect, 'date' | 'time'>) =>
    meetingStart(day.date, day.time) > now;
  if (adding) {
    if (!isFuture(data)) throw new ClassRequestError(futureOnly);
    if (days.length >= 99) throw new ClassRequestError('Maksimal 99 pertemuan per kelas / 每班最多99个课次');
    if (days.some(day => day.date === data.date && day.time === data.time)) {
      throw new ClassRequestError('Jadwal sudah ada / 此课次时间已存在', 409);
    }
  } else {
    if (!target) throw new ClassRequestError(missing, 404);
    if (target.recordedAt) throw new ClassRequestError(recorded, 403);
    if (!isFuture(target)) throw new ClassRequestError(futureOnly, 409);
    if (target.revision !== data.revision) throw new ClassRequestError(stale, 409);
  }

  const locked = days.filter(day => day.recordedAt || !isFuture(day));
  const reserved = new Set(locked.map(day => day.dayNumber));
  const future = days.filter(day => !reserved.has(day.dayNumber) && day.id !== data.id);
  const ordered = [...future, ...(adding ? [{ ...data, dayNumber: 100 }] : [])]
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.dayNumber - b.dayNumber);
  let number = 0;
  const plan = ordered.map(day => {
    do { number++; } while (reserved.has(number));
    return { id: day.id, oldNumber: day.dayNumber, number, date: day.date, time: day.time };
  });
  const moved = plan.filter(row => row.id !== data.id && row.oldNumber !== row.number);
  const added = plan.find(row => row.id === data.id);
  const token = crypto.randomUUID();
  const guard = sql`exists (select 1 from classes where id = ${group.id} and update_token = ${token})`;
  const snapshot = JSON.stringify(days.map(({ id, revision }) => ({ id, revision })));
  const futureIds = JSON.stringify([...moved.map(row => row.id), ...(!adding ? [data.id] : [])]);
  const startsLater = sql`unixepoch(date || 'T' || time || ':00+07:00') > unixepoch('now')`;
  const changes: Change[] = [];
  if (adding) {
    changes.push({
      field: 'ID hari kelas / 课次编号',
      from: 'Belum diisi / 未填写',
      to: meetingCode(group.code, added!.number),
    });
  } else {
    for (const row of moved) {
      changes.push({
        field: 'ID hari kelas / 课次编号 · ' + row.date + ' ' + row.time,
        from: meetingCode(group.code, row.oldNumber), to: meetingCode(group.code, row.number),
        reference: meetingCode(group.code, row.number),
      });
    }
    const effectiveTeacher = target!.teacherId ?? group.teacherId;
    const teacher = await teacherLabel(db, effectiveTeacher);
    changes.push({
      field: 'Hapus jadwal / 删除课次',
      reference: meetingCode(group.code, target!.dayNumber),
      from: scheduleSnapshot(target!, teacher ?? String(effectiveTeacher), target!.location ?? group.location),
      to: '',
    });
  }

  const [updated] = await writeBatch(db, [
    // Only apply the plan if the schedule we read is still current and every affected meeting is still in the future.
    sql`update classes set revision = revision + 1, update_token = ${token}
      where id = ${group.id} and revision = ${group.revision}
      and (select count(*) from class_days where class_id = ${group.id}) = ${days.length}
      and not exists (
        select 1 from json_each(${snapshot}) s left join class_days d on d.id = json_extract(s.value, '$.id')
        where d.id is null or d.revision != json_extract(s.value, '$.revision')
      )
      and not exists (
        select 1 from class_days where id in (select value from json_each(${futureIds}))
        and (recorded_at is not null or not (${startsLater}))
      )
      ${adding ? sql`and unixepoch(${data.date + 'T' + data.time + ':00+07:00'}) > unixepoch('now')` : sql.empty()}`,
    ...(!adding ? [sql`delete from class_days where id = ${data.id} and ${guard}`] : []),
    // Move renumbered rows out of the positive range first so the unique index allows shifts in either direction.
    sql`update class_days set day_number = -day_number
      where id in (select value from json_each(${JSON.stringify(moved.map(row => row.id))})) and ${guard}`,
    sql`update class_days set day_number = json_extract(m.value, '$.number'), revision = revision + 1
      from json_each(${JSON.stringify(moved)}) m where class_days.id = json_extract(m.value, '$.id') and ${guard}`,
    ...(adding ? [sql`insert into class_days (id, class_id, day_number, date, time, minutes)
      select ${data.id}, ${group.id}, ${added!.number}, ${data.date}, ${data.time}, ${data.minutes} where ${guard}`] : []),
    audit(staff, classPages.detail, group.code, changes, guard),
  ]);
  if (!updated.meta.changes) throw new ClassRequestError(stale, 409);
  return { id: data.id };
}

const meetingCode = (classCode: string, dayNumber: number) => classCode + String(dayNumber).padStart(2, '0');

async function saveMeeting(db: DB, staff: Staff, data: MeetingInput, teacher: string) {
  const [row] = await db.select({ day: classDays, group: classes }).from(classDays)
    .innerJoin(classes, eq(classes.id, classDays.classId))
    .where(and(eq(classDays.id, data.id), eq(classDays.classId, data.classId)));
  if (!row) throw new ClassRequestError(missing, 404);
  const { day, group } = row;
  if (day.recordedAt) throw new ClassRequestError(recorded, 403);
  if (day.revision !== data.revision) throw new ClassRequestError(stale, 409);
  const recording = data.action === 'record';
  if (recording && data.date > todayJakarta()) {
    throw new ClassRequestError('Tanggal pertemuan belum tiba / 课次日期尚未到来');
  }
  const token = crypto.randomUUID();
  const guard = sql`exists (select 1 from class_days where id = ${day.id} and update_token = ${token})`;
  const changes = compare({ ...day, teacherId: day.teacherId ?? group.teacherId, location: day.location ?? group.location }, data, [
    ['date', 'Tanggal / 日期'], ['time', 'Jam / 时间'], ['minutes', 'Durasi (menit) / 时长（分钟）'],
    ['location', 'Lokasi / 地点'],
  ]);
  const previousTeacherId = day.teacherId ?? group.teacherId;
  if (previousTeacherId !== data.teacherId) {
    changes.push({
      field: 'Guru / 教师', from: await teacherLabel(db, previousTeacherId) ?? String(previousTeacherId), to: teacher,
    });
  }
  const roster = recording ? await meetingRoster(db, group.id) : [];
  if (recording) {
    const entries = new Map(data.entries.map(entry => [entry.assignmentId, entry]));
    if (entries.size !== data.entries.length || entries.size !== roster.length ||
        roster.some(student => !entries.has(student.assignmentId))) {
      throw new ClassRequestError('Daftar murid telah berubah. Muat ulang pertemuan. / 学生名单已更改，请刷新课次。', 409);
    }
  }
  const attendance = recording ? [sql`
    insert into class_attendance (day_id, assignment_id, present, notes, on_leave)
    select ${day.id}, json_extract(value, '$.assignmentId'),
      case when l.day_id is null then json_extract(value, '$.present') else 0 end,
      json_extract(value, '$.notes'), l.day_id is not null
    from json_each(${JSON.stringify(data.entries)}) j left join class_leave_days l
      on l.day_id = ${day.id} and l.assignment_id = json_extract(j.value, '$.assignmentId')
    where ${guard}
  `] : [];
  // A roster expansion or another save between the read and the batch invalidates this write.
  const rosterCheck = recording
    ? sql`and (select count(*) from student_class_assignments e join students s on s.id = e.student_id
      where e.class_id = ${group.id} and e.removed_at is null and s.active = 1) = ${roster.length}`
    : sql.empty();
  const [updated] = await writeBatch(db, [
    sql`update class_days set date = ${data.date}, time = ${data.time}, minutes = ${data.minutes},
      teacher_id = ${data.teacherId}, location = ${data.location}, revision = revision + 1, update_token = ${token},
      recorded_at = ${recording ? new Date().toISOString() : null},
      recorder_id = ${recording ? staff.id : null}
      where id = ${day.id} and revision = ${day.revision} and recorded_at is null ${rosterCheck}
      and exists (select 1 from classes where id = ${group.id} and revision = ${group.revision})`,
    ...attendance,
    audit(staff, recording ? classPages.records : classPages.detail,
      meetingCode(group.code, day.dayNumber), changes, guard),
  ]);
  if (!updated.meta.changes) throw new ClassRequestError(stale, 409);
  return { id: day.id };
}

function audit(staff: Staff, page: string, reference: string, changes: Change[], guard: SQL) {
  return sql`
    insert into edit_history (edited_at, user_id, username, page, record_id, field, from_value, to_value)
    select ${new Date().toISOString()}, ${staff.id}, ${staff.username}, ${page}, coalesce(json_extract(value, '$.reference'), ${reference}),
      json_extract(value, '$.field'), json_extract(value, '$.from'), json_extract(value, '$.to')
    from json_each(${JSON.stringify(changes)}) where ${guard}
  `;
}

async function teacherLabel(db: DB, id: number) {
  const [teacher] = await db.select({ nameId: teachers.nameId, nameZh: teachers.nameZh })
    .from(teachers).where(eq(teachers.id, id));
  return teacher ? [teacher.nameId, teacher.nameZh].filter(Boolean).join(' ') : undefined;
}

function scheduleSnapshot(day: { date: string; time: string; minutes: number }, teacher: string, location: string) {
  return [day.date + ' ' + day.time, day.minutes + ' menit / 分钟', teacher, location].join(' · ');
}

const dialect = new SQLiteSyncDialect();
function writeBatch(db: DB, queries: SQL[]) {
  return db.$client.batch(queries.map(query => {
    const { sql: statement, params } = dialect.sqlToQuery(query);
    return db.$client.prepare(statement).bind(...params);
  }));
}

function compare<T, K extends keyof T>(old: T, update: Pick<T, K>, fields: [K, string][]): Change[] {
  return fields.filter(([key]) => old[key] !== update[key])
    .map(([key, field]) => ({ field, from: String(old[key]), to: String(update[key]) }));
}
