import { count, desc, eq, like, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/db';
import { editHistory, inventoryCategories, inventoryProducts } from '@/db/schema';
import { current } from '@/lib/server-auth';
import { canAddInventory, categorySlots, inventoryPageSize, inventoryTitle, maxSalesPrice } from '@/lib/inventory-fields';

const input = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('category'), id: z.number().int().min(1).max(categorySlots),
    name: z.string().trim().max(80), revision: z.number().int().nonnegative(),
  }),
  z.object({
    action: z.literal('product'), token: z.string().uuid(), name: z.string().trim().min(1).max(200),
    categoryId: z.number().int().min(1).max(categorySlots),
    salesPrice: z.number().int().min(0).max(maxSalesPrice),
  }),
]);
const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const fail = (error: string, status = 400) => reply({ error }, status);
const invalid = 'Data tidak valid / 数据无效';
const forbidden = 'Akses ditolak / 无访问权限';
const login = 'Silakan masuk / 请登录';
const stale = 'Kategori telah berubah. Muat ulang sebelum menyimpan. / 分类已更改，请刷新后保存。';
const categoryInUse = 'Kategori yang digunakan produk tidak dapat dikosongkan / 已有商品使用的分类不能清空';

export async function GET(req: Request) {
  try {
    const staff = await current(req);
    if (!staff) return fail(login, 401);
    const db = getDb();
    const query = new URL(req.url).searchParams;
    const search = (query.get('search') ?? '').trim().slice(0, 150);
    const match = '%' + search + '%';
    const where = search ? or(like(inventoryProducts.name, match), like(inventoryCategories.name, match),
      like(sql`cast(${inventoryProducts.id} as text)`, match)) : undefined;
    const [totals, storedCategories] = await Promise.all([
      db.select({ total: count() }).from(inventoryProducts)
        .innerJoin(inventoryCategories, eq(inventoryCategories.id, inventoryProducts.categoryId)).where(where),
      canAddInventory(staff.role) ? db.select({
        id: inventoryCategories.id, name: inventoryCategories.name, revision: inventoryCategories.revision,
      }).from(inventoryCategories).orderBy(inventoryCategories.id) : [],
    ]);
    const total = totals[0].total;
    const requested = Math.max(1, Math.trunc(Number(query.get('page'))) || 1);
    const page = Math.min(requested, Math.max(1, Math.ceil(total / inventoryPageSize)));
    const rows = await db.select({
      id: inventoryProducts.id, name: inventoryProducts.name, categoryId: inventoryProducts.categoryId,
      category: inventoryCategories.name, salesPrice: inventoryProducts.salesPrice, quantity: inventoryProducts.quantity,
      createdAt: inventoryProducts.createdAt, recordedBy: inventoryProducts.recordedBy,
    }).from(inventoryProducts).innerJoin(inventoryCategories, eq(inventoryCategories.id, inventoryProducts.categoryId))
      .where(where).orderBy(desc(inventoryProducts.id)).limit(inventoryPageSize).offset((page - 1) * inventoryPageSize);
    const categories = staff.role === 'supervisor'
      ? Array.from({ length: categorySlots }, (_, i) =>
          storedCategories.find(category => category.id === i + 1) ?? { id: i + 1, name: '', revision: 0 })
      : storedCategories.filter(category => category.name);
    return reply({ rows, total, page, categories });
  } catch (error) {
    console.error('Inventory list failed', error);
    return fail('Gagal memuat inventaris / 无法加载库存', 500);
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

    if (data.action === 'product') {
      // Validate the category in the same statement that creates the product.
      const [created] = await db.all<{ id: number }>(sql`
        insert into inventory_products (name, category_id, sales_price, quantity, created_at, recorded_by, creation_token)
        select ${data.name}, id, ${data.salesPrice}, 0, ${new Date().toISOString()}, ${staff.username}, ${data.token}
        from inventory_categories where id = ${data.categoryId} and name <> ''
        on conflict (creation_token) do nothing returning id
      `);
      if (created) return reply(created, 201);
      const [existing] = await db.select({ id: inventoryProducts.id }).from(inventoryProducts)
        .where(eq(inventoryProducts.creationToken, data.token));
      return existing ? reply(existing) : fail('Pilih kategori yang sudah diberi nama / 请选择已命名的分类');
    }

    if (staff.role !== 'supervisor') return fail(forbidden, 403);
    const [previous] = await db.select().from(inventoryCategories).where(eq(inventoryCategories.id, data.id));
    if ((previous?.revision ?? 0) !== data.revision) return fail(stale, 409);
    if ((previous?.name ?? '') === data.name) return reply({ id: data.id, name: data.name, revision: data.revision });
    const token = crypto.randomUUID();
    const unused = sql`not exists (select 1 from inventory_products where category_id = ${data.id})`;
    const change = db.insert(inventoryCategories).values({ id: data.id, name: data.name, updateToken: token })
      .onConflictDoUpdate({
        target: inventoryCategories.id,
        set: { name: data.name, updateToken: token, revision: sql`${inventoryCategories.revision} + 1` },
        setWhere: sql`${inventoryCategories.revision} = ${data.revision} ${data.name ? sql.empty() : sql`and ${unused}`}`,
      }).returning({ id: inventoryCategories.id, name: inventoryCategories.name, revision: inventoryCategories.revision });
    const history = db.insert(editHistory).select(db.select({
      id: sql<number>`NULL`.as('id'),
      editedAt: sql<string>`${new Date().toISOString()}`.as('edited_at'),
      userId: sql<string>`${staff.id}`.as('user_id'),
      username: sql<string>`${staff.username}`.as('username'),
      page: sql<string>`${inventoryTitle}`.as('page'),
      recordId: sql<string>`${'Kategori / 分类 #' + data.id}`.as('record_id'),
      field: sql<string>`'Nama kategori / 分类名称'`.as('field'),
      fromValue: sql<string>`${previous?.name ?? ''}`.as('from_value'),
      toValue: sql<string>`${data.name}`.as('to_value'),
    }).from(inventoryCategories).where(eq(inventoryCategories.updateToken, token)));
    const [rows] = await db.batch([change, history]);
    if (rows.length) return reply(rows[0]);
    if (!data.name) {
      const [product] = await db.select({ id: inventoryProducts.id }).from(inventoryProducts)
        .where(eq(inventoryProducts.categoryId, data.id)).limit(1);
      if (product) return fail(categoryInUse, 409);
    }
    return fail(stale, 409);
  } catch (error) {
    console.error('Inventory save failed', error);
    return fail('Gagal menyimpan inventaris / 无法保存库存资料', 500);
  }
}
