"use client";

import { useRef, useState, type FormEvent, type RefObject } from 'react';
import { X } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from '@/components/ui/combobox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { paymentDay, paymentMoney, transactionEndpoint, transactionRequest, useTransactionData } from '@/components/transaction-request';
import { maxTransactionAmount } from '@/lib/accounting-fields';
import { classLeaveLabel } from '@/lib/class-fields';
import { maxInventoryQuantity } from '@/lib/inventory-fields';
import { todayJakarta } from '@/lib/student-fields';
import {
  discountedPrice, expenseCategories, maxPaymentPhoto, maxPurchaseItems, transactionLabels, tuitionWaiverLabel, validTuitionMonth,
  type PayableDay, type PaymentBank, type PaymentClass, type PaymentKind, type PaymentProduct, type PaymentStudent, type TuitionMonth,
} from '@/lib/transaction-fields';

type Item = { product: PaymentProduct; quantity: string; discount: string };
const purchaseUnitPrice = (item: Item) => Math.max(0, discountedPrice({
  price: item.product.price, discount: Number(item.discount),
}));

function PurchaseItems({ items, setItems, open, setOpen, dialogRef }: {
  items: Item[]; setItems: (items: Item[]) => void; open: boolean; setOpen: (open: boolean) => void;
  dialogRef: RefObject<HTMLDivElement | null>;
}) {
  const [search, setSearch] = useState('');
  const lookup = useTransactionData<PaymentProduct[]>(open ? { view: 'products', search } : null);
  const available = (lookup.data ?? []).filter(product => !items.some(item => item.product.id === product.id));
  function updateItem(item: Item, change: Partial<Pick<Item, 'quantity' | 'discount'>>) {
    setItems(items.map(row => row === item ? { ...row, ...change } : row));
  }
  return <FieldGroup>
    <Table>
      <TableHeader><TableRow>
        <TableHead scope="col">Nama barang / 商品名称</TableHead>
        <TableHead scope="col" className="w-24">Qty / 数量</TableHead>
        <TableHead scope="col">Harga satuan / 单价</TableHead>
        <TableHead scope="col">Diskon per unit (Rp) / 单件折扣（印尼盾）</TableHead>
        <TableHead scope="col">Harga setelah diskon / 折后单价</TableHead>
        <TableHead scope="col">Subtotal / 小计</TableHead>
      </TableRow></TableHeader>
      <TableBody>
        {items.map(item => <TableRow key={item.product.id}>
          <TableCell><div className="flex min-w-32 items-center gap-2 whitespace-normal">
            <Button type="button" variant="ghost" size="icon-sm"
              aria-label={'Hapus ' + item.product.name + ' / 移除'}
              onClick={() => setItems(items.filter(row => row !== item))}><X /></Button>
            {item.product.name}
          </div></TableCell>
          <TableCell><Input type="number" className="min-w-16" required min={1}
            max={Math.min(item.product.quantity, maxInventoryQuantity)} value={item.quantity}
            aria-label={'Qty ' + item.product.name + ' / 数量'}
            onChange={event => updateItem(item, { quantity: event.target.value })} /></TableCell>
          <TableCell>{paymentMoney(item.product.price)}</TableCell>
          <TableCell><Input type="number" className="min-w-24" min={0} step={1} max={item.product.price}
            aria-label={'Diskon per unit ' + item.product.name + ' (Rp) / 单件折扣（印尼盾）'}
            value={item.discount} placeholder="0" onChange={event => updateItem(item, { discount: event.target.value })} /></TableCell>
          <TableCell>{paymentMoney(purchaseUnitPrice(item))}</TableCell>
          <TableCell>{paymentMoney(purchaseUnitPrice(item) * Number(item.quantity))}</TableCell>
        </TableRow>)}
        {items.length < maxPurchaseItems && <TableRow>
          <TableCell colSpan={6}>
            <Combobox<number> open={open} onOpenChange={setOpen} value={null}
              inputValue={search} onInputValueChange={(value, details) => {
                if (details.reason !== 'input-change') return;
                setSearch(value);
                setOpen(true);
              }}
              items={available.map(product => product.id)} filter={null} onValueChange={id => {
                const product = available.find(row => row.id === id);
                if (!product || product.quantity < 1) return;
                setItems([...items, { product, quantity: '1', discount: '' }]);
                setSearch('');
              }}>
              <ComboboxInput aria-label="Nama barang / 商品名称" autoComplete="off" maxLength={40}
                placeholder="Cari barang / 搜索商品" />
              <ComboboxContent container={dialogRef}>
                <ComboboxEmpty>{lookup.loading ? 'Memuat / 加载中…' :
                  lookup.error || 'Barang tidak ditemukan / 未找到商品'}</ComboboxEmpty>
                <ComboboxList>
                  {available.map(product => <ComboboxItem key={product.id} value={product.id} disabled={product.quantity < 1}>
                    {product.name}{product.quantity < 1 && ' · Stok habis / 缺货'}
                  </ComboboxItem>)}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          </TableCell>
        </TableRow>}
      </TableBody>
    </Table>
    <p className="text-right font-medium">Total pembayaran / 付款总额 · {paymentMoney(items.reduce((sum, item) =>
      sum + purchaseUnitPrice(item) * Number(item.quantity), 0))}</p>
  </FieldGroup>;
}

