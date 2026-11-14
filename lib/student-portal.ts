import {ensureRegistrationNumbers} from '@/lib/registration-numbers';
import {students,studentSessions} from '@/db/schema';
import {getDb} from '@/db';
import {eq,and,gt} from 'drizzle-orm';
import {registrationNumber,ageYears} from '@/lib/student-fields';
import { studentClassSummary } from '@/lib/student-class-summary';
export const normalizeName=(s:string)=>s.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('id');
export const normalizePhone=(s:string)=>{const d=s.replace(/\D/g,'');return d.startsWith('62')?'0'+d.slice(2):d};
export const hash=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,'0')).join('');
export const identityHash=(s:typeof students.$inferSelect)=>hash(JSON.stringify([normalizeName(s.nameId),normalizePhone(s.phone),s.birthdate,s.nik,s.loginAccessVersion,s.favCharCiphertext]));
export async function selfView(s:typeof students.$inferSelect){
 const {id,registrationToken,updateToken,nik,favCharCiphertext,active,loginStatus,failedLoginAttempts,lastFailedLoginAt,loginLockedAt,loginVersion,loginAccessVersion,...data}=s;
 const [classSummary] = await getDb().select(studentClassSummary).from(students).where(eq(students.id, id));
 return {...data,...classSummary,registrationNumber:registrationNumber(s),age:ageYears(s.birthdate),canFillNik:!nik,nikMasked:nik?'•••• •••• •••• '+nik.slice(-4):''};
}
export async function studentIdentity(req:Request){
 const db=getDb();await ensureRegistrationNumbers(db);
 const token=req.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith('xz_student_session='))?.slice(19);
 if(!token)return null;
 const [session]=await db.select().from(studentSessions).where(and(eq(studentSessions.tokenHash,await hash(token)),gt(studentSessions.expiresAt,Date.now())));
 if(!session)return null;
 const [student]=await db.select().from(students).where(eq(students.id,session.studentId));
 if(!student||!student.active||student.loginStatus!=='active'||session.identityHash!==await identityHash(student))return null;
 return {student,session};
}
