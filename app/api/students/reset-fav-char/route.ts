import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { students } from '@/db/schema';
import { ensureRegistrationNumbers } from '@/lib/registration-numbers';
import { current } from '@/lib/server-auth';
import { staleFavChar, updateStudentFavChar } from '@/lib/student-fav-char';

const reply = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(req: Request) {
  try {
    const raw = await req.text();
    const staff = await current(req);
    if (!staff) return reply({ error: 'Silakan masuk / 请登录' }, 401);
    const origin = req.headers.get('origin');
    if (staff.role !== 'supervisor' || (origin && origin !== new URL(req.url).origin)) {
      return reply({ error: 'Akses ditolak / 无访问权限' }, 403);
    }
    const invalid = { error: 'Data tidak valid / 数据无效' };
    if (!req.headers.get('content-type')?.includes('application/json')) return reply(invalid, 415);
    if (raw.length > 2000) return reply(invalid, 413);
    let body: { id?: number; revision?: number } | null;
    try { body = JSON.parse(raw); } catch { return reply(invalid, 400); }
    if (!body || !Number.isSafeInteger(body.id) || !Number.isSafeInteger(body.revision)) return reply(invalid, 400);

    const db = getDb();
    await ensureRegistrationNumbers(db);
    const [student] = await db.select().from(students).where(eq(students.id, Number(body.id)));
    if (!student) return reply({ error: 'Murid tidak ditemukan / 未找到学生' }, 404);
    if (student.revision !== body.revision) return reply({ error: staleFavChar }, 409);
    const updated = await updateStudentFavChar(db, student, { type: 'supervisor', id: staff.id, username: staff.username });
    return updated ? reply(updated) : reply({ error: staleFavChar }, 409);
  } catch {
    return reply({ error: 'Gagal mereset Fav Char / 无法重置喜爱汉字' }, 500);
  }
}
