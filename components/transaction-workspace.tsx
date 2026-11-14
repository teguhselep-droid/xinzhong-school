"use client";

import { useState } from 'react';
import { ClipboardList, History, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import TransactionForm from '@/components/transaction-form';
import { paymentDay, paymentMoney, paymentTime, transactionEndpoint, transactionRequest, useTransactionData } from '@/components/transaction-request';
import { todayJakarta } from '@/lib/student-fields';
import {
  canAccessTransactions, discountedPrice, expenseCategories, paymentCode, transactionLabels, transactionPageSize, tuitionWaiverLabel,
  type PaymentHistory, type PaymentKind, type PurchaseLine, type TransactionPage, type TuitionLine, type TuitionStatusRow, type TuitionWaiver,
} from '@/lib/transaction-fields';

const statusTitle = 'Status pembayaran kursus / 学费状态';
const loadingLabel = 'Memuat / 加载中…';
const emptyLabel = 'Belum ada catatan / 暂无记录';
const groups: PaymentKind[] = ['tuition', 'purchase', 'expense'];
const groupTitles = { tuition: 'Kursus / 学费', purchase: 'Pembelian / 商品付款', expense: 'Pengeluaran / 支出' };

function ErrorMessage({ error }: { error: string }) {
  return error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null;
}

function Pagination({ page, total, change }: { page: number; total: number; change: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / transactionPageSize));
  return pages > 1 ? <nav aria-label="Halaman / 页码" className="flex flex-wrap items-center justify-between gap-2">
    <span>Halaman / 页 {page} / {pages}</span>
    <div className="flex gap-2">
      <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => change(page - 1)}>
        Sebelumnya / 上一页
      </Button>
      <Button type="button" variant="outline" size="sm" disabled={page >= pages} onClick={() => change(page + 1)}>
        Berikutnya / 下一页
      </Button>
    </div>
  </nav> : null;
}

function PaymentDetails({ row }: { row: PaymentHistory }) {
  if (row.kind === 'expense') return <span className="whitespace-pre-wrap break-words">{row.memo}</span>;
  if (row.kind === 'tuition') return <div className="flex flex-col gap-1">
    <span>{row.tuitionMonth} · {row.classCode} · {row.className}</span>
    {row.monthlyFee !== null && <span>Tarif bulanan / 月费 · {paymentMoney(row.monthlyFee)}</span>}
    {!!row.detail.length && <details>
      <summary className="cursor-pointer">Hari yang dirujuk / 关联课次</summary>
      <ul>{(row.detail as TuitionLine[]).map(day => <li key={day.id}>{day.code} · {paymentDay(day.date)}</li>)}</ul>
    </details>}
  </div>;
  return <details>
    <summary className="cursor-pointer">{row.detail.length} barang / 种商品</summary>
    <Table>
      <TableHeader><TableRow>
        <TableHead>Barang / 商品</TableHead><TableHead>Qty / 数量</TableHead><TableHead>Harga satuan / 单价</TableHead>
        <TableHead>Diskon per unit / 单件折扣</TableHead><TableHead>Harga setelah diskon / 折后单价</TableHead><TableHead>Total / 合计</TableHead>
      </TableRow></TableHeader>
      <TableBody>{(row.detail as PurchaseLine[]).map(item => <TableRow key={item.productId}>
        <TableCell>{item.name}</TableCell><TableCell>{item.quantity}</TableCell><TableCell>{paymentMoney(item.price)}</TableCell>
        <TableCell>{paymentMoney(item.discount)}</TableCell><TableCell>{paymentMoney(discountedPrice(item))}</TableCell>
        <TableCell>{paymentMoney(discountedPrice(item) * item.quantity)}</TableCell>
      </TableRow>)}</TableBody>
    </Table>
  </details>;
}

