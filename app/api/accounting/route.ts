import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/db';
import { accountingAccounts, accountingEntries } from '@/db/schema';
import { accountLedger, chartOfAccounts, monthlyAccountingReport } from '@/lib/accounting-data';
import { canAccessAccounting, maxTransactionAmount } from '@/lib/accounting-fields';
import { current } from '@/lib/server-auth';
import { todayJakarta } from '@/lib/student-fields';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
const input = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('bank'), id: z.string().uuid(), name: z.string().trim().min(1).max(120),
  }),
  z.object({
    action: z.literal('entry'), token: z.string().uuid(), transactionDate: date,
    bankId: z.string().uuid(), categoryId: z.string().min(1).max(40),
    amount: z.number().int().min(1).max(maxTransactionAmount), notes: z.string().trim().max(2000),
  }),
]);
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const fail = (error: string, status = 400) => reply({ error }, status);
const login = 'Silakan masuk / 请登录';
const forbidden = 'Akses ditolak / 无访问权限';
const invalid = 'Data tidak valid / 数据无效';
const missing = 'Akun tidak ditemukan / 未找到账户';

export async function GET(req: Request) {
  try {
    const staff = await current(req);
    if (!staff) return fail(login, 401);
    if (!canAccessAccounting(staff.role)) return fail(forbidden, 403);
    const db = getDb();
    const query = new URL(req.url).searchParams;
    if (query.get('view') === 'monthly-report') {
      const month = query.get('month') ?? '';
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month < '1900-01' || month > todayJakarta().slice(0, 7)) {
        return fail('Bulan laporan tidak valid / 报告月份无效');
      }
      return reply(await monthlyAccountingReport(db, month));
    }
    const id = query.get('account');
    if (id === null) return reply({ accounts: await chartOfAccounts(db) });
    const from = query.get('from') || undefined;
    const to = query.get('to') || undefined;
    if ((from && !date.safeParse(from).success) || (to && !date.safeParse(to).success) || (from && to && from > to)) {
      return fail('Rentang tanggal tidak valid / 日期范围无效');
    }
    const [account] = await db.select().from(accountingAccounts).where(eq(accountingAccounts.id, id));
    if (!account) return fail(missing, 404);
    const page = Math.max(1, Math.trunc(Number(query.get('page'))) || 1);
    return reply(await accountLedger(db, account, from, to, page));
  } catch (error) {
    console.error('Accounting read failed', error);
    return fail('Gagal memuat data akuntansi / 无法加载会计资料', 500);
  }
}

export async function POST(req: Request) {
  try {
    const raw = await req.text();
    const staff = await current(req);
    if (!staff) return fail(login, 401);
    if (!canAccessAccounting(staff.role)) return fail(forbidden, 403);
    const origin = req.headers.get('origin');
    if (origin && origin !== new URL(req.url).origin) return fail(forbidden, 403);
    if (!req.headers.get('content-type')?.includes('application/json')) return fail(invalid, 415);
    if (raw.length > 16000) return fail(invalid, 413);
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return fail(invalid); }
    const parsed = input.safeParse(body);
    if (!parsed.success) return fail(invalid);
    const data = parsed.data;
    const db = getDb();

    if (data.action === 'bank') {
      const [created] = await db.insert(accountingAccounts).values({ id: data.id, name: data.name, kind: 'bank' })
        .onConflictDoNothing().returning({ id: accountingAccounts.id });
      if (created) return reply(created, 201);
      const [existing] = await db.select().from(accountingAccounts).where(eq(accountingAccounts.id, data.id));
      if (existing?.kind === 'bank' && existing.name === data.name) return reply({ id: existing.id });
      return fail('Nama akun sudah digunakan / 账户名称已存在', 409);
    }

    if (data.transactionDate > todayJakarta()) {
      return fail('Tanggal transaksi tidak boleh melewati hari ini / 交易日期不能晚于今天');
    }
    const accounts = await db.select().from(accountingAccounts)
      .where(inArray(accountingAccounts.id, [data.bankId, data.categoryId]));
    const bank = accounts.find(account => account.id === data.bankId);
    const destination = accounts.find(account => account.id === data.categoryId);
    if (bank?.kind !== 'bank' || !destination || bank.id === destination.id) {
      return fail('Pilih rekening bank dan akun tujuan yang berbeda / 请选择不同的银行账户和目标账户');
    }
    const income = destination.kind === 'income';
    const posting = {
      transactionDate: data.transactionDate, amount: data.amount, notes: data.notes,
      debitAccountId: income ? bank.id : destination.id, creditAccountId: income ? destination.id : bank.id,
    };
    const [created] = await db.insert(accountingEntries).values({
      ...posting, token: data.token, recordedAt: new Date().toISOString(), recordedBy: staff.username,
    }).onConflictDoNothing({ target: accountingEntries.token }).returning({ id: accountingEntries.id });
    if (created) return reply(created, 201);
    const [existing] = await db.select().from(accountingEntries).where(eq(accountingEntries.token, data.token));
    const fields = Object.keys(posting) as (keyof typeof posting)[];
    if (existing && fields.every(field => posting[field] === existing[field])) return reply({ id: existing.id });
    return fail('Transaksi ini sudah disimpan. Muat ulang formulir. / 此交易已保存，请刷新表单。', 409);
  } catch (error) {
    console.error('Accounting save failed', error);
    return fail('Gagal menyimpan data akuntansi / 无法保存会计资料', 500);
  }
}
