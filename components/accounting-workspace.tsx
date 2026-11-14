"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { BookOpen, FileText, Landmark, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { accountLabel, canAccessAccounting, ledgerPageSize, maxTransactionAmount, type AccountingAccount, type LedgerPage, type MonthlyAccountingReport } from '@/lib/accounting-fields';
import { todayJakarta } from '@/lib/student-fields';

const currency = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
const dateFormat = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeZone: 'Asia/Jakarta' });
const inputDateFormat = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' });
const monthFormat = new Intl.DateTimeFormat('id-ID', { month: 'long', timeZone: 'Asia/Jakarta' });
const rupiah = (value: string) => currency.format(BigInt(value));

async function accountingRequest<T>(url: string, options: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? 'Terjadi kesalahan / 发生错误');
  return data;
}

function useAccountingData<T>(url: string, reload = 0) {
  const [result, setResult] = useState<{ url: string; reload: number; data: T | null; error: string }>();
  useEffect(() => {
    const controller = new AbortController();
    accountingRequest<T>(url, { signal: controller.signal, cache: 'no-store' })
      .then(data => { if (!controller.signal.aborted) setResult({ url, reload, data, error: '' }); })
      .catch(error => { if (!controller.signal.aborted) setResult({ url, reload, data: null, error: error.message }); });
    return () => controller.abort();
  }, [url, reload]);
  if (result?.url !== url || result.reload !== reload) return { data: null, error: '', loading: true };
  return { ...result, loading: false };
}

function ErrorMessage({ message }: { message: string }) {
  return message ? <Alert variant="destructive"><AlertDescription>{message}</AlertDescription></Alert> : null;
}

function EmptyRow({ columns, loading, message }: { columns: number; loading: boolean; message: string }) {
  return <TableRow><TableCell colSpan={columns}>
    <div className="table-state">{loading ? 'Memuat / 加载中…' : message}</div>
  </TableCell></TableRow>;
}

function SaveDialog({ title, close, saved, disabled, payload, children }: {
  title: string; close: () => void; saved: () => void; disabled?: boolean;
  payload: (values: FormData) => object; children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const body = payload(new FormData(event.currentTarget));
    setBusy(true);
    setError('');
    try {
      await accountingRequest('/api/accounting', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      saved();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) close(); }}>
    <DialogContent showCloseButton={false} aria-describedby={undefined}>
      <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
      <form onSubmit={submit}>
        <FieldGroup>
          {children}
          <ErrorMessage message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={close}>Batal / 取消</Button>
            <Button type="submit" disabled={busy || disabled}>{busy ? 'Menyimpan / 正在保存…' : 'Simpan / 保存'}</Button>
          </DialogFooter>
        </FieldGroup>
      </form>
    </DialogContent>
  </Dialog>;
}

function BankEditor({ close, saved }: { close: () => void; saved: () => void }) {
  const [id] = useState(() => crypto.randomUUID());
  return <SaveDialog title="Tambah rekening bank / 添加银行账户" close={close} saved={saved}
    payload={values => ({ action: 'bank', id, name: values.get('name') })}>
    <Field>
      <FieldLabel htmlFor="bank-name">Nama rekening bank / 银行账户名称</FieldLabel>
      <Input id="bank-name" name="name" maxLength={120} required />
    </Field>
  </SaveDialog>;
}

