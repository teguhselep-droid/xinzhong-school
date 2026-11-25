import { acceptsRequestOrigin } from '@/lib/request-origin';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { students } from '@/db/schema';
import { ensureRegistrationNumbers } from '@/lib/registration-numbers';
import { current } from '@/lib/server-auth';
import { staleFavChar, updateStudentFavChar } from '@/lib/student-fav-char';
import { FavCharConfigurationError } from '@/lib/fav-char-server';

const reply = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(req: Request) {
  try {
    const raw = await req.text();
    const staff = await current(req);
    if (!staff) return reply({ error: 'Silakan masuk / 请登录' }, 401);
    if (staff.role !== 'supervisor') return reply({ error: 'Hanya supervisor dapat mereset Fav Char / 仅主管可重置喜爱汉字' }, 403);
    if (!acceptsRequestOrigin(req)) return reply({
      error: 'Alamat akses tidak cocok. Hubungi supervisor untuk memeriksa konfigurasi alamat aplikasi. / 访问地址不匹配，请联系主管检查应用地址配置。',
    }, 403);
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
  } catch (error) {
    if (error instanceof FavCharConfigurationError) {
      console.error('Fav Char reset failed: encryption key is missing or invalid');
      return reply({ error: 'Kunci enkripsi Fav Char belum tersedia atau tidak valid. Hubungi supervisor. / 喜爱汉字加密密钥缺失或无效，请联系主管。' }, 503);
    }
    // SQL exception messages may contain bound student data or encrypted characters.
    console.error('Fav Char reset failed', {
      type: error instanceof Error ? error.name : 'Unknown',
      stack: error instanceof Error ? error.stack?.split('\n').slice(1).join('\n') : undefined,
    });
    return reply({ error: 'Gagal mereset Fav Char / 无法重置喜爱汉字' }, 500);
  }
}
