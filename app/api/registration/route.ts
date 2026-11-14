import { acceptsRequestOrigin } from '@/lib/request-origin';
import {ensureRegistrationNumbers} from '@/lib/registration-numbers';
import {getDb} from '@/db';
import {students,loginLimits} from '@/db/schema';
import {eq,sql} from 'drizzle-orm';
import {registrationFields,validateRegistration,type RegistrationData} from '@/lib/registration';
import {registrationNumber,todayJakarta} from '@/lib/student-fields';
import {encryptFavChar} from '@/lib/fav-char-server';
import {defaultFavChar} from '@/lib/chinese-input';
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function POST(req:Request){
 try{
  if(!acceptsRequestOrigin(req))return reply({error:'Permintaan ditolak / 请求被拒绝'},403);
  if(!req.headers.get('content-type')?.includes('application/json'))return reply({error:'Format tidak valid / 格式无效'},415);
  const raw=await req.text();if(raw.length>40000)return reply({error:'Data terlalu panjang / 数据过长'},413);
  let body:Record<string,unknown>;try{body=JSON.parse(raw);if(!body||Array.isArray(body)||typeof body!=='object')throw Error()}catch{return reply({error:'Data tidak valid / 数据无效'},400)}
  if(typeof body.token!=='string'||!/^\w{8}-\w{4}-\w{4}-\w{4}-\w{12}$/.test(body.token))return reply({error:'Muat ulang formulir / 请刷新表单'},400);
  const data={} as RegistrationData;
  for(const [key] of registrationFields){if(body[key]!==undefined&&typeof body[key]!=='string')return reply({error:'Data tidak valid / 数据无效'},400);data[key]=key==='nameZh'?String(body[key]??''):String(body[key]??'').trim()}
  const errors=validateRegistration(data);if(Object.keys(errors).length)return reply({errors},400);
  const db=getDb();await ensureRegistrationNumbers(db);
  const [existing]=await db.select({registrationNumber:students.registrationNumber}).from(students).where(eq(students.registrationToken,body.token));
  if(existing)return reply({registrationNumber:registrationNumber(existing)});
  const ip=req.headers.get('cf-connecting-ip')||'localhost';
  const key='registration:'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(ip)))).map(x=>x.toString(16).padStart(2,'0')).join('');
  const now=Date.now();
  const [limit]=await db.select().from(loginLimits).where(eq(loginLimits.key,key));
  if(limit&&limit.resetAt>now&&limit.attempts>=20)return reply({error:'Terlalu banyak pendaftaran. Coba lagi nanti. / 报名次数过多，请稍后重试。'},429);
  await db.insert(loginLimits).values({key,attempts:1,resetAt:now+3600000}).onConflictDoUpdate({target:loginLimits.key,set:{attempts:sql`CASE WHEN ${loginLimits.resetAt} < ${now} THEN 1 ELSE ${loginLimits.attempts}+1 END`,resetAt:sql`CASE WHEN ${loginLimits.resetAt} < ${now} THEN ${now+3600000} ELSE ${loginLimits.resetAt} END`}});
  await db.insert(students).values({...data,favCharCiphertext:await encryptFavChar(defaultFavChar),registeredDate:todayJakarta(),registrationToken:body.token}).onConflictDoNothing({target:students.registrationToken});
  const [saved]=await db.select({registrationNumber:students.registrationNumber}).from(students).where(eq(students.registrationToken,body.token));
  return reply({registrationNumber:registrationNumber(saved)},201);
 }catch(e){if(String(e).includes('REGISTRATION_MONTH_FULL'))return reply({error:'Nomor registrasi bulan ini sudah penuh / 本月注册编号已满'},409);console.error('Registration failed',e);return reply({error:'Pendaftaran gagal. Silakan coba lagi. / 报名失败，请重试。'},500)}
}