function TransactionEditor({ accounts, close, saved }: { accounts: AccountingAccount[]; close: () => void; saved: () => void }) {
  const [token] = useState(() => crypto.randomUUID());
  const today = todayJakarta();
  const bankAccounts = accounts.filter(account => account.kind === 'bank');
  const [bankId, setBankId] = useState(bankAccounts.length === 1 ? bankAccounts[0].id : '');
  const [destinationId, setDestinationId] = useState('');
  return <SaveDialog title="Catat transaksi / 记录交易" close={close} saved={saved} disabled={!bankAccounts.length}
    payload={values => ({
      action: 'entry', token, transactionDate: values.get('date'), bankId: values.get('bank'),
      categoryId: values.get('destination'), amount: Number(values.get('amount')), notes: values.get('notes'),
    })}>
    <Field>
      <FieldLabel htmlFor="transaction-date">Tgl transaksi / 交易日期</FieldLabel>
      <Input id="transaction-date" name="date" type="date" defaultValue={today} max={today} required />
    </Field>
    <Field>
      <FieldLabel htmlFor="transaction-bank">Rekening bank / 银行账户</FieldLabel>
      <NativeSelect id="transaction-bank" name="bank" required value={bankId} onChange={event => {
        const next = event.target.value;
        setBankId(next);
        if (next === destinationId) setDestinationId('');
      }}>
        <NativeSelectOption value="">{bankAccounts.length ? 'Pilih rekening bank / 选择银行账户' : 'Belum ada rekening bank / 暂无银行账户'}</NativeSelectOption>
        {bankAccounts.map(account => <NativeSelectOption key={account.id} value={account.id}>{account.name}</NativeSelectOption>)}
      </NativeSelect>
    </Field>
    <Field>
      <FieldLabel htmlFor="transaction-destination">Akun tujuan / 目标账户</FieldLabel>
      <NativeSelect id="transaction-destination" name="destination" required value={destinationId}
        onChange={event => setDestinationId(event.target.value)}>
        <NativeSelectOption value="">Pilih akun tujuan / 选择目标账户</NativeSelectOption>
        {accounts.filter(account => account.id !== bankId).map(account => <NativeSelectOption key={account.id} value={account.id}>
          {accountLabel(account)}
        </NativeSelectOption>)}
      </NativeSelect>
    </Field>
    <Field>
      <FieldLabel htmlFor="transaction-amount">Jumlah (Rp) / 金额（印尼盾）</FieldLabel>
      <Input id="transaction-amount" name="amount" type="number" min={1} max={maxTransactionAmount} step={1} required />
    </Field>
    <Field>
      <FieldLabel htmlFor="transaction-notes">Catatan / 备注</FieldLabel>
      <Textarea id="transaction-notes" name="notes" maxLength={2000} rows={3} />
    </Field>
  </SaveDialog>;
}

