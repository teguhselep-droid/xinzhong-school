import { and, asc, count, desc, eq, getTableColumns, like, or, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { editHistory, teachers } from '@/db/schema';
import { chineseNameError, isChineseName } from '@/lib/chinese-input';
import { current } from '@/lib/server-auth';
import { todayJakarta } from '@/lib/student-fields';
import { canEditTeachers, teacherFields, teacherPageLabel, teacherPageSize, teacherStatusField, teacherStatusLabel } from '@/lib/teacher-fields';
import { teacherClassCount, teacherMeetingCount } from '@/lib/class-data';

function reply(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}
const fail = (error: string, status = 400) => reply({ error }, status);
const signIn = 'Silakan masuk / 请登录';
const forbidden = 'Akses ditolak / 无访问权限';
const invalid = 'Data tidak valid / 数据无效';
const conflict = 'Data telah berubah. Muat ulang sebelum mengedit. / 资料已更改，请刷新后编辑。';

export async function GET(req: Request) {
  try {
    const staff = await current(req);
    if (!staff) return fail(signIn, 401);

    const query = new URL(req.url).searchParams;
    const sort = query.get('sort') ?? 'nameId';
    const canSeeNik = staff.role === 'supervisor';
    if (sort === 'nik' && !canSeeNik) return fail(forbidden, 403);

    const { nik, updateToken: _updateToken, ...publicColumns } = getTableColumns(teachers);
    const visibleColumns = canSeeNik ? { ...publicColumns, nik } : publicColumns;
    const columns = {
      ...visibleColumns,
      classCount: teacherClassCount.as('class_count'),
      attendanceCount: teacherMeetingCount.as('attendance_count'),
    };
    const sortColumn = Object.hasOwn(columns, sort) && sort !== 'revision'
      ? columns[sort as keyof typeof columns]
      : teachers.nameId;
    const order = query.get('direction') === 'desc' ? desc : asc;
    const search = (query.get('search') ?? '').trim().slice(0, 200);
    const searchable = [teachers.nameId, teachers.nameZh, teachers.phone, teachers.city, ...(canSeeNik ? [nik] : [])];
    const where = search ? or(...searchable.map(column => like(column, `%${search}%`))) : undefined;
    const requestedPage = Math.max(1, Math.trunc(Number(query.get('page'))) || 1);
    const db = getDb();
    const [{ total }] = await db.select({ total: count() }).from(teachers).where(where);
    const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / teacherPageSize)));
    const rows = await db.select(columns).from(teachers).where(where)
      .orderBy(order(sortColumn), asc(teachers.id))
      .limit(teacherPageSize).offset((page - 1) * teacherPageSize);
    return reply({ rows, total, page });
  } catch (error) {
    console.error('Teacher list failed', error);
    return fail('Gagal memuat data guru / 无法加载教师资料', 500);
  }
}

