import { acceptsRequestOrigin } from '@/lib/request-origin';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '@/db';
import { schoolPayments } from '@/db/schema';
import { current } from '@/lib/server-auth';
import { ensureRegistrationNumbers } from '@/lib/registration-numbers';
import { paymentBanks, paymentClass, paymentClasses, paymentHistory, paymentProducts, paymentStudent, paymentStudentSuggestions, tuitionMonthDetails, tuitionStatus, tuitionWaiverHistory } from '@/lib/transaction-data';
import { canAccessTransactions, maxPaymentPhoto, transactionLabels, validTuitionMonth, type PaymentKind } from '@/lib/transaction-fields';
import { createPayment, PaymentError, setTuitionFee, waiveTuition } from '@/lib/transaction-write';

const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const fail = (error: string, status = 400) => reply({ error }, status);
const forbidden = 'Akses ditolak / 无访问权限';
const login = 'Silakan masuk / 请登录';
const invalid = 'Data tidak valid / 数据无效';
const missing = 'Pembayaran tidak ditemukan / 未找到付款记录';

export async function GET(req: Request) {
  try {
    const staff = await current(req);
    if (!staff) return fail(login, 401);
    if (!canAccessTransactions(staff.role)) return fail(forbidden, 403);
    const query = new URL(req.url).searchParams;
    const db = getDb();
    switch (query.get('view')) {
      case 'banks': return reply(await paymentBanks(db));
      case 'products': return reply(await paymentProducts(db, query.get('search') ?? ''));
      case 'student-suggestions': {
        const search = (query.get('search') ?? '').trim().slice(0, 100);
        if (!search) return reply([]);
        await ensureRegistrationNumbers(db);
        return reply(await paymentStudentSuggestions(db, search));
      }
      case 'student':
      case 'days': {
        const number = query.get('student') ?? '';
        if (!/^\d{7}$/.test(number)) return fail(invalid);
        await ensureRegistrationNumbers(db);
        const student = await paymentStudent(db, number);
        if (!student) return fail('Murid tidak ditemukan / 未找到学生', 404);
        if (query.get('view') === 'student') return reply({ student, classes: await paymentClasses(db, student.id) });
        const group = await paymentClass(db, student.id, query.get('class') ?? '');
        if (!group) return fail('Murid belum terdaftar di kelas ini / 学生未报名此班级', 404);
        const month = query.get('month') ?? '';
        if (!validTuitionMonth(month)) return fail(invalid);
        return reply(await tuitionMonthDetails(db, student.id, group, month));
      }
      case 'status': {
        const month = query.get('month') ?? '';
        if (!validTuitionMonth(month)) return fail(invalid);
        await ensureRegistrationNumbers(db);
        return reply(await tuitionStatus(db, month, query));
      }
      case 'history': {
        const kind = query.get('kind') ?? '';
        if (!Object.hasOwn(transactionLabels, kind)) return fail(invalid);
        return reply(await paymentHistory(db, kind as PaymentKind, query));
      }
      case 'waivers': return reply(await tuitionWaiverHistory(db, query));
      case 'photo': {
        const id = Number(query.get('id'));
        if (!Number.isSafeInteger(id) || id < 1) return fail(invalid);
        const [photo] = await db.select({ mime: schoolPayments.photoMime, data: schoolPayments.photoData })
          .from(schoolPayments).where(eq(schoolPayments.id, id));
        if (!photo?.mime || !photo.data) return fail('Foto tidak ditemukan / 未找到照片', 404);
        return new Response(Uint8Array.from(atob(photo.data), char => char.charCodeAt(0)), {
          headers: { 'Content-Type': photo.mime, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
        });
      }
      default: return fail(invalid);
    }
  } catch {
    return fail('Gagal memuat transaksi / 无法加载交易', 500);
  }
}

export async function POST(req: Request) {
  try {
    const staff = await current(req);
    if (!staff) return fail(login, 401);
    if (!canAccessTransactions(staff.role) || !acceptsRequestOrigin(req)) return fail(forbidden, 403);
    const contentType = req.headers.get('content-type') ?? '';
    const db = getDb();
    if (contentType.startsWith('multipart/form-data')) {
      if (Number(req.headers.get('content-length')) > maxPaymentPhoto + 50000) {
        return fail('Ukuran foto maksimal 1 MB / 照片大小不得超过 1 MB', 413);
      }
      let form: FormData;
      try { form = await req.formData(); } catch { return fail(invalid); }
      await ensureRegistrationNumbers(db);
      const result = await createPayment(db, form, staff.username);
      return reply({ id: result.id }, result.created ? 201 : 200);
    }
    if (!contentType.startsWith('application/json')) return fail(invalid, 415);
    const raw = await req.text();
    if (raw.length > 2000) return fail(invalid, 413);
    let body: { action?: string; id?: number } | null;
    try { body = JSON.parse(raw); } catch { return fail(invalid); }
    if (body?.action === 'set-fee') return reply(await setTuitionFee(db, body));
    if (staff.role !== 'supervisor') return fail(forbidden, 403);
    if (body?.action === 'waive-tuition') return reply(await waiveTuition(db, body, staff.username));
    if (!body || body.action !== 'void' || !Number.isSafeInteger(body.id) || Number(body.id) < 1) return fail(invalid);
    const id = Number(body.id);
    // The database posts the reversal and restores stock or tuition coverage in the same statement.
    const [voided] = await db.update(schoolPayments).set({ voidedAt: new Date().toISOString(), voidedBy: staff.username })
      .where(and(eq(schoolPayments.id, id), isNull(schoolPayments.voidedAt))).returning({ id: schoolPayments.id });
    if (voided) return reply(voided);
    const [existing] = await db.select({ id: schoolPayments.id }).from(schoolPayments).where(eq(schoolPayments.id, id));
    return existing ? reply(existing) : fail(missing, 404);
  } catch (error) {
    if (error instanceof PaymentError) return fail(error.message, error.status);
    for (let cause: unknown = error; cause instanceof Error; cause = cause.cause) {
      if (cause.message.includes('PAYMENT_BANK_INVALID')) return fail('Pilih rekening bank / 请选择银行账户');
      if (cause.message.includes('PAYMENT_DAY_ALREADY_PAID')) return fail('Ada hari kelas yang sudah dirujuk dalam pembayaran / 有课次已关联付款', 409);
      if (cause.message.includes('PAYMENT_FEE_CHANGED')) return fail('Tarif bulanan telah berubah / 月费已更改', 409);
      if (cause.message.includes('PAYMENT_EXCEEDS_DUE')) return fail('Jumlah melebihi sisa tagihan / 金额超过剩余应付金额', 409);
      if (cause.message.includes('TUITION_MONTH_ON_LEAVE')) return fail('Tagihan dilewati karena cuti / 暂停上课期间免收月费', 409);
      if (cause.message.includes('TUITION_DAY_ON_LEAVE')) return fail('Hari cuti tidak dapat dipilih / 无法选择暂停上课的课次', 409);
      if (cause.message.includes('PAYMENT_DAYS_CHANGED') || cause.message.includes('PAYMENT_ENROLLMENT_MISSING')) {
        return fail('Jadwal atau pendaftaran kelas telah berubah / 课次或报名资料已更改', 409);
      }
      if (cause.message.includes('PAYMENT_STOCK_CHANGED')) return fail('Stok atau harga barang telah berubah / 库存或商品价格已更改', 409);
      if (cause.message.includes('PAYMENT_STOCK_LIMIT')) return fail('Jumlah stok melebihi batas / 库存数量超出上限', 409);
    }
    return fail('Gagal menyimpan transaksi / 无法保存交易', 500);
  }
}
