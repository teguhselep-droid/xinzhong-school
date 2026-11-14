import {ensureRegistrationNumbers} from '@/lib/registration-numbers';
import {getDb} from '@/db';
import {students,studentSessions,editHistory} from '@/db/schema';
import {and,eq,sql} from 'drizzle-orm';
import {hash,identityHash,normalizeName,normalizePhone,selfView} from '@/lib/student-portal';
import {registrationNumber} from '@/lib/student-fields';
import {isFavChar,favCharError,defaultFavChar} from '@/lib/chinese-input';
import {verifyFavChar} from '@/lib/fav-char-server';
export const lockedMessage='Akses murid terkunci. Hubungi admin atau supervisor untuk membuka kunci. / 学生访问已锁定，请联系行政人员或主管解锁。';
export async function verifyStudent(req:Request,body:Record<string,unknown>){
 const reply=(data:unknown,status=200,cookie?:string)=>Response.json(data,{status,headers:{'Cache-Control':'no-store',Vary:'Cookie',...(cookie?{'Set-Cookie':cookie}:{})}});
 const name=typeof body.nameId==='string'?body.nameId:'',phone=typeof body.phone==='string'?body.phone:'',dob=typeof body.birthdate==='string'?body.birthdate:'';
 if(!name.trim()||name.length>200||phone.length>200||normalizePhone(phone).length<6||!/^\d{4}-\d{2}-\d{2}$/.test(dob))return reply({error:'Lengkapi nama, telepon, dan tanggal lahir / 请填写姓名、电话和出生日期'},400);
 const favChar=typeof body.favChar==='string'?body.favChar:'';
 if(!isFavChar(favChar))return reply({error:favCharError},400);
 const db=getDb();await ensureRegistrationNumbers(db);
 // Apply the same whitespace normalization as the public name input.
 let nameSql=sql`replace(replace(replace(${students.nameId},char(9),' '),char(10),' '),char(13),' ')`;
 for(let i=0;i<10;i++)nameSql=sql`replace(${nameSql},'  ',' ')`;
 const candidates=await db.select().from(students).where(sql`lower(trim(${nameSql})) = ${normalizeName(name)}`);
 const named=candidates.filter(s=>normalizeName(s.nameId)===normalizeName(name));
 const matches=named.filter(s=>normalizePhone(s.phone)===normalizePhone(phone)&&s.birthdate===dob);
 const student=named.length===1?named[0]:matches.length===1?matches[0]:null;
 if(!student)return reply({error:'Data tidak cocok atau nama tidak unik. Periksa kembali atau hubungi sekolah. / 资料不匹配或姓名重复，请检查或联系学校。'},401);
 if(student.active&&student.loginStatus==='locked')return reply({error:lockedMessage,locked:true,remainingAttempts:0},423);
 const favoriteMatches=matches.length===1&&(student.favCharCiphertext
  ? await verifyFavChar(favChar,student.favCharCiphertext)
  : favChar===defaultFavChar);
 if(!student.active)return favoriteMatches
  ? reply({error:'Status murid nonaktif. Hubungi sekolah. / 学生为非在读状态，请联系学校。'},403)
  : reply({error:'Data tidak cocok / 资料不匹配'},401);
 if(matches.length!==1||!favoriteMatches){
  const token=crypto.randomUUID(),time=new Date().toISOString();
  const guard=and(eq(students.id,student.id),eq(students.active,true),eq(students.loginStatus,'active'),eq(students.revision,student.revision));
  const result=await db.batch([
   db.update(students).set({failedLoginAttempts:sql`min(${students.failedLoginAttempts}+1,5)`,lastFailedLoginAt:time,loginStatus:sql`CASE WHEN ${students.failedLoginAttempts} >= 4 THEN 'locked' ELSE 'active' END`,loginLockedAt:sql`CASE WHEN ${students.failedLoginAttempts} >= 4 THEN ${time} ELSE NULL END`,loginVersion:sql`${students.loginVersion}+1`,loginAccessVersion:sql`CASE WHEN ${students.failedLoginAttempts} >= 4 THEN ${students.loginAccessVersion}+1 ELSE ${students.loginAccessVersion} END`,updateToken:token}).where(guard).returning({status:students.loginStatus,attempts:students.failedLoginAttempts}),
   db.insert(editHistory).select(db.select({id:sql<number>`NULL`.as('id'),editedAt:sql<string>`${time}`.as('edited_at'),userId:sql<string>`'system:student-login'`.as('user_id'),username:sql<string>`'Sistem / 系统'`.as('username'),page:sql<string>`'Data murid / 学生资料'`.as('page'),recordId:sql<string>`${registrationNumber(student)}`.as('record_id'),field:sql<string>`'Status login / 登录状态'`.as('field'),fromValue:sql<string>`'Aktif / 启用'`.as('from_value'),toValue:sql<string>`'Terkunci / 已锁定'`.as('to_value')}).from(students).where(and(eq(students.id,student.id),eq(students.updateToken,token),eq(students.loginStatus,'locked')))),
   db.delete(studentSessions).where(and(eq(studentSessions.studentId,student.id),sql`EXISTS (SELECT 1 FROM ${students} WHERE ${students.id}=${student.id} AND ${students.loginStatus}='locked')`)),
  ]);
  if(!result[0].length){const [latest]=await db.select().from(students).where(eq(students.id,student.id));return latest?.loginStatus==='locked'?reply({error:lockedMessage,locked:true,remainingAttempts:0},423):reply({error:'Data telah berubah. Silakan coba lagi. / 资料已更改，请重试。'},409)}
  const failure=result[0][0],remaining=5-failure.attempts;
  return failure.status==='locked'?reply({error:lockedMessage,locked:true,remainingAttempts:0},423):reply({error:`Data tidak cocok. Sisa percobaan: ${remaining}. / 资料不匹配，剩余尝试次数：${remaining}。`,remainingAttempts:remaining,locked:false},401);
 }
 const now=Date.now(),token=crypto.randomUUID()+crypto.randomUUID(),tokenHash=await hash(token),proof=await identityHash(student);
 // Compare auth version too: a concurrent lock or staff unlock must win over a stale verification.
 const result=await db.batch([
  db.update(students).set({failedLoginAttempts:0,loginLockedAt:null,loginVersion:student.loginVersion+1,updateToken:token}).where(and(eq(students.id,student.id),eq(students.active,true),eq(students.loginStatus,'active'),eq(students.revision,student.revision),eq(students.loginVersion,student.loginVersion))).returning({id:students.id}),
  db.insert(studentSessions).select(db.select({tokenHash:sql<string>`${tokenHash}`.as('token_hash'),studentId:sql<number>`${student.id}`.as('student_id'),identityHash:sql<string>`${proof}`.as('identity_hash'),expiresAt:sql<number>`${now+1800000}`.as('expires_at')}).from(students).where(and(eq(students.id,student.id),eq(students.updateToken,token),eq(students.active,true),eq(students.loginStatus,'active'),eq(students.loginVersion,student.loginVersion+1),eq(students.revision,student.revision)))),
 ]);
 if(!result[0].length)return reply({error:'Status akses telah berubah. Silakan coba lagi. / 访问状态已更改，请重试。'},409);
 const previous=req.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith('xz_student_session='))?.slice(19);
 if(previous)await db.delete(studentSessions).where(eq(studentSessions.tokenHash,await hash(previous)));
 await db.delete(studentSessions).where(sql`${studentSessions.expiresAt}<${now}`);
 return reply({student:await selfView(student),remainingAttempts:5},200,`xz_student_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=1800${new URL(req.url).protocol==='https:'?'; Secure':''}`);
}
