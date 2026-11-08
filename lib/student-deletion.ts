import {sql} from 'drizzle-orm';
import {students,studentClassAssignments,studentTransactions} from '@/db/schema';
export function studentCanBeDeleted(){
 return sql`trim(${students.currentClass}) = ''
  AND (${students.lastAttendanceDate} IS NULL OR ${students.lastAttendanceDate} = '')
  AND NOT EXISTS (SELECT 1 FROM ${studentClassAssignments} WHERE ${studentClassAssignments.studentId} = ${students.id})
  AND NOT EXISTS (SELECT 1 FROM ${studentTransactions} WHERE ${studentTransactions.studentId} = ${students.id})`;
}
