import { asc, count, desc, eq, like, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/db';
import { accountingAccounts, inventoryMovements, inventoryProducts } from '@/db/schema';
import { maxTransactionAmount } from '@/lib/accounting-fields';
import { canAddInventory, inventoryPageSize, maxInventoryQuantity } from '@/lib/inventory-fields';
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

    const [{ total }] = await db.select({ total: count() }).from(inventoryMovements);
    const requested = Math.max(1, Math.trunc(Number(query.get('page'))) || 1);
    const page = Math.min(requested, Math.max(1, Math.ceil(total / inventoryPageSize)));
    const rows = await db.select({
      id: inventoryMovements.id, direction: inventoryMovements.direction, productId: inventoryMovements.productId,
      product: inventoryProducts.name, quantity: inventoryMovements.quantity, payment: inventoryMovements.payment,
      bank: accountingAccounts.name, recordedAt: inventoryMovements.recordedAt, recordedBy: inventoryMovements.recordedBy,
    }).from(inventoryMovements)
      .innerJoin(inventoryProducts, eq(inventoryProducts.id, inventoryMovements.productId))
      .innerJoin(accountingAccounts, eq(accountingAccounts.id, inventoryMovements.bankId))
      .orderBy(desc(inventoryMovements.id)).limit(inventoryPageSize).offset((page - 1) * inventoryPageSize);
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
