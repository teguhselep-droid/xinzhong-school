import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/db';
import { inventoryProducts, schoolPayments, tuitionBills, tuitionWaivers } from '@/db/schema';
import { maxTransactionAmount } from '@/lib/accounting-fields';
import { maxInventoryQuantity } from '@/lib/inventory-fields';
import { todayJakarta } from '@/lib/student-fields';
import { paymentClass, paymentStudent, tuitionMonthDetails } from '@/lib/transaction-data';
import { discountedPrice, expenseCategories, maxPaymentPhoto, maxPurchaseItems, validTuitionMonth, type PurchaseLine, type TuitionLine } from '@/lib/transaction-fields';

const positiveMoney = z.number().int().min(1).max(maxTransactionAmount);
const studentNumber = z.string().regex(/^\d{7}$/);
const tuitionFields = {
  studentNumber, classCode: z.string().regex(/^\d{6}$/), month: z.string().refine(validTuitionMonth), monthlyFee: positiveMoney,
};
const common = {
  token: z.string().uuid(), bankId: z.string().uuid(),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }),
};
const input = z.discriminatedUnion('kind', [
  z.object({ ...common, kind: z.literal('tuition'), ...tuitionFields,
    amount: positiveMoney, days: z.array(z.object({
      id: z.string().min(1).max(40), code: z.string().regex(/^\d{8}$/), date: z.string().length(10),
    })).max(99) }),
  z.object({ ...common, kind: z.literal('purchase'), studentNumber,
    items: z.array(z.object({ productId: z.number().int().positive(), quantity: z.number().int().min(1).max(maxInventoryQuantity),
      discount: z.number().int().min(0).max(maxTransactionAmount) })).min(1).max(maxPurchaseItems) }),
  z.object({ ...common, kind: z.literal('expense'), categoryId: z.string().refine(value => expenseCategories.some(([id]) => id === value)),
    amount: positiveMoney, notes: z.string().trim().min(1).max(2000) }),
]);

export class PaymentError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
const invalid = 'Data pembayaran tidak valid / 付款资料无效';
const stale = 'Data telah berubah. Muat ulang formulir. / 资料已更改，请刷新表单。';
const noDays = 'Tidak ada jadwal untuk bulan ini / 此月暂无课次';
const feeChanged = 'Tarif bulanan telah ditetapkan dengan jumlah berbeda / 已设定不同的月费';
const monthOnLeave = 'Tagihan dilewati karena cuti / 暂停上课期间免收月费';
const exceedsDue = 'Jumlah melebihi sisa tagihan / 金额超过剩余应付金额';

export async function setTuitionFee(db: ReturnType<typeof getDb>, body: unknown) {
  const parsed = z.object(tuitionFields).safeParse(body);
  if (!parsed.success) throw new PaymentError(invalid);
  const data = parsed.data;
  const student = await paymentStudent(db, data.studentNumber);
  if (!student) throw new PaymentError('Murid tidak ditemukan / 未找到学生', 404);
  const group = await paymentClass(db, student.id, data.classCode);
  if (!group) throw new PaymentError('Murid belum terdaftar di kelas ini / 学生未报名此班级', 404);
  const details = await tuitionMonthDetails(db, student.id, group, data.month);
  if (details.skipped) throw new PaymentError(monthOnLeave, 409);
  if (!details.days.length && details.fee === null) throw new PaymentError(noDays, 409);
  await db.insert(tuitionBills).values({
    studentId: student.id, classId: group.id, month: data.month, fee: data.monthlyFee,
  }).onConflictDoNothing();
  const saved = await tuitionMonthDetails(db, student.id, group, data.month);
  if (saved.fee !== data.monthlyFee) throw new PaymentError(feeChanged, 409);
  return saved;
}

