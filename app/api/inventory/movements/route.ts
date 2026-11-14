import { asc, eq, like, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/db';
import { accountingAccounts, inventoryMovements, inventoryProducts } from '@/db/schema';
import { maxTransactionAmount } from '@/lib/accounting-fields';
import { canAddInventory, inventoryPageSize, maxInventoryQuantity, type InventoryMovement } from '@/lib/inventory-fields';
import { current } from '@/lib/server-auth';

const input = z.object({
  token: z.string().uuid(),
  direction: z.enum(['in', 'out']),
  productId: z.number().int().positive(),
  quantity: z.number().int().min(1).max(maxInventoryQuantity),
  payment: z.number().int().min(1).max(maxTransactionAmount),
  bankId: z.string().uuid(),
});
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const fail = (error: string, status = 400) => reply({ error }, status);
const login = 'Silakan masuk / 请登录';
const forbidden = 'Akses ditolak / 无访问权限';
const invalid = 'Data tidak valid / 数据无效';

export async function GET(req: Request) {
  try {
    const staff = await current(req);
    if (!staff) return fail(login, 401);
    if (!canAddInventory(staff.role)) return fail(forbidden, 403);
    const db = getDb();
    const query = new URL(req.url).searchParams;
    if (query.get('view') === 'options') {
      const search = (query.get('search') ?? '').trim().slice(0, 150);
      const match = '%' + search + '%';
      const [products, banks] = await Promise.all([
        db.select({ id: inventoryProducts.id, name: inventoryProducts.name })
          .from(inventoryProducts).where(search ? or(
            like(inventoryProducts.name, match), like(sql`cast(${inventoryProducts.id} as text)`, match),
          ) : undefined).orderBy(asc(inventoryProducts.name), asc(inventoryProducts.id)).limit(30),
        db.select({ id: accountingAccounts.id, name: accountingAccounts.name }).from(accountingAccounts)
          .where(eq(accountingAccounts.kind, 'bank')).orderBy(asc(accountingAccounts.name)),
      ]);
      return reply({ products, banks });
    }

    // Purchases already post stock and accounting changes. Read their receipt lines into history.
    const history = sql`
      with purchase_items as (
        select p.id, p.bank_id, p.recorded_at, p.recorded_by, p.voided_at, p.voided_by,
          json_extract(line.value, '$.productId') as productId, json_extract(line.value, '$.name') as product,
          json_extract(line.value, '$.quantity') as quantity,
          (json_extract(line.value, '$.price') - json_extract(line.value, '$.discount'))
            * json_extract(line.value, '$.quantity') as payment
        from school_payments p, json_each(p.detail) line
        where p.kind = 'purchase'
      ), movements as (
        select m.id, m.direction, m.product_id as productId, p.name as product, m.quantity, m.payment,
          m.bank_id, m.recorded_at as recordedAt, m.recorded_by as recordedBy, null as purchaseId
        from inventory_movements m join inventory_products p on p.id = m.product_id
        union all
        select id, 'out', productId, product, quantity, payment, bank_id, recorded_at, recorded_by, id
        from purchase_items
        union all
        select id, 'in', productId, product, quantity, -payment, bank_id, voided_at, voided_by, id
        from purchase_items where voided_at is not null
      )
    `;
    const [{ total }] = await db.all<{ total: number }>(sql`${history} select count(*) as total from movements`);
    const requested = Math.max(1, Math.trunc(Number(query.get('page'))) || 1);
    const page = Math.min(requested, Math.max(1, Math.ceil(total / inventoryPageSize)));
    const rows = await db.all<InventoryMovement>(sql`
      ${history}
      select m.id, m.direction, m.productId, m.product, m.quantity, m.payment,
        a.name as bank, m.recordedAt, m.recordedBy, m.purchaseId
      from movements m join accounting_accounts a on a.id = m.bank_id
      order by m.recordedAt desc, m.purchaseId is not null desc, m.id desc, m.direction, m.productId
      limit ${inventoryPageSize} offset ${(page - 1) * inventoryPageSize}
    `);
    return reply({ rows, total, page });
  } catch (error) {
    console.error('Inventory movements read failed', error);
    return fail('Gagal memuat catatan I/O / 无法加载出入库记录', 500);
  }
}

export async function POST(req: Request) {
  try {
    const raw = await req.text();
    const staff = await current(req);
    if (!staff) return fail(login, 401);
    if (!canAddInventory(staff.role)) return fail(forbidden, 403);
    const origin = req.headers.get('origin');
    if (origin && origin !== new URL(req.url).origin) return fail(forbidden, 403);
    if (!req.headers.get('content-type')?.includes('application/json')) return fail(invalid, 415);
    if (raw.length > 5000) return fail(invalid, 413);
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return fail(invalid); }
    const parsed = input.safeParse(body);
    if (!parsed.success) return fail(invalid);
    const data = parsed.data;
    const db = getDb();

    // The insert trigger posts the stock change and balanced journal entry atomically.
    const [created] = await db.insert(inventoryMovements).values({
      ...data, recordedAt: new Date().toISOString(), recordedBy: staff.username,
    }).onConflictDoNothing({ target: inventoryMovements.token }).returning({ id: inventoryMovements.id });
    if (created) return reply(created, 201);
    const [existing] = await db.select().from(inventoryMovements).where(eq(inventoryMovements.token, data.token));
    const fields = Object.keys(data) as (keyof typeof data)[];
    if (existing && fields.every(field => data[field] === existing[field])) return reply({ id: existing.id });
    return fail('Catatan ini sudah disimpan. Muat ulang formulir. / 此记录已保存，请刷新表单。', 409);
  } catch (error) {
    for (let cause: unknown = error; cause instanceof Error; cause = cause.cause) {
      if (cause.message.includes('INVENTORY_INSUFFICIENT_STOCK')) return fail('Stok tidak mencukupi / 库存不足', 409);
      if (cause.message.includes('INVENTORY_STOCK_LIMIT')) return fail('Jumlah stok melebihi batas / 库存数量超出上限', 409);
      if (cause.message.includes('INVENTORY_PRODUCT_MISSING')) return fail('Barang tidak ditemukan / 未找到商品', 404);
      if (cause.message.includes('INVENTORY_BANK_INVALID')) return fail('Pilih rekening bank / 请选择银行账户');
    }
    console.error('Inventory movement save failed', error);
    return fail('Gagal menyimpan catatan I/O / 无法保存出入库记录', 500);
  }
}