export async function POST(req: Request) {
  try {
    const raw = await req.text();
    const staff = await current(req);
    if (!staff) return fail(signIn, 401);
    if (!canEditTeachers(staff.role)) return fail(forbidden, 403);
    const origin = req.headers.get('origin');
    if (origin && origin !== new URL(req.url).origin) return fail(forbidden, 403);
    if (!req.headers.get('content-type')?.includes('application/json')) return fail(invalid, 415);

    if (raw.length > 16000) return fail('Isi terlalu panjang / 内容过长', 413);
    let body: Record<string, unknown>;
    try {
      const value: unknown = JSON.parse(raw);
      if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(invalid);
      body = value as Record<string, unknown>;
    } catch {
      return fail(invalid);
    }
    if (staff.role !== 'supervisor' && Object.hasOwn(body, 'nik')) return fail(forbidden, 403);
    if (Object.hasOwn(body, 'classCount') || Object.hasOwn(body, 'attendanceCount')) return fail(invalid);
    const creating = !Object.hasOwn(body, 'id');
    if (!creating && (!Number.isSafeInteger(body.id) || !Number.isSafeInteger(body.revision))) {
      return fail(invalid);
    }

    const today = todayJakarta();
    const profile: typeof teachers.$inferInsert = { nameId: '', registeredDate: today };
    if (Object.hasOwn(body, 'active')) {
      if (typeof body.active !== 'boolean') return fail('Status guru tidak valid / 教师状态无效');
      profile.active = body.active;
    }
    for (const [key] of teacherFields) {
      if (key === 'nik' && staff.role !== 'supervisor') continue;
      const rawValue = body[key];
      if (rawValue === undefined && creating) continue;
      if (typeof rawValue !== 'string') return fail(invalid);
      const value = key === 'nameZh' ? rawValue : rawValue.trim();
      if (value.length > (key === 'address' ? 2000 : 200)) return fail('Isi terlalu panjang / 内容过长');
      if (key === 'nameZh' && !isChineseName(value)) return fail(chineseNameError);
      if (key === 'nik' && value && !/^\d{16}$/.test(value)) {
        return fail('NIK harus 16 angka / 身份证号码须为16位数字');
      }
      if (key === 'phone' && value && (!/^[+\d\s().-]+$/.test(value) || !/^\d{6,20}$/.test(value.replace(/\D/g, '')))) {
        return fail('Nomor telepon tidak valid / 电话号码无效');
      }
      if (key === 'registeredDate' || (key === 'birthdate' && value)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) ||
            new Date(value).toISOString().slice(0, 10) !== value || value > today) {
          return fail('Tanggal tidak valid / 日期无效');
        }
      }
      profile[key] = value;
    }
    if (!profile.nameId) return fail('Nama Indonesia wajib diisi / 请输入印尼姓名');

    const db = getDb();
    if (creating) {
      const [row] = await db.insert(teachers).values({ ...profile, recordedBy: staff.username })
        .returning({ id: teachers.id });
      return reply({ id: row.id }, 201);
    }

    const [old] = await db.select().from(teachers).where(eq(teachers.id, Number(body.id)));
    if (!old) return fail('Guru tidak ditemukan / 未找到教师', 404);
    if (old.revision !== body.revision) return fail(conflict, 409);
    const changed: { field: string; from: string; to: string }[] =
      teacherFields.filter(([key]) => profile[key] !== undefined && profile[key] !== old[key])
      .map(([key, field]) => ({ field, from: old[key], to: profile[key]! }));
    if (profile.active !== undefined && profile.active !== old.active) {
      changed.push({ field: teacherStatusField, from: teacherStatusLabel(old.active), to: teacherStatusLabel(profile.active) });
    }
    if (!changed.length) return reply({ id: old.id });

    const token = crypto.randomUUID();
    const editedAt = new Date().toISOString();
    const reference = 'Guru / 教师 #' + old.id;
    // The token ties each history insert to the edit that won the revision check.
    const audits = changed.map(({ field, from, to }) => db.insert(editHistory).select(db.select({
      id: sql<number>`NULL`.as('id'),
      editedAt: sql<string>`${editedAt}`.as('edited_at'),
      userId: sql<string>`${staff.id}`.as('user_id'),
      username: sql<string>`${staff.username}`.as('username'),
      page: sql<string>`${teacherPageLabel}`.as('page'),
      recordId: sql<string>`${reference}`.as('record_id'),
      field: sql<string>`${field}`.as('field'),
      fromValue: sql<string>`${from}`.as('from_value'),
      toValue: sql<string>`${to}`.as('to_value'),
    }).from(teachers).where(and(eq(teachers.id, old.id), eq(teachers.updateToken, token)))));
    const [updated] = await db.batch([
      db.update(teachers).set({ ...profile, revision: old.revision + 1, updateToken: token })
        .where(and(eq(teachers.id, old.id), eq(teachers.revision, old.revision)))
        .returning({ id: teachers.id }),
      ...audits,
    ]);
    return updated.length ? reply({ id: old.id }) : fail(conflict, 409);
  } catch (error) {
    console.error('Teacher save failed', error);
    return fail('Gagal menyimpan data guru / 无法保存教师资料', 500);
  }
}
