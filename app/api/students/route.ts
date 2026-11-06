import { getDb } from '@/db';
import { students, editHistory } from '@/db/schema';
import { current } from '@/lib/server-auth';
import { studentFields, registrationNumber, todayJakarta, ageYears } from '@/lib/student-fields';
import { asc, desc, eq, and, or, like, sql } from 'drizzle-orm';
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const fail=(error:string,status=400)=>reply({error},status);
export async function GET(req:Request){
 try {
  if(!await current(req))return fail('Silakan masuk / 请登录',401);
  const q=new URL(req.url).searchParams, page=Math.max(1,Math.min(100000,Number(q.get('page'))||1));
  const search=(q.get('search')||'').slice(0,200), sort=q.get('sort')||'id';
  const where=search?or(...[students.nameId,students.nameZh,students.nik,students.phone,students.city,students.parentName].map(c=>like(c,`%${search}%`)),like(sql`'SHHS-' || printf('%06d', ${students.id})`,`%${search}%`)):undefined;
  const age=sql`CASE WHEN ${students.birthdate} = '' THEN NULL ELSE CAST(substr(${todayJakarta()},1,4) AS INTEGER) - CAST(substr(${students.birthdate},1,4) AS INTEGER) - (substr(${todayJakarta()},6,5) < substr(${students.birthdate},6,5)) END`;
  const columns:Record<string,any>={id:students.id,registrationNumber:students.id,age,...Object.fromEntries(studentFields.map(([k])=>[k,students[k]])),currentClass:students.currentClass,lastAttendanceDate:students.lastAttendanceDate};
  const order=q.get('direction')==='desc'?desc:asc, db=getDb();
  const [{total}]=await db.select({total:sql<number>`count(*)`}).from(students).where(where);
  const actualPage=Math.min(page,Math.max(1,Math.ceil(total/10)));
  const rows=await db.select().from(students).where(where).orderBy(order(columns[sort]||students.id),asc(students.id)).limit(10).offset((actualPage-1)*10);
  return reply({rows:rows.map(({updateToken,registrationToken,...s})=>({...s,registrationNumber:registrationNumber(s.id)})),total,page:actualPage});
 }catch(e){console.error(e);return fail('Gagal memuat data murid / 无法加载学生资料',500)}
}
export async function POST(req:Request){
 try {
  if(!req.headers.get('content-type')?.includes('application/json'))return fail('Format tidak valid / 格式无效',415);
  const body=await req.json() as Record<string,unknown>;
  const me=await current(req); if(!me)return fail('Silakan masuk / 请登录',401);
  if(!['supervisor','admin'].includes(me.role))return fail('Akses ditolak / 无访问权限',403);
  if(req.headers.get('origin')&&req.headers.get('origin')!==new URL(req.url).origin)return fail('Permintaan ditolak / 请求被拒绝',403);
  const db=getDb();
  if(!Number.isInteger(body.id)||!Number.isInteger(body.revision))return fail('Data tidak valid / 数据无效');
  const [old]=await db.select().from(students).where(eq(students.id,Number(body.id))); if(!old)return fail('Murid tidak ditemukan / 未找到学生',404);
  if(old.revision!==body.revision)return fail('Data telah berubah. Muat ulang sebelum mengedit. / 资料已更改，请刷新后编辑。',409);
  const changes:Partial<typeof students.$inferInsert>={};
  for(const [key] of studentFields){
   if(typeof body[key]!=='string')return fail('Lengkapi data murid / 请填写学生资料');
   const value=(body[key] as string).trim(), max=key==='notes'?20000:key==='address'?2000:200;
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
  const audits=studentFields.filter(([key])=>key in changes).map(([key,label])=>db.insert(editHistory).select(
   db.select({id:sql<number>`NULL`.as('id'),editedAt:sql<string>`${editedAt}`.as('edited_at'),userId:sql<string>`${me.id}`.as('user_id'),username:sql<string>`${me.username}`.as('username'),page:sql<string>`'Data murid / 学生资料'`.as('page'),recordId:sql<string>`${registrationNumber(old.id)}`.as('record_id'),field:sql<string>`${label}`.as('field'),fromValue:sql<string>`${old[key]}`.as('from_value'),toValue:sql<string>`${changes[key]}`.as('to_value')}).from(students).where(and(eq(students.id,old.id),eq(students.updateToken,token)))
  ));
  const result=await db.batch([db.update(students).set({...changes,revision:old.revision+1,updateToken:token}).where(and(eq(students.id,old.id),eq(students.revision,old.revision))).returning({id:students.id}),...audits]);
  if(!result[0].length)return fail('Data telah berubah. Muat ulang sebelum mengedit. / 资料已更改，请刷新后编辑。',409);
  return reply({ok:true});
 }catch(e){console.error(e);return fail('Gagal menyimpan murid / 无法保存学生资料',500)}
}
