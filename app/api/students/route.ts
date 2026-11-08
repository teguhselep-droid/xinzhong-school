import {ensureRegistrationNumbers} from '@/lib/registration-numbers';
import { getDb } from '@/db';
import { students, editHistory,studentSessions } from '@/db/schema';
import { current } from '@/lib/server-auth';
import {studentCanBeDeleted} from '@/lib/student-deletion';
import { studentClassSummary } from '@/lib/student-class-summary';
import {isChineseName,chineseNameError} from '@/lib/chinese-input';
import {isFavChar,favCharError} from '@/lib/chinese-input';
import {encryptFavChar,decryptFavChar} from '@/lib/fav-char-server';
import { studentFields, registrationNumber, todayJakarta, ageYears,loginStatusLabels } from '@/lib/student-fields';
import { asc, desc, eq, and, or, like, sql, getTableColumns } from 'drizzle-orm';
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const fail=(error:string,status=400)=>reply({error},status);
export async function GET(req:Request){
 try {
  const me=await current(req);if(!me)return fail('Silakan masuk / 请登录',401);
  const q=new URL(req.url).searchParams, page=Math.max(1,Math.min(100000,Number(q.get('page'))||1));
  const search=(q.get('search')||'').slice(0,200), sort=q.get('sort')||'id';
  if(sort==='nik'&&me.role!=='supervisor')return fail('Akses ditolak / 无访问权限',403);
  if(sort==='favChar'&&me.role!=='supervisor')return fail('Akses ditolak / 无访问权限',403);
  const searchable=[students.nameId,students.nameZh,students.phone,students.city,students.parentName,...(me.role==='supervisor'?[students.nik]:[])];
  const where=search?or(...searchable.map(c=>like(c,`%${search}%`)),like(students.registrationNumber,`%${search}%`)):undefined;
  const age=sql`CASE WHEN ${students.birthdate} = '' THEN NULL ELSE CAST(substr(${todayJakarta()},1,4) AS INTEGER) - CAST(substr(${students.birthdate},1,4) AS INTEGER) - (substr(${todayJakarta()},6,5) < substr(${students.birthdate},6,5)) END`;
  const columns:Record<string,any>={id:students.id,registrationNumber:students.registrationNumber,age,...Object.fromEntries(studentFields.map(([k])=>[k,students[k]])),loginStatus:students.loginStatus,...studentClassSummary};
  const order=q.get('direction')==='desc'?desc:asc, db=getDb();await ensureRegistrationNumbers(db);
  const [{total}]=await db.select({total:sql<number>`count(*)`}).from(students).where(where);
  const actualPage=Math.min(page,Math.max(1,Math.ceil(total/10)));
  const rows=await db.select({...getTableColumns(students),...studentClassSummary,canDelete:sql<number>`CASE WHEN ${studentCanBeDeleted()} THEN 1 ELSE 0 END`}).from(students).where(where).orderBy(order(columns[sort]||students.id),asc(students.id)).limit(sort==='favChar'?total:10).offset(sort==='favChar'?0:(actualPage-1)*10);
  let views=await Promise.all(rows.map(async({updateToken,registrationToken,nik,favCharCiphertext,...s})=>({...s,...(me.role==='supervisor'?{nik,favChar:favCharCiphertext?await decryptFavChar(favCharCiphertext):'',hasFavChar:!!favCharCiphertext}:{}),canDelete:!!s.canDelete,registrationNumber:registrationNumber(s)})));
  if(sort==='favChar'){views.sort((a,b)=>((a.favChar||'').localeCompare(b.favChar||'','zh-Hans')*(q.get('direction')==='desc'?-1:1))||a.id-b.id);views=views.slice((actualPage-1)*10,actualPage*10)}
  return reply({rows:views,total,page:actualPage});
 }catch(e){console.error(e);return fail('Gagal memuat data murid / 无法加载学生资料',500)}
}
export async function POST(req:Request){
 try {
  if(!req.headers.get('content-type')?.includes('application/json'))return fail('Format tidak valid / 格式无效',415);
  const body=await req.json() as Record<string,unknown>;
  const me=await current(req); if(!me)return fail('Silakan masuk / 请登录',401);
  if(!['supervisor','admin'].includes(me.role))return fail('Akses ditolak / 无访问权限',403);
  if(me.role!=='supervisor'&&Object.prototype.hasOwnProperty.call(body,'nik'))return fail('Hanya supervisor dapat mengubah NIK / 仅主管可修改身份证号码',403);
  if(me.role!=='supervisor'&&Object.prototype.hasOwnProperty.call(body,'favChar'))return fail('Hanya supervisor dapat mengubah Fav Char / 仅主管可修改喜爱汉字',403);
  if(req.headers.get('origin')&&req.headers.get('origin')!==new URL(req.url).origin)return fail('Permintaan ditolak / 请求被拒绝',403);
  const db=getDb();await ensureRegistrationNumbers(db);
  if(!Number.isInteger(body.id)||!Number.isInteger(body.revision))return fail('Data tidak valid / 数据无效');
  const [old]=await db.select().from(students).where(eq(students.id,Number(body.id))); if(!old)return fail('Murid tidak ditemukan / 未找到学生',404);
  if(old.revision!==body.revision)return fail('Data telah berubah. Muat ulang sebelum mengedit. / 资料已更改，请刷新后编辑。',409);
  const changes:Partial<typeof students.$inferInsert>={};
  if(Object.prototype.hasOwnProperty.call(body,'favChar')){
   if(typeof body.favChar!=='string'||(body.favChar!==''||old.favCharCiphertext)&&!isFavChar(body.favChar))return fail(favCharError);
   if(body.favChar&&(!old.favCharCiphertext||body.favChar!==await decryptFavChar(old.favCharCiphertext))){changes.favCharCiphertext=await encryptFavChar(body.favChar);changes.loginVersion=old.loginVersion+1;changes.loginAccessVersion=old.loginAccessVersion+1;}
  }
  const hasStatus=Object.prototype.hasOwnProperty.call(body,'loginStatus');
  if(hasStatus){
   if(body.loginStatus!=='active'&&body.loginStatus!=='locked')return fail('Status login tidak valid / 登录状态无效');
   if(body.loginVersion!==old.loginVersion)return fail('Status login telah berubah. Muat ulang sebelum menyimpan. / 登录状态已更改，请刷新后保存。',409);
   if(body.loginStatus!==old.loginStatus){changes.loginStatus=body.loginStatus;changes.loginVersion=old.loginVersion+1;changes.loginAccessVersion=old.loginAccessVersion+1;changes.loginLockedAt=body.loginStatus==='locked'?new Date().toISOString():null;if(body.loginStatus==='active')changes.failedLoginAttempts=0;}
  }
  for(const [key] of studentFields){
   if(key==='nik'&&me.role!=='supervisor')continue;
   if(typeof body[key]!=='string')return fail('Lengkapi data murid / 请填写学生资料');
   const value=key==='nameZh'?(body[key] as string):(body[key] as string).trim(), max=key==='notes'?20000:key==='address'?2000:200;
   if(key==='nameZh'&&!isChineseName(value))return fail(chineseNameError);
   if(value.length>max)return fail('Isi terlalu panjang / 内容过长');
   if(key==='nameId'&&!value)return fail('Nama Indonesia wajib diisi / 请输入印尼姓名');
   if(key==='nik'&&value&&!/^\d{16}$/.test(value))return fail('NIK harus 16 angka / 身份证号码须为16位数字');
   if((key==='birthdate'||key==='registeredDate')&&(value||key==='registeredDate')){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value||value>todayJakarta())return fail('Tanggal tidak valid / 日期无效');
   }
   if(old[key]!==value)changes[key]=value;
  }
  const updated={...old,...changes};
  if(updated.birthdate&&(ageYears(updated.birthdate)??18)<18&&(!updated.parentName.trim()||!updated.parentPhone.trim()))return fail('Nama dan telepon orang tua wajib untuk usia di bawah 18 tahun / 未满18岁必须填写家长姓名和电话');
  if(!Object.keys(changes).length)return reply({ok:true});
  const token=crypto.randomUUID(), editedAt=new Date().toISOString();
  // D1 batch is atomic: revision guard and per-field audit inserts succeed together.
  const auditValues:{label:string;from:string;to:string}[]=studentFields.filter(([key])=>key in changes).map(([key,label])=>({label,from:old[key],to:String(changes[key])}));
  if(changes.loginStatus)auditValues.push({label:'Status login / 登录状态',from:loginStatusLabels[old.loginStatus],to:loginStatusLabels[changes.loginStatus as string]});
  if(changes.favCharCiphertext)auditValues.push({label:'Fav Char / 喜爱汉字',from:old.favCharCiphertext?'Tersimpan / 已设置':'Belum diisi / 未设置',to:'Diubah / 已更改'});
  if(changes.failedLoginAttempts===0&&old.failedLoginAttempts>0)auditValues.push({label:'Percobaan gagal / 失败次数',from:String(old.failedLoginAttempts),to:'0'});
  const audits=auditValues.map(v=>db.insert(editHistory).select(
   db.select({id:sql<number>`NULL`.as('id'),editedAt:sql<string>`${editedAt}`.as('edited_at'),userId:sql<string>`${me.id}`.as('user_id'),username:sql<string>`${me.username}`.as('username'),page:sql<string>`'Data murid / 学生资料'`.as('page'),recordId:sql<string>`${registrationNumber(old)}`.as('record_id'),field:sql<string>`${v.label}`.as('field'),fromValue:sql<string>`${v.from}`.as('from_value'),toValue:sql<string>`${v.to}`.as('to_value')}).from(students).where(and(eq(students.id,old.id),eq(students.updateToken,token)))
  ));
  const sessionRevocation=changes.loginStatus||changes.favCharCiphertext?[db.delete(studentSessions).where(and(eq(studentSessions.studentId,old.id),sql`EXISTS (SELECT 1 FROM ${students} WHERE ${students.id}=${old.id} AND ${students.updateToken}=${token})`))]:[];
  const result=await db.batch([db.update(students).set({...changes,revision:old.revision+1,updateToken:token}).where(and(eq(students.id,old.id),eq(students.revision,old.revision),...(hasStatus||changes.favCharCiphertext?[eq(students.loginVersion,old.loginVersion)]:[]))).returning({id:students.id}),...audits,...sessionRevocation]);
  if(!result[0].length)return fail('Data telah berubah. Muat ulang sebelum mengedit. / 资料已更改，请刷新后编辑。',409);
  return reply({ok:true});
 }catch(e){console.error(e);return fail('Gagal menyimpan murid / 无法保存学生资料',500)}
}
