import { current } from '@/lib/server-auth';
import { getDb } from '@/db';
import { editHistory } from '@/db/schema';
import { asc, desc, sql, or, like } from 'drizzle-orm';
export async function GET(req:Request){
 const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
 try{
  const me=await current(req);if(!me)return reply({error:'Silakan masuk / 请登录'},401);
  if(me.role!=='supervisor')return reply({error:'Akses ditolak / 无访问权限'},403);
  const q=new URL(req.url).searchParams, search=(q.get('search')||'').slice(0,200), db=getDb();
  const columns={editedAt:editHistory.editedAt,username:editHistory.username,page:editHistory.page,recordId:editHistory.recordId,field:editHistory.field,fromValue:editHistory.fromValue,toValue:editHistory.toValue};
  const sort=q.get('sort') as keyof typeof columns, order=q.get('direction')==='asc'?asc:desc;
  const where=search?or(...Object.values(columns).map(c=>like(c,`%${search}%`))):undefined;
  const [{total}]=await db.select({total:sql<number>`count(*)`}).from(editHistory).where(where);
  const page=Math.max(1,Math.min(Math.ceil(total/10)||1,Number(q.get('page'))||1));
  const rows=await db.select().from(editHistory).where(where).orderBy(order(columns[sort]||editHistory.editedAt),desc(editHistory.id)).limit(10).offset((page-1)*10);
  return reply({rows,total,page});
 }catch(e){console.error(e);return reply({error:'Gagal memuat riwayat / 无法加载修改记录'},500)}
}