function Ledger({ account, close }: { account: AccountingAccount; close: () => void }) {
  const [range, setRange] = useState({ from: '', to: '' });
  const [page, setPage] = useState(1);
  const [rangeError, setRangeError] = useState('');
  const query = new URLSearchParams({ account: account.id, ...range, page: String(page) });
  const { data, error, loading } = useAccountingData<LedgerPage>('/api/accounting?' + query);
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / ledgerPageSize));
  const current = data?.page ?? 1;
  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const from = String(values.get('from') ?? ''), to = String(values.get('to') ?? '');
    if (from && to && from > to) {
      setRangeError('Rentang tanggal tidak valid / 日期范围无效');
      return;
    }
    setRangeError('');
    setRange({ from, to });
    setPage(1);
  }
  return <Dialog open onOpenChange={open => { if (!open) close(); }}>
    <DialogContent className="student-editor" showCloseButton={false} aria-describedby={undefined}>
      <DialogHeader><DialogTitle>Buku besar / 分类账 · {accountLabel(account)}</DialogTitle></DialogHeader>
      <form onSubmit={filter}>
        <FieldGroup className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <Field>
            <FieldLabel htmlFor="ledger-from">Dari tanggal / 起始日期</FieldLabel>
            <Input id="ledger-from" name="from" type="date" />
          </Field>
          <Field>
            <FieldLabel htmlFor="ledger-to">Sampai tanggal / 截止日期</FieldLabel>
            <Input id="ledger-to" name="to" type="date" />
          </Field>
          <Button type="submit" variant="outline">Filter / 筛选</Button>
        </FieldGroup>
      </form>
      <ErrorMessage message={rangeError || error} />
      <Table>
        <TableHeader><TableRow>
          <TableHead scope="col">Tgl transaksi / 交易日期</TableHead>
          <TableHead scope="col">Tgl dicatat / 录入日期</TableHead>
          <TableHead scope="col">Dicatat oleh / 录入人</TableHead>
          <TableHead scope="col">Catatan / 备注</TableHead>
          <TableHead scope="col" className="text-right">Jumlah / 金额</TableHead>
          <TableHead scope="col" className="text-right">Saldo / 余额</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {!data?.rows.length && !error
            ? <EmptyRow columns={6} loading={loading} message="Belum ada transaksi / 暂无交易" />
            : data?.rows.map(row => <TableRow key={row.id}>
              <TableCell>{dateFormat.format(new Date(row.transactionDate + 'T00:00:00+07:00'))}</TableCell>
              <TableCell>{inputDateFormat.format(new Date(row.recordedAt))}</TableCell>
              <TableCell>{row.recordedBy}</TableCell>
              <TableCell className="min-w-32 max-w-64 whitespace-pre-wrap break-words">{row.notes || '—'}</TableCell>
              <TableCell className="text-right tabular-nums">{rupiah(row.amount)}</TableCell>
              <TableCell className="text-right tabular-nums">{rupiah(row.balance)}</TableCell>
            </TableRow>)}
        </TableBody>
      </Table>
      {pages > 1 && <nav aria-label="Halaman buku besar / 分类账页码" className="flex flex-wrap items-center justify-between gap-2">
        <span>Halaman / 页 {current} / {pages}</span>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" disabled={loading || current <= 1}
            onClick={() => setPage(current - 1)}>Sebelumnya / 上一页</Button>
          <Button type="button" variant="outline" size="sm" disabled={loading || current >= pages}
            onClick={() => setPage(current + 1)}>Berikutnya / 下一页</Button>
        </div>
      </nav>}
      <DialogFooter><Button type="button" variant="outline" onClick={close}>Tutup / 关闭</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function ReportAccounts({ title, rows, total, totalLabel, amountLabel = 'Jumlah / 金额' }: {
  title: string; rows: AccountingAccount[]; total: string; totalLabel: string; amountLabel?: string;
}) {
  return <section className="flex min-w-0 flex-col gap-2 rounded-md border p-3">
    <h3 className="font-medium">{title}</h3>
    <Table>
      <TableHeader><TableRow>
        <TableHead scope="col">Nama akun / 账户名称</TableHead>
        <TableHead scope="col" className="text-right">{amountLabel}</TableHead>
      </TableRow></TableHeader>
      <TableBody>
        {rows.length ? rows.map(row => <TableRow key={row.id}>
          <TableCell className="whitespace-normal" title={row.name}>{accountLabel(row)}</TableCell>
          <TableCell className="text-right tabular-nums">{rupiah(row.balance)}</TableCell>
        </TableRow>) : <EmptyRow columns={2} loading={false} message="Belum ada rekening bank / 暂无银行账户" />}
      </TableBody>
      <TableFooter><TableRow>
        <TableHead scope="row" className="whitespace-normal">{totalLabel}</TableHead>
        <TableCell className="text-right tabular-nums">{rupiah(total)}</TableCell>
      </TableRow></TableFooter>
    </Table>
  </section>;
}