export async function waiveTuition(db: ReturnType<typeof getDb>, body: unknown, username: string) {
  const { studentNumber, classCode, month } = tuitionFields;
  const parsed = z.object({ studentNumber, classCode, month, token: z.string().uuid(),
    amount: positiveMoney, reason: z.string().trim().min(1).max(300) }).safeParse(body);
  if (!parsed.success) throw new PaymentError(invalid);
  const data = parsed.data;
  const student = await paymentStudent(db, data.studentNumber);
  const group = student && await paymentClass(db, student.id, data.classCode);
  if (!student || !group) throw new PaymentError('Murid belum terdaftar di kelas ini / 学生未报名此班级', 404);
  const [inserted] = await db.insert(tuitionWaivers).values({
    token: data.token, studentId: student.id, classId: group.id, month: data.month,
    amount: data.amount, reason: data.reason, recordedAt: new Date().toISOString(), recordedBy: username,
  }).onConflictDoNothing({ target: tuitionWaivers.token }).returning({ id: tuitionWaivers.id });
  if (!inserted) {
    const [existing] = await db.select().from(tuitionWaivers).where(eq(tuitionWaivers.token, data.token));
    if (!existing || existing.studentId !== student.id || existing.classId !== group.id || existing.month !== data.month ||
      existing.amount !== data.amount || existing.reason !== data.reason) throw new PaymentError(stale, 409);
  }
  return tuitionMonthDetails(db, student.id, group, data.month);
}

async function readPhoto(value: FormDataEntryValue | null) {
  if (!value || typeof value === 'string' || !value.size) return null;
  if (value.size > maxPaymentPhoto) throw new PaymentError('Ukuran foto maksimal 1 MB / 照片大小不得超过 1 MB', 413);
  const bytes = new Uint8Array(await value.arrayBuffer());
  const starts = (signature: number[], offset = 0) => signature.every((byte, index) => bytes[offset + index] === byte);
  const mime = starts([0xff, 0xd8, 0xff]) ? 'image/jpeg'
    : starts([137, 80, 78, 71, 13, 10, 26, 10]) ? 'image/png'
    : starts([82, 73, 70, 70]) && starts([87, 69, 66, 80], 8) ? 'image/webp'
    : null;
  if (!mime) throw new PaymentError('Gunakan foto JPG, PNG, atau WebP / 请使用 JPG、PNG 或 WebP 照片');
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return { mime, data: btoa(binary) };
}

