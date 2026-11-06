import { getDb } from '@/db';
import { sessions, users } from '@/db/schema';
import { eq, and, gt } from 'drizzle-orm';
export async function current(req: Request) {
  const token = req.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith('xz_session='))?.slice(11);
  if(!token) return null;
  const db=getDb();
  const [session]=await db.select().from(sessions).where(and(eq(sessions.tokenHash,Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))).map(x=>x.toString(16).padStart(2,'0')).join('')),gt(sessions.expiresAt,Date.now())));
  if(!session) return null;
  const [user]=await db.select().from(users).where(and(eq(users.id,session.userId),eq(users.active,1)));
  return user||null;
}