function MonthlyReport({ close }: { close: () => void }) {
  const today = todayJakarta();
  const currentMonth = today.slice(0, 7);
  const [month, setMonth] = useState(currentMonth);
  const [reload, setReload] = useState(0);
  const query = new URLSearchParams({ view: 'monthly-report', month });
  const { data, loading, error } = useAccountingData<MonthlyAccountingReport>('/api/accounting?' + query, reload);
  const monthInProgress = !!data && data.endDate > today;
  function selectMonth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setMonth(String(values.get('year')) + '-' + String(values.get('month')));
    setReload(value => value + 1);
  }
  return <Dialog open onOpenChange={open => { if (!open) close(); }}>
    <DialogContent className="student-editor" showCloseButton={false} aria-describedby={undefined}>
      <DialogHeader><DialogTitle>Laporan bulanan / 月度报告</DialogTitle></DialogHeader>
      <form onSubmit={selectMonth}>
        <FieldGroup className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <Field>
            <FieldLabel htmlFor="report-month">Bulan / 月份</FieldLabel>
            <NativeSelect id="report-month" name="month" defaultValue={currentMonth.slice(5)}>
              {Array.from({ length: 12 }, (_, i) => (
                <NativeSelectOption key={i} value={String(i + 1).padStart(2, '0')}>
                  {monthFormat.format(new Date(Date.UTC(2020, i, 15)))} / {i + 1}月
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="report-year">Tahun / 年份</FieldLabel>
            <Input id="report-year" name="year" type="number" min={1900} max={Number(currentMonth.slice(0, 4))}
              step={1} defaultValue={currentMonth.slice(0, 4)} required />
          </Field>
          <Button type="submit" variant="outline">Tampilkan / 显示</Button>
        </FieldGroup>
      </form>
      <ErrorMessage message={error} />
      {loading && <p role="status">Memuat / 加载中…</p>}
      {data && <>
        <div className="grid gap-3 sm:grid-cols-2">
          <ReportAccounts title="Pendapatan / 收入" rows={data.income} total={data.totalIncome}
            totalLabel="Total pendapatan / 收入合计" />
          <ReportAccounts title="Beban / 费用" rows={data.expenses} total={data.totalExpenses}
            totalLabel="Total beban / 费用合计" />
        </div>
        <p className="flex flex-wrap justify-between gap-2 rounded-md border p-3 font-medium">
          <span>Selisih pendapatan dan beban / 收支差额</span>
          <span className="tabular-nums">{rupiah(data.net)}</span>
        </p>
        <ReportAccounts
          title={(monthInProgress ? 'Saldo bank s.d. hari ini / 截至今日银行余额' : 'Saldo bank akhir bulan / 月末银行余额')
            + ' · ' + dateFormat.format(new Date((monthInProgress ? today : data.endDate) + 'T00:00:00+07:00'))}
          rows={data.banks} total={data.totalBankBalance} totalLabel="Total saldo bank / 银行余额合计" amountLabel="Saldo / 余额" />
      </>}
      <DialogFooter><Button type="button" variant="outline" onClick={close}>Tutup / 关闭</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

export default function AccountingWorkspace({ role }: { role: string }) {
  const allowed = canAccessAccounting(role);
  return allowed ? <Accounts /> : <main className="workspace"><ErrorMessage message="Akses ditolak / 无访问权限" /></main>;
}

function Accounts() {
  const [editor, setEditor] = useState<'bank' | 'entry' | 'report' | null>(null);
  const [ledger, setLedger] = useState<AccountingAccount | null>(null);
  const [reload, setReload] = useState(0);
  const { data, error, loading } = useAccountingData<{ accounts: AccountingAccount[] }>('/api/accounting', reload);
  const accounts = data?.accounts ?? [];
  function saved(message: string) {
    setEditor(null);
    setReload(value => value + 1);
    toast.success(message);
  }
  return <main className="workspace student-workspace">
    <div className="page-heading">
      <h1>Akuntansi<span className="zh" lang="zh-Hans">会计</span></h1>
      <div className="heading-actions">
        <Button variant="outline" onClick={() => setEditor('report')}>
          <FileText data-icon="inline-start" />Laporan / 报告
        </Button>
        <Button variant="outline" onClick={() => setEditor('bank')}>
          <Landmark data-icon="inline-start" />Tambah rekening bank / 添加银行账户
        </Button>
        <Button disabled={!data} onClick={() => setEditor('entry')}>
          <Plus data-icon="inline-start" />Catat transaksi / 记录交易
        </Button>
      </div>
    </div>
    <ErrorMessage message={error} />
    <Card className="users-card student-table">
      <CardHeader><CardTitle>Daftar akun / 会计科目</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow>
            <TableHead scope="col">Nama akun / 账户名称</TableHead>
            <TableHead scope="col" className="text-right">Saldo saat ini / 当前余额</TableHead>
            <TableHead scope="col"><span className="sr-only">Buku besar / 分类账</span></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {!accounts.length && !error
              ? <EmptyRow columns={3} loading={loading} message="Belum ada akun / 暂无账户" />
              : accounts.map(account => <TableRow key={account.id}>
                <TableCell title={account.name}>{accountLabel(account)}</TableCell>
                <TableCell className="text-right tabular-nums">{rupiah(account.balance)}</TableCell>
                <TableCell>
                  <Button variant="outline" size="sm" onClick={() => setLedger(account)}>
                    <BookOpen data-icon="inline-start" />Buku besar / 分类账
                  </Button>
                </TableCell>
              </TableRow>)}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
    {editor === 'bank' && <BankEditor close={() => setEditor(null)} saved={() => saved('Rekening bank disimpan / 银行账户已保存')} />}
    {editor === 'entry' && <TransactionEditor accounts={accounts} close={() => setEditor(null)}
      saved={() => saved('Transaksi disimpan / 交易已保存')} />}
    {editor === 'report' && <MonthlyReport close={() => setEditor(null)} />}
    {ledger && <Ledger account={ledger} close={() => setLedger(null)} />}
  </main>;
}
