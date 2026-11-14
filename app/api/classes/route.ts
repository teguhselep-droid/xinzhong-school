import { acceptsRequestOrigin } from '@/lib/request-origin';
import { and, asc, eq, like, or } from 'drizzle-orm';
import { getDb } from '@/db';
import { students, teachers } from '@/db/schema';
import { current } from '@/lib/server-auth';
import { attendanceList, classDetails, classList, meetingRoster, studentClassHistory, teacherClassHistory } from '@/lib/class-data';
import { canManageClasses } from '@/lib/class-fields';
import { ensureRegistrationNumbers } from '@/lib/registration-numbers';
import { classRequest, ClassRequestError } from '@/lib/class-writes';

function reply(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
const login = 'Silakan masuk / 请登录';
const forbidden = 'Akses ditolak / 无访问权限';
const notFound = 'Kelas atau pertemuan tidak ditemukan / 未找到班级或课次';

export async function GET(req: Request) {
  try {
    const staff = await current(req);
    if (!staff) return reply({ error: login }, 401);
    const db = getDb();
    const query = new URL(req.url).searchParams;
    switch (query.get('view')) {
      case 'detail': {
        const detail = await classDetails(db, query.get('class') ?? '', staff);
        return detail ? reply(detail) : reply({ error: notFound }, 404);
      }
      case 'meeting': {
        const detail = await classDetails(db, query.get('class') ?? '', staff);
        const day = detail?.days.find(row => row.id === query.get('day'));
        if (!detail || !day) return reply({ error: notFound }, 404);
        if (!day.canRecord) return reply({ error: forbidden }, 403);
        return reply({ day, roster: await meetingRoster(db, detail.group.id) });
      }
      case 'records':
        return reply(await attendanceList(db, query));
      case 'teachers':
        return reply(await db.select({ id: teachers.id, nameId: teachers.nameId, nameZh: teachers.nameZh })
          .from(teachers).where(eq(teachers.active, true)).orderBy(asc(teachers.nameId), asc(teachers.id)));
      case 'teacher-history':
        return reply(await teacherClassHistory(db, query));
      case 'student-history': {
        const id = Number(query.get('student'));
        if (!Number.isSafeInteger(id) || id < 1) return reply({ error: 'Data tidak valid / 数据无效' }, 400);
        return reply(await studentClassHistory(db, id, query));
      }
      case 'students': {
        if (!canManageClasses(staff.role)) return reply({ error: forbidden }, 403);
        const search = (query.get('search') ?? '').trim().slice(0, 100);
        if (!search) return reply([]);
        await ensureRegistrationNumbers(db);
        const match = '%' + search + '%';
        return reply(await db.select({
          id: students.id, nameId: students.nameId, nameZh: students.nameZh,
          registrationNumber: students.registrationNumber,
        }).from(students).where(and(eq(students.active, true), or(like(students.nameId, match), like(students.nameZh, match),
          like(students.registrationNumber, match)))).orderBy(asc(students.nameId), asc(students.id)).limit(30));
      }
      default:
        return reply(await classList(db, query));
    }
  } catch (error) {
    console.error('Class read failed', error);
    return reply({ error: 'Gagal memuat data kelas / 无法加载班级资料' }, 500);
  }
}

export async function POST(req: Request) {
  try {
    const raw = await req.text();
    const staff = await current(req);
    if (!staff) return reply({ error: login }, 401);
    if (!acceptsRequestOrigin(req)) return reply({ error: forbidden }, 403);
    if (!req.headers.get('content-type')?.includes('application/json')) return reply({ error: 'Format tidak valid / 格式无效' }, 415);
    if (raw.length > 750000) return reply({ error: 'Isi terlalu panjang / 内容过长' }, 413);
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return reply({ error: 'Data tidak valid / 数据无效' }, 400); }
    return reply(await classRequest(getDb(), staff, body));
  } catch (error) {
    if (error instanceof ClassRequestError) return reply({ error: error.message }, error.status);
    for (let cause: unknown = error; cause instanceof Error; cause = cause.cause) {
      if (cause.message.includes('INACTIVE_STUDENT_ENROLLMENT')) {
        return reply({ error: 'Murid nonaktif tidak dapat didaftarkan / 非在读学生无法报名' }, 409);
      }
      if (cause.message.includes('INACTIVE_TEACHER_ASSIGNMENT')) {
        return reply({ error: 'Pilih guru yang aktif / 请选择在职教师' }, 409);
      }
      if (cause.message.includes('PAYMENT_DAY_ALREADY_PAID')) {
        return reply({ error: 'Jadwal sudah dibayar / 该课次已付款' }, 409);
      }
      if (cause.message.includes('LEAVE_OVERLAP')) return reply({ error: 'Periode cuti bertumpang tindih / 请假日期重叠' }, 409);
      if (cause.message.includes('LEAVE_ATTENDANCE_LOCKED')) return reply({ error: 'Kehadiran dalam periode ini sudah dicatat / 此期间的出勤已记录' }, 409);
      if (cause.message.includes('LEAVE_ENROLLMENT_REQUIRED')) return reply({ error: 'Pilih murid yang masih terdaftar / 请选择仍在班级中的学生' }, 409);
    }
    console.error('Class write failed', error);
    return reply({ error: 'Gagal menyimpan data kelas / 无法保存班级资料' }, 500);
  }
}