export async function createPayment(db: ReturnType<typeof getDb>, form: FormData, username: string) {
  const raw = form.get('payment');
  if (typeof raw !== 'string' || raw.length > 30000) throw new PaymentError(invalid);
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { throw new PaymentError(invalid); }
  const parsed = input.safeParse(payload);
  if (!parsed.success) throw new PaymentError(invalid);
  const data = parsed.data;
  if (data.paymentDate > todayJakarta()) throw new PaymentError('Tanggal pembayaran tidak boleh melewati hari ini / 付款日期不能晚于今天');
  const photo = await readPhoto(form.get('photo'));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([data, photo]))));
  const requestHash = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
  async function findSaved() {
    const [existing] = await db.select({ id: schoolPayments.id, hash: schoolPayments.requestHash })
      .from(schoolPayments).where(eq(schoolPayments.token, data.token));
    if (existing && existing.hash !== requestHash) throw new PaymentError(stale, 409);
    return existing ? { id: existing.id, created: false } : null;
  }
  const existing = await findSaved();
  if (existing) return existing;

  const receipt: typeof schoolPayments.$inferInsert = {
    kind: data.kind, token: data.token, requestHash, paymentDate: data.paymentDate, bankId: data.bankId,
    categoryId: '', memo: '', total: 0, recordedAt: new Date().toISOString(), recordedBy: username,
    photoMime: photo?.mime, photoData: photo?.data,
  };
  if (data.kind !== 'expense') {
    const student = await paymentStudent(db, data.studentNumber);
    if (!student) throw new PaymentError('Murid tidak ditemukan / 未找到学生', 404);
    receipt.studentId = student.id;
    receipt.studentTransactionId = 'school-payment:' + data.token;
    receipt.studentNumber = student.number;
    receipt.studentName = student.name;
    if (data.kind === 'tuition') {
      const group = await paymentClass(db, student.id, data.classCode);
      if (!group) throw new PaymentError('Murid belum terdaftar di kelas ini / 学生未报名此班级', 404);
      const bill = await tuitionMonthDetails(db, student.id, group, data.month);
      if (bill.skipped) throw new PaymentError(monthOnLeave, 409);
      if (!bill.days.length && bill.fee === null) throw new PaymentError(noDays, 409);
      if (bill.fee !== null && bill.fee !== data.monthlyFee) throw new PaymentError(feeChanged, 409);
      if (data.amount > (bill.due ?? data.monthlyFee)) throw new PaymentError(exceedsDue, 409);
      const selected = new Map(data.days.map(day => [day.id, day]));
      const days = bill.days.filter(day => selected.has(day.id));
      if (days.length !== data.days.length || days.some(day => {
        const original = selected.get(day.id);
        return original?.code !== day.code || original?.date !== day.date;
      })) throw new PaymentError(stale, 409);
      if (days.some(day => day.paid)) throw new PaymentError('Ada hari kelas yang sudah dirujuk dalam pembayaran / 有课次已关联付款', 409);
      if (days.some(day => day.onLeave)) throw new PaymentError('Hari cuti tidak dapat dipilih / 无法选择暂停上课的课次', 409);
      const detail: TuitionLine[] = days.map(({ id, code, date }) => ({ id, code, date }));
      receipt.classId = group.id;
      receipt.classCode = group.code;
      receipt.className = group.name;
      receipt.tuitionMonth = data.month;
      receipt.monthlyFee = data.monthlyFee;
      receipt.categoryId = 'tuition-income';
      receipt.memo = student.number + ' / ' + group.code;
      receipt.total = data.amount;
      receipt.detail = JSON.stringify(detail);
    } else {
      const ids = [...new Set(data.items.map(item => item.productId))];
      if (ids.length !== data.items.length) throw new PaymentError('Barang hanya dapat dipilih sekali / 每种商品只能选择一次');
      const products = await db.select({
        id: inventoryProducts.id, name: inventoryProducts.name, price: inventoryProducts.salesPrice, quantity: inventoryProducts.quantity,
      }).from(inventoryProducts).where(inArray(inventoryProducts.id, ids));
      const detail: PurchaseLine[] = data.items.map(item => {
        const product = products.find(row => row.id === item.productId);
        if (!product) throw new PaymentError('Barang tidak ditemukan / 未找到商品', 404);
        if (item.quantity > product.quantity) throw new PaymentError('Stok tidak mencukupi / 库存不足', 409);
        if (item.discount > product.price) throw new PaymentError('Diskon melebihi harga barang / 折扣超过商品价格');
        return { ...item, name: product.name, price: product.price };
      });
      receipt.categoryId = 'other-income';
      receipt.memo = student.number + ' / purchase';
      receipt.total = detail.reduce((sum, row) => sum + discountedPrice(row) * row.quantity, 0);
      receipt.detail = JSON.stringify(detail);
    }
  } else {
    receipt.categoryId = data.categoryId;
    receipt.total = data.amount;
    receipt.memo = data.notes;
  }
  if (!Number.isSafeInteger(receipt.total) || receipt.total < 1 || receipt.total > maxTransactionAmount) {
    throw new PaymentError('Total pembayaran tidak valid / 付款总额无效');
  }
  const [inserted] = await db.insert(schoolPayments).values(receipt)
    .onConflictDoNothing({ target: schoolPayments.token }).returning({ id: schoolPayments.id });
  if (inserted) return { id: inserted.id, created: true };
  const retried = await findSaved();
  if (!retried) throw new PaymentError(stale, 409);
  return retried;
}
