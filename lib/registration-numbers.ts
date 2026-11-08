import {getDb} from '@/db';
import {students,editHistory} from '@/db/schema';
import {and,eq,isNull,asc,sql} from 'drizzle-orm';
// Data backfill stays outside schema migrations. It is safe to repeat or run concurrently.
// The migration-owned triggers allocate a number only while the field is NULL.
export async function ensureRegistrationNumbers(db:ReturnType<typeof getDb>){
 for(;;){
  const pending=await db.select({id:students.id}).from(students).where(isNull(students.registrationNumber)).orderBy(asc(students.registeredDate),asc(students.id)).limit(50);
  if(!pending.length)return;
  const operations=pending.flatMap(({id})=>{
   const token='registration-backfill:'+crypto.randomUUID(),legacy='SHHS-'+String(id).padStart(6,'0');
   const guard=and(eq(students.id,id),eq(students.updateToken,token));
   return [
    db.update(students).set({registrationNumber:null,updateToken:token}).where(and(eq(students.id,id),isNull(students.registrationNumber))),
    db.update(editHistory).set({recordId:sql`(SELECT ${students.registrationNumber} FROM ${students} WHERE ${students.id}=${id})`}).where(and(eq(editHistory.recordId,legacy),sql`EXISTS (SELECT 1 FROM ${students} WHERE ${guard})`)),
    db.insert(editHistory).select(db.select({id:sql<number>`NULL`.as('id'),editedAt:sql<string>`${new Date().toISOString()}`.as('edited_at'),userId:sql<string>`'system:registration-format'`.as('user_id'),username:sql<string>`'Sistem / 系统'`.as('username'),page:sql<string>`'Data murid / 学生资料'`.as('page'),recordId:sql<string>`${students.registrationNumber}`.as('record_id'),field:sql<string>`'No. registrasi / 注册编号'`.as('field'),fromValue:sql<string>`${legacy}`.as('from_value'),toValue:sql<string>`${students.registrationNumber}`.as('to_value')}).from(students).where(guard)),
   ];
  });
  await db.batch([operations[0],...operations.slice(1)]);
 }
}