function HistoryDialog({ kind, supervisor, close }: { kind: PaymentKind; supervisor: boolean; close: () => void }) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [reload, setReload] = useState(0);
  const [target, setTarget] = useState<PaymentHistory | null>(null);
  const [busy, setBusy] = useState(false);
  const [voidError, setVoidError] = useState('');
  const [showWaivers, setShowWaivers] = useState(false);
  const { data, error, loading } = useTransactionData<TransactionPage<PaymentHistory>>(
    showWaivers ? null : { view: 'history', kind, page: String(page), search }, reload,
  );
  const waivers = useTransactionData<TransactionPage<TuitionWaiver>>(showWaivers ? { view: 'waivers', page: String(page), search } : null);
  const historyPage = showWaivers ? waivers.data : data;
  const columns = [
    ...(supervisor ? [''] : []), 'ID pembayaran / 付款编号', 'Tgl pembayaran / 付款日期', 'Rekening / 银行账户',
    kind === 'expense' ? 'Kategori / 类别' : 'Murid / 学生', 'Detail / 详情', 'Total / 合计',
    'Foto / 照片', 'Tgl dicatat / 录入日期', 'Dicatat oleh / 录入人', 'Status / 状态',
  ];
  async function voidPayment() {
    if (!target || busy) return;
    setBusy(true);
    setVoidError('');
    try {
      await transactionRequest(transactionEndpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'void', id: target.id }),
      });
      setTarget(null);
      setReload(value => value + 1);
      toast.success('Transaksi dibatalkan / 交易已冲销');
    } catch (error) {
      setVoidError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return <>
    <Dialog open onOpenChange={open => { if (!open && !busy && !target) close(); }}>
      <DialogContent className="sm:max-w-5xl" showCloseButton={false} aria-describedby={undefined}>
        <DialogHeader><DialogTitle>{transactionLabels[kind].history}</DialogTitle></DialogHeader>
        {kind === 'tuition' && <div className="flex flex-wrap gap-2">
          <Button type="button" variant={showWaivers ? 'outline' : 'default'} aria-pressed={!showWaivers}
            onClick={() => { setShowWaivers(false); setPage(1); }}>Pembayaran / 付款</Button>
          <Button type="button" variant={showWaivers ? 'default' : 'outline'} aria-pressed={showWaivers}
            onClick={() => { setShowWaivers(true); setPage(1); }}>{tuitionWaiverLabel}</Button>
        </div>}
        <Input aria-label="Cari transaksi / 搜索交易" placeholder="Cari transaksi / 搜索交易" value={search} maxLength={40}
          onChange={event => { setSearch(event.target.value); setPage(1); }} />
        <ErrorMessage error={showWaivers ? waivers.error : error} />
        {showWaivers ? <Table>
          <TableHeader><TableRow>
            <TableHead>Murid / 学生</TableHead><TableHead>Kelas / 班级</TableHead><TableHead>Bulan kursus / 学费月份</TableHead>
            <TableHead>Jumlah / 金额</TableHead><TableHead>Alasan / 原因</TableHead><TableHead>Disetujui oleh / 审批人</TableHead>
            <TableHead>Tgl dicatat / 录入日期</TableHead>
          </TableRow></TableHeader>
          <TableBody>{waivers.data?.rows.length ? waivers.data.rows.map(row => <TableRow key={row.id}>
            <TableCell>{row.studentNumber} · {row.studentName}</TableCell><TableCell>{row.classCode} · {row.className}</TableCell>
            <TableCell>{row.month}</TableCell><TableCell>{paymentMoney(row.amount)}</TableCell>
            <TableCell className="max-w-72 whitespace-pre-wrap break-words">{row.reason}</TableCell>
            <TableCell>{row.recordedBy}</TableCell><TableCell>{paymentTime(row.recordedAt)}</TableCell>
          </TableRow>) : <TableRow><TableCell colSpan={7}>
            {waivers.loading ? loadingLabel : waivers.error ? '—' : emptyLabel}
          </TableCell></TableRow>}</TableBody>
        </Table> : <Table>
          <TableHeader><TableRow>{columns.map(label => <TableHead key={label} scope="col">
            {label || <span className="sr-only">Batalkan / 冲销</span>}
          </TableHead>)}</TableRow></TableHeader>
          <TableBody>{data?.rows.length ? data.rows.map(row => <TableRow key={row.id}>
            {supervisor && <TableCell>{!row.voidedAt && <Button variant="ghost" size="icon-sm"
              title="Batalkan transaksi / 冲销交易" aria-label={'Batalkan ' + paymentCode(row.id) + ' / 冲销'}
              onClick={() => { setVoidError(''); setTarget(row); }}><Trash2 /></Button>}</TableCell>}
            <TableCell>{paymentCode(row.id)}</TableCell><TableCell>{paymentDay(row.paymentDate)}</TableCell><TableCell>{row.bank}</TableCell>
            <TableCell>{kind === 'expense'
              ? expenseCategories.find(([id]) => id === row.categoryId)?.[1] ?? '—'
              : row.studentNumber + ' · ' + row.studentName}</TableCell>
            <TableCell className="min-w-36 whitespace-normal"><PaymentDetails row={row} /></TableCell>
            <TableCell>{paymentMoney(row.total)}</TableCell>
            <TableCell>{row.hasPhoto ? <a className="underline" href={transactionEndpoint + '?view=photo&id=' + row.id}
              target="_blank" rel="noopener noreferrer">Lihat foto / 查看照片</a> : '—'}</TableCell>
            <TableCell>{paymentTime(row.recordedAt)}</TableCell><TableCell>{row.recordedBy}</TableCell>
            <TableCell>{row.voidedAt ? <div className="flex flex-col gap-1">
              <Badge variant="secondary">Dibatalkan / 已冲销</Badge>
              <span>{paymentTime(row.voidedAt)} · {row.voidedBy}</span>
            </div> : <Badge variant="outline">Tercatat / 已登记</Badge>}</TableCell>
          </TableRow>) : <TableRow><TableCell colSpan={columns.length}>
            {loading ? loadingLabel : error ? '—' : emptyLabel}
          </TableCell></TableRow>}</TableBody>
        </Table>}
        {historyPage && <Pagination page={historyPage.page} total={historyPage.total} change={setPage} />}
        <DialogFooter><Button type="button" variant="outline" onClick={close}>Tutup / 关闭</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    {target && <AlertDialog open onOpenChange={open => { if (!open && !busy) setTarget(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Batalkan transaksi? / 冲销交易？</AlertDialogTitle>
          <AlertDialogDescription>{paymentCode(target.id)} · {paymentMoney(target.total)} · {paymentDay(target.paymentDate)}</AlertDialogDescription>
        </AlertDialogHeader>
        <ErrorMessage error={voidError} />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Kembali / 返回</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={busy} onClick={event => {
            event.preventDefault(); void voidPayment();
          }}>Batalkan transaksi / 冲销交易</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>}
  </>;
}

function TuitionStatusDialog({ close }: { close: () => void }) {
  const [month, setMonth] = useState(todayJakarta().slice(0, 7));
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [onlyUnpaid, setOnlyUnpaid] = useState(true);
  const result = useTransactionData<TransactionPage<TuitionStatusRow>>(month ? {
    view: 'status', month, search, page: String(page), onlyUnpaid: onlyUnpaid ? '1' : '0',
  } : null);
  return <Dialog open onOpenChange={open => { if (!open) close(); }}>
    <DialogContent className="sm:max-w-5xl" showCloseButton={false} aria-describedby={undefined}>
      <DialogHeader><DialogTitle>{statusTitle}</DialogTitle></DialogHeader>
      <div className="flex flex-wrap items-end gap-3">
        <Field className="w-auto">
          <FieldLabel htmlFor="status-month">Bulan kursus / 学费月份</FieldLabel>
          <Input id="status-month" type="month" min="2000-01" max="2099-12" value={month} onChange={event => {
            setMonth(event.target.value); setPage(1);
          }} />
        </Field>
        <Field className="w-auto">
          <FieldLabel htmlFor="status-search">Cari murid atau kelas / 搜索学生或班级</FieldLabel>
          <Input id="status-search" maxLength={40} value={search} onChange={event => {
            setSearch(event.target.value); setPage(1);
          }} />
        </Field>
        <label className="flex items-center gap-2 py-2">
          <input type="checkbox" checked={onlyUnpaid} onChange={event => { setOnlyUnpaid(event.target.checked); setPage(1); }} />
          Belum lunas / 未结清
        </label>
      </div>
      <ErrorMessage error={result.error} />
      <Table>
        <TableHeader><TableRow>
          <TableHead>Murid / 学生</TableHead><TableHead>Kelas / 班级</TableHead><TableHead>Hadir / 出勤</TableHead>
          <TableHead>Hadir dengan referensi / 已关联付款的出勤</TableHead><TableHead>Tarif bulanan / 月费</TableHead>
          <TableHead>Sudah dibayar / 已付</TableHead><TableHead>Dihapuskan / 已减免</TableHead><TableHead>Sisa tagihan / 剩余应付</TableHead>
        </TableRow></TableHeader>
        <TableBody>{result.data?.rows.length ? result.data.rows.map(row => <TableRow key={row.studentNumber + row.classCode}>
          <TableCell>{row.studentNumber} · {row.studentName}</TableCell><TableCell>{row.classCode} · {row.className}</TableCell>
          <TableCell>{row.attended}</TableCell><TableCell>
            {row.referenced}
            {!!row.unreferencedDays.length && <details>
              <summary className="cursor-pointer">Tanpa referensi / 未关联</summary>
              <ul>{row.unreferencedDays.map(day => <li key={day.code}>{day.code} · {paymentDay(day.date)}</li>)}</ul>
            </details>}
          </TableCell>
          <TableCell>{row.skipped ? 'Tanpa tagihan (cuti) / 暂停上课免收月费' :
            row.fee === null ? 'Belum ditetapkan / 未设定' : paymentMoney(row.fee)}</TableCell>
          <TableCell>{paymentMoney(row.paid)}</TableCell>
          <TableCell>{paymentMoney(row.waived)}</TableCell>
          <TableCell>{row.due === null ? '—' : row.due === 0 && !row.skipped ? 'Lunas / 已结清' : paymentMoney(row.due)}</TableCell>
        </TableRow>) : <TableRow><TableCell colSpan={8}>{result.loading ? loadingLabel : result.error ? '—' : emptyLabel}</TableCell></TableRow>}</TableBody>
      </Table>
      {result.data && <Pagination page={result.data.page} total={result.data.total} change={setPage} />}
      <DialogFooter><Button type="button" variant="outline" onClick={close}>Tutup / 关闭</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

export default function TransactionWorkspace({ role }: { role: string }) {
  const [editor, setEditor] = useState<PaymentKind | null>(null);
  const [history, setHistory] = useState<PaymentKind | null>(null);
  const [status, setStatus] = useState(false);
  if (!canAccessTransactions(role)) return <main className="workspace"><ErrorMessage error="Akses ditolak / 无访问权限" /></main>;
  return <main className="workspace">
    <div className="page-heading"><h1>Transaksi<span className="zh" lang="zh-Hans">交易</span></h1></div>
    <div className="grid gap-4">
      {groups.map(kind => <Card key={kind}>
        <CardHeader><CardTitle>{groupTitles[kind]}</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button onClick={() => setEditor(kind)}><Plus data-icon="inline-start" />{transactionLabels[kind].entry}</Button>
          {kind === 'tuition' && <Button variant="outline" onClick={() => setStatus(true)}>
            <ClipboardList data-icon="inline-start" />{statusTitle}
          </Button>}
          <Button variant="outline" onClick={() => setHistory(kind)}><History data-icon="inline-start" />{transactionLabels[kind].history}</Button>
        </CardContent>
      </Card>)}
    </div>
    {editor && <TransactionForm kind={editor} supervisor={role === 'supervisor'} close={() => setEditor(null)} saved={id => {
      setEditor(null);
      toast.success('Transaksi disimpan / 交易已保存 · ' + paymentCode(id));
    }} />}
    {history && <HistoryDialog kind={history} supervisor={role === 'supervisor'} close={() => setHistory(null)} />}
    {status && <TuitionStatusDialog close={() => setStatus(false)} />}
  </main>;
}
