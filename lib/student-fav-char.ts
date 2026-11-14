import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { editHistory, students, studentSessions } from '@/db/schema';
import { defaultFavChar } from '@/lib/chinese-input';
import { encryptFavChar } from '@/lib/fav-char-server';
import { registrationNumber } from '@/lib/student-fields';

type Actor = { type: 'supervisor'; id: string; username: string } |
  { type: 'student'; sessionTokenHash: string; newFavChar: string };

export const staleFavChar = 'Data telah berubah. Muat ulang dan coba lagi. / 资料已更改，请刷新后重试。';

export async function updateStudentFavChar(db: ReturnType<typeof getDb>, student: typeof students.$inferSelect, actor: Actor) {
  const self = actor.type === 'student';
  const ciphertext = await encryptFavChar(self ? actor.newFavChar : defaultFavChar);
  const token = crypto.randomUUID();
  const now = Date.now();
  const number = registrationNumber(student);
  const updated = and(eq(students.id, student.id), eq(students.updateToken, token));
  const [saved] = await db.batch([
    db.update(students).set({
      favCharCiphertext: ciphertext,
      revision: sql`${students.revision} + 1`,
      loginVersion: sql`${students.loginVersion} + 1`,
      loginAccessVersion: sql`${students.loginAccessVersion} + 1`,
      updateToken: token,
    }).where(and(
      eq(students.id, student.id), eq(students.revision, student.revision),
      eq(students.loginAccessVersion, student.loginAccessVersion),
      self ? eq(students.active, true) : undefined,
      self ? eq(students.loginStatus, 'active') : undefined,
      self ? sql`exists (select 1 from student_sessions
        where student_id = ${student.id} and token_hash = ${actor.sessionTokenHash} and expires_at > ${now})` : undefined,
    )).returning({ revision: students.revision, loginVersion: students.loginVersion }),
    db.insert(editHistory).select(db.select({
      id: sql<number>`NULL`.as('id'),
      editedAt: sql<string>`${new Date(now).toISOString()}`.as('edited_at'),
      userId: sql<string>`${self ? 'student:' + student.id : actor.id}`.as('user_id'),
      username: sql<string>`${self ? 'Murid / 学生 ' + number : actor.username}`.as('username'),
      page: sql<string>`${self ? 'Portal murid / 学生门户' : 'Data murid / 学生资料'}`.as('page'),
      recordId: sql<string>`${number}`.as('record_id'),
      field: sql<string>`'Fav Char / 喜爱汉字'`.as('field'),
      fromValue: sql<string>`''`.as('from_value'),
      toValue: sql<string>`${self ? 'Diubah oleh murid / 学生已更改' : 'Direset ke bawaan / 已重置为默认值'}`.as('to_value'),
    }).from(students).where(updated)),
    db.delete(studentSessions).where(and(
      eq(studentSessions.studentId, student.id),
      sql`exists (select 1 from ${students} where ${updated})`,
    )),
  ]);
  return saved[0];
}
