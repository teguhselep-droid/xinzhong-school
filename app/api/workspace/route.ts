import { env } from 'cloudflare:workers';
import { getDb } from '@/db';
import { users, sessions, loginLimits } from '@/db/schema';
import { eq, and, gt, sql } from 'drizzle-orm';

const roles = ['supervisor', 'admin', 'accounting', 'teacher'];
const hex = (b: ArrayBuffer | Uint8Array) => Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2,'0')).join('');
const random = () => hex(crypto.getRandomValues(new Uint8Array(32)));
const digest = async (s: string) => hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
async function hash(password: string, salt = random()) {
  const key = await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
  return salt + ':' + hex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',iterations:100000,salt:new TextEncoder().encode(salt)},key,256));
}
async function verify(password: string, stored: string) {
  const candidate = await hash(password,stored.split(':')[0]);
  let diff = candidate.length ^ stored.length;
  for (let i=0;i<stored.length;i++) diff |= stored.charCodeAt(i) ^ (candidate.charCodeAt(i)||0);
  return diff === 0;
}
const safe = (u: typeof users.$inferSelect) => ({id:u.id,username:u.username,name:u.name,role:u.role,active:!!u.active,createdAt:u.createdAt,lastLogin:u.lastLogin});
const response = (value: unknown, status=200, cookie?: string) => Response.json(value,{status,headers:{'Cache-Control':'no-store',...(cookie?{'Set-Cookie':cookie}:{})}});
const fail = (message: string,status=400) => response({error:message},status);
async function current(req: Request) {
  const token = req.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith('xz_session='))?.slice(11);
  if(!token) return null;
  const db=getDb();
  const [session]=await db.select().from(sessions).where(and(eq(sessions.tokenHash,await digest(token)),gt(sessions.expiresAt,Date.now())));
  if(!session) return null;
  const [user]=await db.select().from(users).where(and(eq(users.id,session.userId),eq(users.active,1)));
  return user||null;
}
export async function GET(req: Request) {
  try {
    const me=await current(req);
    if(!me) return response({me:null});
    return response({me:safe(me),users:me.role==='supervisor'?(await getDb().select().from(users).orderBy(users.createdAt)).map(safe):[]});
  } catch(e) { console.error('Workspace read failed',e); return fail('Layanan belum tersedia. Coba lagi. / 服务暂不可用，请重试。',503); }
}
export async function POST(req: Request) {
  try {
    const origin=req.headers.get('origin');
    if(origin && origin!==new URL(req.url).origin) return fail('Permintaan ditolak / 请求被拒绝',403);
    if(!req.headers.get('content-type')?.includes('application/json')) return fail('Format tidak valid / 格式无效',415);
    const body=await req.json() as Record<string,any>;
    const db=getDb(); const action=body.action;
    if(action==='login') {
      const username=String(body.username||'').trim().toLowerCase(); const password=String(body.password||'');
      if(username.length>40||password.length>200) return fail('Data tidak valid / 数据无效');
      const key=await digest((req.headers.get('cf-connecting-ip')||'local')+':'+username);
      const [limit]=await db.select().from(loginLimits).where(eq(loginLimits.key,key));
      if(limit && limit.resetAt>Date.now() && limit.attempts>=10) return fail('Terlalu banyak percobaan. Tunggu 15 menit. / 尝试次数过多，请等待15分钟。',429);
      await db.insert(loginLimits).values({key,attempts:1,resetAt:Date.now()+900000}).onConflictDoUpdate({target:loginLimits.key,set:{attempts:sql`CASE WHEN ${loginLimits.resetAt} < ${Date.now()} THEN 1 ELSE ${loginLimits.attempts} + 1 END`,resetAt:sql`CASE WHEN ${loginLimits.resetAt} < ${Date.now()} THEN ${Date.now()+900000} ELSE ${loginLimits.resetAt} END`}});
      const initial=(env as unknown as Record<string,string>).INITIAL_SUPERVISOR_PASSWORD;
      const [existing]=username==='teguh' ? await db.select({id:users.id}).from(users).limit(1) : [];
      if(username==='teguh' && initial && password===initial && !existing) {
        await db.insert(users).values({id:crypto.randomUUID(),username:'teguh',name:'Teguh',role:'supervisor',passwordHash:await hash(initial),active:1,createdAt:new Date().toISOString()}).onConflictDoNothing({target:users.username});
      }
      const [user]=await db.select().from(users).where(eq(users.username,username));
      if(!user||!user.active||!await verify(password,user.passwordHash)) return fail('Nama pengguna atau kata sandi salah, atau akun nonaktif. / 用户名或密码错误，或账户已停用。',401);
      const token=random();
      await db.delete(sessions).where(sql`${sessions.expiresAt} < ${Date.now()}`);
      await db.insert(sessions).values({tokenHash:await digest(token),userId:user.id,expiresAt:Date.now()+28800000});
      await db.update(users).set({lastLogin:new Date().toISOString()}).where(eq(users.id,user.id));
      await db.delete(loginLimits).where(eq(loginLimits.key,key));
      return response({ok:true},200,`xz_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${new URL(req.url).protocol==='https:'?'; Secure':''}`);
    }
    const me=await current(req);
    if(!me) return fail('Silakan masuk kembali / 请重新登录',401);
    if(action==='logout') {
      const token=req.headers.get('cookie')?.match(/(?:^|;\s*)xz_session=([^;]+)/)?.[1];
      if(token) await db.delete(sessions).where(eq(sessions.tokenHash,await digest(token)));
      return response({ok:true},200,'xz_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
    }
    if(action==='password') {
      if(!await verify(String(body.currentPassword||''),me.passwordHash)) return fail('Kata sandi saat ini salah / 当前密码错误');
      if(typeof body.password!=='string'||body.password.length<6||body.password.length>200) return fail('Kata sandi harus 6–200 karakter / 密码须为6至200个字符');
      await db.update(users).set({passwordHash:await hash(body.password)}).where(eq(users.id,me.id));
      await db.delete(sessions).where(eq(sessions.userId,me.id));
      return response({ok:true},200,'xz_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
    }
    if(me.role!=='supervisor') return fail('Hanya supervisor yang dapat mengelola pengguna / 仅主管可管理用户',403);
    if(action==='save') {
      const username=String(body.username||'').trim().toLowerCase(); const name=String(body.name||'').trim();
      if(!/^[a-z0-9._-]{3,40}$/.test(username)) return fail('Nama pengguna: 3–40 huruf, angka, titik, _ atau - / 用户名：3至40个字母、数字、点、下划线或短横线');
      if(!name||name.length>100||!roles.includes(body.role)||typeof body.active!=='boolean') return fail('Lengkapi data pengguna dengan benar / 请正确填写用户信息');
      if(body.id===me.id && (body.role!=='supervisor'||!body.active)) return fail('Anda tidak dapat menonaktifkan atau menurunkan level akun sendiri / 您不能停用自己的账户或降低自己的权限');
      const duplicate=await db.select().from(users).where(eq(users.username,username));
      if(duplicate.some(u=>u.id!==body.id)) return fail('Nama pengguna sudah digunakan / 用户名已被使用',409);
      if(body.password && (typeof body.password!=='string'||body.password.length<6||body.password.length>200)) return fail('Kata sandi harus 6–200 karakter / 密码须为6至200个字符');
      if(body.id) {
        const [target]=await db.select().from(users).where(eq(users.id,body.id));
        if(!target) return fail('Pengguna tidak ditemukan / 未找到用户',404);
        await db.update(users).set({username,name,role:body.role,active:body.active?1:0,...(body.password?{passwordHash:await hash(body.password)}:{})}).where(eq(users.id,body.id));
        if(body.password||!body.active||target.role!==body.role) await db.delete(sessions).where(eq(sessions.userId,body.id));
      } else {
        if(!body.password) return fail('Kata sandi wajib diisi / 请输入密码');
        await db.insert(users).values({id:crypto.randomUUID(),username,name,role:body.role,active:body.active?1:0,passwordHash:await hash(body.password),createdAt:new Date().toISOString()});
      }
      return response({ok:true});
    }
    return fail('Tindakan tidak dikenal / 未知操作');
  } catch(e) { console.error('Workspace operation failed',e); return fail('Tidak dapat menyimpan. Silakan coba lagi. / 无法保存，请重试。',500); }
}
