import {ensureRegistrationNumbers} from '@/lib/registration-numbers';
import {getDb} from '@/db';
import {students,editHistory} from '@/db/schema';
import {current} from '@/lib/server-auth';
import {registrationNumber} from '@/lib/student-fields';
import {studentCanBeDeleted} from '@/lib/student-deletion';
import {and,eq,sql} from 'drizzle-orm';
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function POST(req:Request){
 try{
  if(!req.headers.get('content-type')?.includes('application/json'))return reply({error:'Format tidak valid / 格式无效'},415);
  let body:Record<string,unknown>;try{body=await req.json() as Record<string,unknown>}catch{return reply({error:'Data tidak valid / 数据无效'},400)}
  const me=await current(req);if(!me)return reply({error:'Silakan masuk / 请登录'},401);
  if(me.role!=='supervisor')return reply({error:'Hanya supervisor dapat menghapus murid / 仅主管可删除学生'},403);
  if(req.headers.get('origin')&&req.headers.get('origin')!==new URL(req.url).origin)return reply({error:'Permintaan ditolak / 请求被拒绝'},403);
  if(!body||!Number.isInteger(body.id)||!Number.isInteger(body.revision))return reply({error:'Data tidak valid / 数据无效'},400);
  const db=getDb();await ensureRegistrationNumbers(db);
  const [old]=await db.select().from(students).where(eq(students.id,Number(body.id)));
  if(!old)return reply({error:'Murid tidak ditemukan / 未找到学生'},404);
  if(old.revision!==body.revision)return reply({error:'Data telah berubah. Muat ulang sebelum menghapus. / 资料已更改，请刷新后删除。'},409);
  const eligible=and(eq(students.id,old.id),eq(students.revision,old.revision),studentCanBeDeleted());
  // One transaction: the conditional audit insert and delete see the same references.
  // Foreign keys also prevent future class/transaction references to a deleted student.
  const results=await db.batch([
   db.insert(editHistory).select(db.select({
    id:sql<number>`NULL`.as('id'),editedAt:sql<string>`${new Date().toISOString()}`.as('edited_at'),
    userId:sql<string>`${me.id}`.as('user_id'),username:sql<string>`${me.username}`.as('username'),
    page:sql<string>`'Data murid / 学生资料'`.as('page'),recordId:sql<string>`${registrationNumber(old)}`.as('record_id'),
    field:sql<string>`'Hapus murid / 删除学生'`.as('field'),fromValue:sql<string>`${old.nameId+(old.nameZh?' / '+old.nameZh:'')}`.as('from_value'),
    toValue:sql<string>`'Dihapus / 已删除'`.as('to_value'),
   }).from(students).where(eligible)),
   db.delete(students).where(eligible).returning({id:students.id}),
  ]);
  if(!results[1].length)return reply({error:'Tidak dapat dihapus: terdapat transaksi, penugasan kelas, atau kehadiran; atau data telah berubah. / 无法删除：已有交易、分班或出勤记录，或资料已更改。'},409);
  return reply({ok:true});
 }catch(e){console.error('Student deletion failed',e);return reply({error:'Gagal menghapus murid / 无法删除学生'},500)}
}