export default function TransactionForm({ kind, supervisor, close, saved }: {
  kind: PaymentKind; supervisor: boolean; close: () => void; saved: (id: number) => void;
}) {
  const [token] = useState(() => crypto.randomUUID());
  const [number, setNumber] = useState('');
  const [studentListOpen, setStudentListOpen] = useState(false);
  const [productListOpen, setProductListOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [classCode, setClassCode] = useState('');
  const [bill, setBill] = useState<TuitionMonth | null>(null);
  const days = bill?.days ?? null;
  const [selected, setSelected] = useState<PayableDay[]>([]);
  const [tuitionAmount, setTuitionAmount] = useState('');
  const [monthlyFee, setMonthlyFee] = useState('');
  const [waiverToken, setWaiverToken] = useState<string | null>(null);
  const [month, setMonth] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const banks = useTransactionData<PaymentBank[]>({ view: 'banks' });
  const search = number.trim();
  const suggestions = useTransactionData<Pick<PaymentStudent, 'number' | 'name'>[]>(
    kind === 'tuition' && studentListOpen && search ? { view: 'student-suggestions', search } : null,
  );
  const lookup = useTransactionData<{ student: PaymentStudent; classes: PaymentClass[] }>(
    kind !== 'expense' && /^\d{7}$/.test(number) ? { view: 'student', student: number } : null,
  );
  const group = lookup.data?.classes.find(row => row.code === classCode);
  const today = todayJakarta();

  function changeStudent(value: string) {
    if (number === value) return;
    setNumber(value);
    setClassCode('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      if (kind === 'tuition' && !days) {
        const billingMonth = String(fields.get('month') ?? '');
        if (!validTuitionMonth(billingMonth)) throw new Error('Pilih bulan kursus / 请选择学费月份');
        const query = new URLSearchParams({ view: 'days', student: number, class: classCode, month: billingMonth });
        const result = await transactionRequest<TuitionMonth>(transactionEndpoint + '?' + query);
        setMonth(billingMonth);
        setBill(result);
        setMonthlyFee(result.fee === null ? '' : String(result.fee));
        setTuitionAmount('');
        setSelected([]);
        return;
      }
      if (waiverToken) {
        const updated = await transactionRequest<TuitionMonth>(transactionEndpoint, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'waive-tuition', token: waiverToken, studentNumber: number, classCode, month,
            amount: Number(fields.get('waiverAmount')), reason: fields.get('waiverReason') }),
        });
        setBill(updated);
        setSelected(current => current.filter(item => updated.days.some(day => day.id === item.id && !day.paid && !day.onLeave)));
        setWaiverToken(null);
        return;
      }
      const photo = fields.get('photo');
      if (photo instanceof File && photo.size > maxPaymentPhoto) {
        throw new Error('Ukuran foto maksimal 1 MB / 照片大小不得超过 1 MB');
      }
      if (kind === 'tuition' && (!fields.get('bank') || !fields.get('date'))) {
        throw new Error('Pilih rekening dan tanggal pembayaran / 请选择账户和付款日期');
      }
      const base = { token, kind, bankId: fields.get('bank'), paymentDate: fields.get('date'), studentNumber: number };
      const payment = kind === 'tuition'
        ? { ...base, classCode, month, monthlyFee: Number(monthlyFee), amount: Number(tuitionAmount),
          days: selected.map(({ id, code, date }) => ({ id, code, date })) }
        : kind === 'purchase' ? { ...base, items: items.map(item => ({
          productId: item.product.id, quantity: Number(item.quantity), discount: Number(item.discount),
        })) }
        : { ...base, categoryId: fields.get('category'), amount: Number(fields.get('amount')), notes: fields.get('notes') };
      const upload = new FormData();
      upload.set('payment', JSON.stringify(payment));
      if (photo instanceof File && photo.size) upload.set('photo', photo);
      const result = await transactionRequest<{ id: number }>(transactionEndpoint, { method: 'POST', body: upload });
      saved(result.id);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveFee() {
    const amount = Number(monthlyFee);
    if (busy || !Number.isSafeInteger(amount) || amount < 1 || amount > maxTransactionAmount) return;
    setBusy(true);
    setError('');
    try {
      const updated = await transactionRequest<TuitionMonth>(transactionEndpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set-fee', studentNumber: number, classCode, month, monthlyFee: amount }),
      });
      setBill(updated);
      setSelected(current => current.filter(item => updated.days.some(day => day.id === item.id &&
        !day.paid && !day.onLeave && day.code === item.code && day.date === item.date)));
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const due = bill?.due ?? Number(monthlyFee);
  const disabled = busy || (kind !== 'tuition' && !banks.data?.length) || (kind !== 'expense' && !lookup.data?.student)
    || (kind === 'tuition' && (!group || (bill !== null && (bill.skipped || due < 1 || (!days?.length && bill.fee === null)))))
    || (kind === 'purchase' && !items.length);
  return <Dialog open onOpenChange={open => { if (!open && !busy) close(); }}>
    <DialogContent ref={dialogRef} className={kind === 'purchase' ? 'sm:max-w-5xl' : 'student-editor'}
      showCloseButton={false} aria-describedby={undefined}
      onEscapeKeyDown={event => {
        if (!studentListOpen && !productListOpen) return;
        event.preventDefault();
        setStudentListOpen(false);
        setProductListOpen(false);
      }}>
      <DialogHeader><DialogTitle>{transactionLabels[kind].entry}</DialogTitle></DialogHeader>
      <form onSubmit={submit}>
        <div hidden={!!days}>
          <FieldGroup className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="transaction-id">ID pembayaran / 付款编号</FieldLabel>
              <Input id="transaction-id" readOnly value="Otomatis / 自动生成" />
            </Field>
            <Field>
              <FieldLabel htmlFor="payment-date">Tgl pembayaran / 付款日期</FieldLabel>
              <Input id="payment-date" name="date" type="date" defaultValue={today} max={today} required />
            </Field>
            <Field>
              <FieldLabel htmlFor="payment-bank">{kind === 'expense' ? 'Dari rekening / 付款账户' : 'Ke rekening / 收款账户'}</FieldLabel>
              <NativeSelect id="payment-bank" name="bank" required defaultValue="">
                <NativeSelectOption value="">{banks.loading ? 'Memuat / 加载中…' :
                  banks.data?.length ? 'Pilih rekening / 选择账户' : 'Belum ada rekening bank / 暂无银行账户'}</NativeSelectOption>
                {banks.data?.map(bank => <NativeSelectOption key={bank.id} value={bank.id}>{bank.name}</NativeSelectOption>)}
              </NativeSelect>
            </Field>
            {kind !== 'expense' && <>
              <Field>
                <FieldLabel htmlFor="payment-student">ID murid / 学生编号</FieldLabel>
                {kind === 'tuition' ? <Combobox<string> open={studentListOpen} onOpenChange={setStudentListOpen}
                  inputValue={number} onInputValueChange={(value, details) => {
                    if (details.reason !== 'input-change') return;
                    changeStudent(value);
                    setStudentListOpen(!!value.trim());
                  }} onValueChange={value => { if (value) changeStudent(value); }}
                  items={suggestions.data?.map(student => student.number) ?? []} filter={null}>
                  <ComboboxInput id="payment-student" autoComplete="off" maxLength={100} required showTrigger={false}
                    placeholder="Cari ID atau nama / 搜索编号或姓名" />
                  {search && <ComboboxContent container={dialogRef}>
                    <ComboboxEmpty>{suggestions.loading ? 'Memuat / 加载中…' :
                      suggestions.error || 'Murid tidak ditemukan / 未找到学生'}</ComboboxEmpty>
                    <ComboboxList>
                      {suggestions.data?.map(student => <ComboboxItem key={student.number} value={student.number}>
                        {student.number} · {student.name}
                      </ComboboxItem>)}
                    </ComboboxList>
                  </ComboboxContent>}
                </Combobox> : <Input id="payment-student" inputMode="numeric" pattern="[0-9]{7}" maxLength={7}
                  required value={number} onChange={event => changeStudent(event.target.value)} />}
              </Field>
              <Field>
                <FieldLabel htmlFor="payment-student-name">Nama murid / 学生姓名</FieldLabel>
                <Input id="payment-student-name" readOnly value={lookup.data?.student.name ?? ''} />
              </Field>
            </>}
            {kind === 'tuition' && <>
              <Field>
                <FieldLabel htmlFor="payment-class">ID kelas / 班级编号</FieldLabel>
                <NativeSelect id="payment-class" required value={classCode} onChange={event => setClassCode(event.target.value)}>
                  <NativeSelectOption value="">Pilih kelas / 选择班级</NativeSelectOption>
                  {lookup.data?.classes.map(row => <NativeSelectOption key={row.id} value={row.code}>{row.code}</NativeSelectOption>)}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="payment-class-name">Nama kelas / 班级名称</FieldLabel>
                <Input id="payment-class-name" readOnly value={group?.name ?? ''} />
              </Field>
              <Field>
                <FieldLabel htmlFor="tuition-month">Bulan kursus / 学费月份</FieldLabel>
                <Input id="tuition-month" name="month" type="month" defaultValue={today.slice(0, 7)}
                  min="2000-01" max="2099-12" required />
              </Field>
            </>}
            {kind === 'expense' && <>
              <Field>
                <FieldLabel htmlFor="payment-category">Kategori / 类别</FieldLabel>
                <NativeSelect id="payment-category" name="category" required defaultValue="">
                  <NativeSelectOption value="">Pilih kategori / 选择类别</NativeSelectOption>
                  {expenseCategories.map(([id, label]) => <NativeSelectOption key={id} value={id}>{label}</NativeSelectOption>)}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="payment-amount">Jumlah (Rp) / 金额（印尼盾）</FieldLabel>
                <Input id="payment-amount" name="amount" type="number" min={1} max={maxTransactionAmount} required />
              </Field>
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor="payment-notes">Catatan / 备注</FieldLabel>
                <Textarea id="payment-notes" name="notes" rows={3} maxLength={2000} required />
              </Field>
            </>}
            {kind === 'purchase' && <div className="sm:col-span-2">
              <PurchaseItems items={items} setItems={setItems} open={productListOpen} setOpen={setProductListOpen} dialogRef={dialogRef} />
            </div>}
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="payment-photo">{kind === 'expense' ? 'Foto bukti pengeluaran / 支出凭证照片' : 'Foto pembayaran / 付款凭证照片'} · JPG, PNG, WebP · 1 MB</FieldLabel>
              <Input id="payment-photo" name="photo" type="file" accept="image/jpeg,image/png,image/webp" />
            </Field>
          </FieldGroup>
        </div>
        {days && bill && <div className="flex flex-col gap-3">
          <p>{number} · {lookup.data?.student.name} · {classCode} · {group?.name} · {month}</p>
          {!bill.skipped && !waiverToken && <FieldGroup className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="tuition-fee">Tarif bulanan (Rp) / 月费（印尼盾）</FieldLabel>
              <Input id="tuition-fee" type="number" min={1} max={maxTransactionAmount} value={monthlyFee} required
                readOnly={bill.fee !== null} onChange={event => setMonthlyFee(event.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="tuition-amount">Jumlah pembayaran (Rp) / 本次付款（印尼盾）</FieldLabel>
              <Input id="tuition-amount" type="number" min={1} max={due || undefined} value={tuitionAmount} required
                onChange={event => setTuitionAmount(event.target.value)} />
            </Field>
          </FieldGroup>}
          <div className="flex flex-wrap justify-between gap-2">
            <span>Sudah dibayar / 已付 · {paymentMoney(bill.paid)}</span>
            <span>Dihapuskan / 已减免 · {paymentMoney(bill.waived)}</span>
            <strong>Sisa tagihan / 剩余应付 · {bill.skipped ? paymentMoney(0) : monthlyFee ? paymentMoney(due) : '—'}</strong>
          </div>
          {bill.skipped && <strong>Tanpa tagihan (cuti) / 暂停上课免收月费</strong>}
          {waiverToken ? <FieldGroup>
            <Field>
              <FieldLabel htmlFor="waiver-amount">Jumlah penghapusan (Rp) / 减免金额（印尼盾）</FieldLabel>
              <Input id="waiver-amount" name="waiverAmount" type="number" min={1} max={due} defaultValue={due} required />
            </Field>
            <Field>
              <FieldLabel htmlFor="waiver-reason">Alasan / 原因</FieldLabel>
              <Textarea id="waiver-reason" name="waiverReason" required maxLength={300} rows={2} />
            </Field>
          </FieldGroup> : <Table>
            <TableHeader><TableRow>
              <TableHead><span className="sr-only">Pilih / 选择</span></TableHead>
              <TableHead>ID hari kelas / 课次编号</TableHead><TableHead>Tanggal / 日期</TableHead><TableHead>Status / 状态</TableHead>
            </TableRow></TableHeader>
            <TableBody>{days.length ? days.map(day => <TableRow key={day.id}>
              <TableCell><input type="checkbox" disabled={day.paid || day.onLeave || busy} checked={selected.some(row => row.id === day.id)}
                aria-label={'Pilih ' + day.code + ' / 选择'} onChange={event => setSelected(event.target.checked
                  ? [...selected, day] : selected.filter(row => row.id !== day.id))} /></TableCell>
              <TableCell>{day.code}</TableCell><TableCell>{paymentDay(day.date)}</TableCell>
              <TableCell>{day.onLeave ? classLeaveLabel : day.paid ? 'Sudah dirujuk / 已关联付款' : '—'}</TableCell>
            </TableRow>) : <TableRow><TableCell colSpan={4}>Belum ada jadwal / 暂无课次</TableCell></TableRow>}</TableBody>
          </Table>}
        </div>}
        {(error || banks.error || lookup.error) && <Alert variant="destructive" className="mt-4">
          <AlertDescription>{error || banks.error || lookup.error}</AlertDescription>
        </Alert>}
        <DialogFooter className="mt-4">
          <Button type="button" variant="outline" disabled={busy} onClick={days ? () => {
            if (waiverToken) setWaiverToken(null);
            else { setBill(null); setSelected([]); }
            setError('');
          } : close}>{days ? 'Kembali / 返回' : 'Batal / 取消'}</Button>
          {bill?.fee === null && !bill.skipped && <Button type="button" variant="outline" onClick={saveFee}
            disabled={busy || !days?.length || Number(monthlyFee) < 1 || Number(monthlyFee) > maxTransactionAmount}>
            Simpan tagihan / 保存月费
          </Button>}
          {supervisor && bill && bill.fee !== null && due > 0 && !waiverToken && <Button type="button" variant="outline"
            disabled={busy} onClick={() => { setError(''); setWaiverToken(crypto.randomUUID()); }}>{tuitionWaiverLabel}</Button>}
          <Button type="submit" formNoValidate={kind === 'tuition'} disabled={disabled}>{busy ? 'Memproses / 处理中…' :
            kind === 'tuition' && !days ? 'Lanjut / 继续' : waiverToken ? 'Simpan penghapusan / 保存减免' : 'Simpan / 保存'}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
