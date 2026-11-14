import { acceptsRequestOrigin } from '@/lib/request-origin';
import {verifyStudent} from '@/lib/student-login';
import {getDb} from '@/db';
import {students,studentSessions,editHistory} from '@/db/schema';
import {eq,and,sql} from 'drizzle-orm';
import {identityHash,selfView,studentIdentity} from '@/lib/student-portal';
import {registrationFields,validateRegistration,type RegistrationData} from '@/lib/registration';
import {registrationNumber} from '@/lib/student-fields';
import { isFavChar, favCharError } from '@/lib/chinese-input';
import { staleFavChar, updateStudentFavChar } from '@/lib/student-fav-char';
const reply=(body:unknown,status=200,cookie?:string)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','Vary':'Cookie',...(cookie?{'Set-Cookie':cookie}:{})}});
const fail=(error:string,status=400)=>reply({error},status);
const clearCookie='xz_student_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0';
export async function GET(req:Request){try{const who=await studentIdentity(req);return reply({student:who?await selfView(who.student):null})}catch(e){console.error(e);return fail('Gagal memuat data / 无法加载资料',500)}}
export async function POST(req:Request){
 try{
  if(!acceptsRequestOrigin(req))return fail('Permintaan ditolak / 请求被拒绝',403);
  if(!req.headers.get('content-type')?.includes('application/json'))return fail('Format tidak valid / 格式无效',415);
  const raw=await req.text();if(raw.length>40000)return fail('Data terlalu panjang / 数据过长',413);
  let body:Record<string,unknown>;try{body=JSON.parse(raw);if(!body||typeof body!=='object'||Array.isArray(body))throw Error()}catch{return fail('Data tidak valid / 数据无效')}
  const db=getDb();
  if(body.action==='verify')return verifyStudent(req,body);
  const who=await studentIdentity(req);if(!who)return reply({error:'Silakan verifikasi kembali / 请重新验证'},401,clearCookie);
  if(body.action==='logout'){await db.delete(studentSessions).where(eq(studentSessions.tokenHash,who.session.tokenHash));return reply({ok:true},200,clearCookie)}
  if(body.action!=='save'&&body.action!=='change-fav-char')return fail('Tindakan tidak dikenal / 未知操作');
  const old=who.student;
  if(body.registrationNumber!==registrationNumber(old))return fail('Sesi murid telah berubah. Muat ulang sebelum mengedit. / 学生会话已更改，请刷新后编辑。',409);
  if(body.revision!==old.revision)return fail('Data telah berubah. Muat ulang sebelum mengedit. / 资料已更改，请刷新后编辑。',409);
  if (body.action === 'change-fav-char') {
   if (typeof body.newFavChar !== 'string' || !isFavChar(body.newFavChar)) return fail(favCharError);
   const updated = await updateStudentFavChar(db, old, {
    type: 'student', sessionTokenHash: who.session.tokenHash, newFavChar: body.newFavChar,
   });
   return updated ? reply({ok:true,reverify:true},200,clearCookie) : fail(staleFavChar,409);
  }
  if(Object.hasOwn(body,'favChar')||Object.hasOwn(body,'newFavChar'))return fail('Gunakan Ubah Fav Char / 请使用更改喜爱汉字',403);
  if(old.nik&&body.nik!==undefined&&body.nik!=='')return fail('NIK hanya dapat diisi ketika masih kosong / 仅可填写尚未登记的身份证号码',403);
  const data={} as RegistrationData;
  for(const [key] of registrationFields){if(key==='nik'&&old.nik){data.nik=old.nik;continue}if(typeof body[key]!=='string')return fail('Lengkapi biodata / 请填写个人资料');data[key]=key==='nameZh'?(body[key] as string):(body[key] as string).trim()}
  const errors=validateRegistration(data);if(!data.nik)delete errors.nik;if(Object.keys(errors).length)return reply({errors},400);
  const changed=registrationFields.filter(([key])=>data[key]!==old[key]);if(!changed.length)return reply({student:await selfView(old),ok:true});
  const token=crypto.randomUUID(),now=new Date().toISOString(),changes=Object.fromEntries(changed.map(([key])=>[key,data[key]]));
  const audit=changed.map(([key,label])=>db.insert(editHistory).select(db.select({id:sql<number>`NULL`.as('id'),editedAt:sql<string>`${now}`.as('edited_at'),userId:sql<string>`${'student:'+old.id}`.as('user_id'),username:sql<string>`${'Murid / 学生 '+registrationNumber(old)}`.as('username'),page:sql<string>`'Biodata murid / 学生个人资料'`.as('page'),recordId:sql<string>`${registrationNumber(old)}`.as('record_id'),field:sql<string>`${label}`.as('field'),fromValue:sql<string>`${old[key]}`.as('from_value'),toValue:sql<string>`${data[key]}`.as('to_value')}).from(students).where(and(eq(students.id,old.id),eq(students.updateToken,token)))));
  const updated={...old,...changes,revision:old.revision+1};
  const reverify=['nameId','phone','birthdate'].some(key=>key in changes);
  const result=await db.batch([db.update(students).set({...changes,revision:updated.revision,updateToken:token}).where(and(eq(students.id,old.id),eq(students.revision,old.revision),eq(students.active,true),eq(students.loginStatus,'active'),eq(students.loginAccessVersion,old.loginAccessVersion))).returning({id:students.id}),...audit]);
  if(!result[0].length)return fail('Data telah berubah. Muat ulang sebelum mengedit. / 资料已更改，请刷新后编辑。',409);
  // Updating identity invalidates all earlier identity hashes. NIK completion does too.
  if(reverify){await db.delete(studentSessions).where(eq(studentSessions.studentId,old.id));return reply({ok:true,reverify:true},200,clearCookie)}
  await db.update(studentSessions).set({identityHash:await identityHash(updated)}).where(eq(studentSessions.tokenHash,who.session.tokenHash));
  return reply({student:await selfView(updated),ok:true});
 }catch(e){console.error('Student portal failed',e);return fail('Tidak dapat memproses. Coba lagi. / 无法处理，请重试。',500)}
}
