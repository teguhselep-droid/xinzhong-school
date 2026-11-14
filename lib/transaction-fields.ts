export const canAccessTransactions = (role: string) => ['supervisor', 'admin', 'accounting'].includes(role);
export const transactionPageSize = 10;
export const maxPaymentPhoto = 1_000_000;
export const maxPurchaseItems = 30;
export const transactionLabels = {
  tuition: { entry: 'Pembayaran kursus / 学费缴纳', history: 'Riwayat pembayaran kursus / 学费记录' },
  purchase: { entry: 'Pembayaran pembelian / 商品付款', history: 'Riwayat pembelian / 商品付款记录' },
  expense: { entry: 'Pengeluaran sekolah / 学校支出', history: 'Riwayat pengeluaran / 支出记录' },
};
export type PaymentKind = keyof typeof transactionLabels;
export const expenseCategories = [
  ['payroll-expenses', 'Gaji / 工资'], ['purchase-expenses', 'Pembelian / 采购'],
  ['office-expenses', 'Kantor / 办公'], ['other-expenses', 'Lain / 其他'],
] as const;
export type PaymentBank = { id: string; name: string };
export type PaymentStudent = { id: number; number: string; name: string };
export type PaymentClass = { id: string; code: string; name: string };
export type PayableDay = { id: string; code: string; date: string; paid: boolean; onLeave: boolean };
export type TuitionMonth = { fee: number | null; paid: number; waived: number; due: number | null; skipped: boolean; days: PayableDay[] };
export const tuitionWaiverLabel = 'Penghapusan tagihan / 学费减免';
export type TuitionWaiver = {
  id: number; studentNumber: string; studentName: string; classCode: string; className: string;
  month: string; amount: number; reason: string; recordedBy: string; recordedAt: string;
};
export type PaymentProduct = { id: number; name: string; quantity: number; price: number };
export type TuitionLine = { id: string; code: string; date: string };
export type PurchaseLine = { productId: number; name: string; quantity: number; price: number; discount: number };
export type PaymentHistory = {
  id: number; kind: PaymentKind; paymentDate: string; bank: string; categoryId: string;
  studentNumber: string | null; studentName: string | null; classCode: string | null; className: string | null;
  tuitionMonth: string | null; monthlyFee: number | null;
  total: number; memo: string; detail: TuitionLine[] | PurchaseLine[];
  hasPhoto: boolean; recordedAt: string; recordedBy: string; voidedAt: string | null; voidedBy: string | null;
};
export type TuitionStatusRow = {
  studentNumber: string; studentName: string; classCode: string; className: string;
  attended: number; referenced: number; fee: number | null; paid: number; waived: number; due: number | null; skipped: boolean;
  unreferencedDays: { code: string; date: string }[];
};
export type TransactionPage<T> = { rows: T[]; total: number; page: number };
export const discountedPrice = (line: Pick<PurchaseLine, 'price' | 'discount'>) => line.price - line.discount;
export const paymentCode = (id: number) => 'PAY-' + String(id).padStart(6, '0');
export const validTuitionMonth = (month: string) => /^20\d{2}-(0[1-9]|1[0-2])$/.test(month);
