"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, History, Plus, Tags } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  canAddInventory, inventoryPageSize, maxInventoryQuantity, maxSalesPrice, movementLabels,
  type InventoryCategory, type InventoryMovement, type InventoryProduct, type MovementDirection,
} from '@/lib/inventory-fields';
import { maxTransactionAmount } from '@/lib/accounting-fields';
import { paymentCode } from '@/lib/transaction-fields';

type InventoryPage = { rows: InventoryProduct[]; total: number; page: number; categories: InventoryCategory[] };
const currency = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
const numberFormat = new Intl.NumberFormat('id-ID');
const dateFormat = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeZone: 'Asia/Jakarta' });
const movementDateFormat = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' });
const movementEndpoint = '/api/inventory/movements';
const blank = 'Belum diisi / 未填写';
const labels = [
  'ID barang / 商品编号', 'Nama barang / 商品名称', 'Kategori / 分类', 'Harga jual / 售价', 'Stok saat ini / 当前库存',
  'Tgl dicatat / 登记日期', 'Dicatat oleh / 登记人',
];

function ErrorMessage({ message }: { message: string }) {
  return message ? <Alert variant="destructive"><AlertDescription>{message}</AlertDescription></Alert> : null;
}

function useSave<T>(saved: (data: T) => void, url = '/api/inventory') {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(event: FormEvent, body: object) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await response.json() as T & { error?: string };
      if (!response.ok) throw new Error(data.error ?? 'Gagal menyimpan / 无法保存');
      saved(data);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, save, clearError: () => setError('') };
}

function InventoryDialog({ title, busy, close, children }: { title: string; busy: boolean; close: () => void; children: ReactNode }) {
  return <Dialog open onOpenChange={open => { if (!open && !busy) close(); }}>
    <DialogContent showCloseButton={false} aria-describedby={undefined}>
      <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
      {children}
    </DialogContent>
  </Dialog>;
}

function SaveButtons({ busy, close, disabled, closeLabel = 'Batal / 取消' }: {
  busy: boolean; close: () => void; disabled?: boolean; closeLabel?: string;
}) {
  return <DialogFooter>
    <Button type="button" variant="outline" disabled={busy} onClick={close}>{closeLabel}</Button>
    <Button type="submit" disabled={busy || disabled}>{busy ? 'Menyimpan / 正在保存…' : 'Simpan / 保存'}</Button>
  </DialogFooter>;
}

function CategoryEditor({ categories, close, changed }: {
  categories: InventoryCategory[]; close: () => void; changed: () => void;
}) {
  const [slots, setSlots] = useState(categories);
  const [id, setId] = useState(categories[0]?.id ?? 1);
  const slot = slots.find(category => category.id === id);
  const [name, setName] = useState(slot?.name ?? '');
  const { busy, error, save, clearError } = useSave<InventoryCategory>(category => {
    setSlots(previous => previous.map(row => row.id === category.id ? category : row));
    setName(category.name);
    changed();
    toast.success('Kategori disimpan / 分类已保存');
  });

  return <InventoryDialog title="Kategori / 分类" busy={busy} close={close}>
    <form onSubmit={event => save(event, { action: 'category', id, revision: slot?.revision ?? 0, name })}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="inventory-slot">Nomor kategori / 分类编号</FieldLabel>
          <NativeSelect id="inventory-slot" value={id} disabled={busy} onChange={event => {
            const next = Number(event.target.value);
            setId(next);
            setName(slots.find(category => category.id === next)?.name ?? '');
            clearError();
          }}>
            {slots.map(category => <NativeSelectOption key={category.id} value={category.id}>
              {category.id} · {category.name || blank}
            </NativeSelectOption>)}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor="inventory-category-name">Nama kategori / 分类名称</FieldLabel>
          <Input id="inventory-category-name" maxLength={80} value={name} disabled={busy}
            onChange={event => setName(event.target.value)} />
        </Field>
        <ErrorMessage message={error} />
        <SaveButtons busy={busy} close={close} disabled={name.trim() === (slot?.name ?? '')} closeLabel="Tutup / 关闭" />
      </FieldGroup>
    </form>
  </InventoryDialog>;
}

function ProductEditor({ categories, close, saved }: {
  categories: InventoryCategory[]; close: () => void; saved: () => void;
}) {
  const [token] = useState(() => crypto.randomUUID());
  const { busy, error, save } = useSave<{ id: number }>(saved);
  const named = categories.filter(category => category.name);
  return <InventoryDialog title="Tambah produk / 添加商品" busy={busy} close={close}>
    <form onSubmit={event => {
      const values = new FormData(event.currentTarget);
      return save(event, {
        action: 'product', token, name: values.get('name'), categoryId: Number(values.get('category')),
        salesPrice: Number(values.get('salesPrice')),
      });
    }}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="inventory-product-name">Nama barang / 商品名称</FieldLabel>
          <Input id="inventory-product-name" name="name" maxLength={200} required />
        </Field>
        <Field>
          <FieldLabel htmlFor="inventory-product-category">Kategori / 分类</FieldLabel>
          <NativeSelect id="inventory-product-category" name="category" required defaultValue="" disabled={!named.length}>
            <NativeSelectOption value="">{named.length ? 'Pilih kategori / 选择分类' : 'Belum ada kategori / 暂无分类'}</NativeSelectOption>
            {named.map(category => <NativeSelectOption key={category.id} value={category.id}>{category.id} · {category.name}</NativeSelectOption>)}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor="inventory-product-price">Harga jual (Rp) / 售价（印尼盾）</FieldLabel>
          <Input id="inventory-product-price" name="salesPrice" type="number" min={0} max={maxSalesPrice} step={1} required />
        </Field>
        <ErrorMessage message={error} />
        <SaveButtons busy={busy} close={close} disabled={!named.length} />
      </FieldGroup>
    </form>
  </InventoryDialog>;
}

function useMovementData<T>(params: Record<string, string>) {
  const query = new URLSearchParams(params).toString();
  const [result, setResult] = useState<{ query: string; data: T | null; error: string }>();
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(movementEndpoint + '?' + query, { signal: controller.signal, cache: 'no-store' });
        const data = await response.json() as T & { error?: string };
        if (!response.ok) throw new Error(data.error ?? 'Gagal memuat catatan I/O / 无法加载出入库记录');
        if (!controller.signal.aborted) setResult({ query, data, error: '' });
      } catch (error) {
        if (!controller.signal.aborted) setResult({ query, data: null, error: (error as Error).message });
      }
    }, 120);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query]);
  return result?.query === query ? { ...result, loading: false } : { data: null, error: '', loading: true };
}

type ProductOption = Pick<InventoryProduct, 'id' | 'name'>;
type MovementOptions = { products: ProductOption[]; banks: { id: string; name: string }[] };

function MovementEditor({ direction, close, saved }: { direction: MovementDirection; close: () => void; saved: () => void }) {
  const [token] = useState(() => crypto.randomUUID());
  const [search, setSearch] = useState('');
  const [product, setProduct] = useState<ProductOption | null>(null);
  const [bankId, setBankId] = useState('');
  const options = useMovementData<MovementOptions>({ view: 'options', search });
  const products = options.data?.products ?? [];
  const banks = options.data?.banks ?? [];
  const choices = product && !products.some(row => row.id === product.id) ? [product, ...products] : products;
  const { busy, error, save } = useSave<{ id: number }>(saved, movementEndpoint);
  return <InventoryDialog title={movementLabels[direction]} busy={busy} close={close}>
    <form onSubmit={event => {
      const values = new FormData(event.currentTarget);
      return save(event, {
        token, direction, productId: product?.id, bankId,
        quantity: Number(values.get('quantity')), payment: Number(values.get('payment')),
      });
    }}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="movement-search">Cari barang / 搜索商品</FieldLabel>
          <Input id="movement-search" value={search} maxLength={150} onChange={event => setSearch(event.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="movement-product">Nama barang / 商品名称</FieldLabel>
          <NativeSelect id="movement-product" required value={product?.id ?? ''}
            onChange={event => setProduct(choices.find(row => row.id === Number(event.target.value)) ?? null)}>
            <NativeSelectOption value="">{options.loading ? 'Memuat / 加载中…' :
              choices.length ? 'Pilih barang / 选择商品' : 'Barang tidak ditemukan / 未找到商品'}</NativeSelectOption>
            {choices.map(row => <NativeSelectOption key={row.id} value={row.id}>{row.id} · {row.name}</NativeSelectOption>)}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor="movement-qty">Qty / 数量</FieldLabel>
          <Input id="movement-qty" name="quantity" type="number" min={1} max={maxInventoryQuantity} step={1} required />
        </Field>
        <Field>
          <FieldLabel htmlFor="movement-payment">Total pembayaran (Rp) / 付款总额（印尼盾）</FieldLabel>
          <Input id="movement-payment" name="payment" type="number" min={1} max={maxTransactionAmount} step={1} required />
        </Field>
        <Field>
          <FieldLabel htmlFor="movement-bank">Rekening / 银行账户</FieldLabel>
          <NativeSelect id="movement-bank" required value={bankId} disabled={options.loading}
            onChange={event => setBankId(event.target.value)}>
            <NativeSelectOption value="">{options.loading ? 'Memuat / 加载中…' :
              banks.length ? 'Pilih rekening / 选择银行账户' : 'Belum ada rekening bank / 暂无银行账户'}</NativeSelectOption>
            {banks.map(bank => <NativeSelectOption key={bank.id} value={bank.id}>{bank.name}</NativeSelectOption>)}
          </NativeSelect>
        </Field>
        <ErrorMessage message={options.error || error} />
        <SaveButtons busy={busy} close={close} disabled={!product || !bankId || options.loading} />
      </FieldGroup>
    </form>
  </InventoryDialog>;
}

function MovementHistory({ close }: { close: () => void }) {
  const [page, setPage] = useState(1);
  const { data, error, loading } = useMovementData<{ rows: InventoryMovement[]; total: number; page: number }>({ page: String(page) });
  const currentPage = data?.page ?? page;
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / inventoryPageSize));
  const columns = ['Tgl dicatat / 录入日期', 'Jenis / 类型', 'Nama barang / 商品名称', 'Qty / 数量',
    'Total pembayaran / 付款总额', 'Rekening / 银行账户', 'Dicatat oleh / 录入人'];
  return <Dialog open onOpenChange={open => { if (!open) close(); }}>
    <DialogContent className="student-editor" showCloseButton={false} aria-describedby={undefined}>
      <DialogHeader><DialogTitle>Catatan I/O / 出入库记录</DialogTitle></DialogHeader>
      <ErrorMessage message={error} />
      <Table>
        <TableHeader><TableRow>{columns.map(label => <TableHead key={label} scope="col">{label}</TableHead>)}</TableRow></TableHeader>
        <TableBody>
          {loading || !data?.rows.length ? <TableRow><TableCell colSpan={columns.length}>
            {loading ? 'Memuat / 加载中…' : error ? '—' : 'Belum ada catatan / 暂无记录'}
          </TableCell></TableRow> : data.rows.map(row => <TableRow key={
            row.purchaseId === null ? 'movement-' + row.id : ['purchase', row.purchaseId, row.direction, row.productId].join('-')
          }>
            <TableCell>{movementDateFormat.format(new Date(row.recordedAt))}</TableCell>
            <TableCell>
              {movementLabels[row.direction]}
              {row.purchaseId !== null && <div className="text-xs text-muted-foreground">
                {row.direction === 'in' ? 'Pembatalan pembelian / 商品付款冲销' : 'Pembayaran pembelian / 商品付款'}
                {' · ' + paymentCode(row.purchaseId)}
              </div>}
            </TableCell>
            <TableCell>{row.productId} · {row.product}</TableCell>
            <TableCell>{numberFormat.format(row.quantity)}</TableCell>
            <TableCell>{currency.format(row.payment)}</TableCell>
            <TableCell>{row.bank}</TableCell>
            <TableCell>{row.recordedBy}</TableCell>
          </TableRow>)}
        </TableBody>
      </Table>
      {pages > 1 && <nav aria-label="Halaman catatan I/O / 出入库记录页码" className="flex flex-wrap items-center justify-between gap-2">
        <span>Halaman / 页 {currentPage} / {pages}</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={loading || currentPage <= 1}
            onClick={() => setPage(currentPage - 1)}>Sebelumnya / 上一页</Button>
          <Button variant="outline" size="sm" disabled={loading || currentPage >= pages}
            onClick={() => setPage(currentPage + 1)}>Berikutnya / 下一页</Button>
        </div>
      </nav>}
      <DialogFooter><Button variant="outline" onClick={close}>Tutup / 关闭</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

export default function InventoryWorkspace({ role }: { role: string }) {
  const [result, setResult] = useState<InventoryPage>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [editor, setEditor] = useState<'category' | 'product' | 'history' | MovementDirection | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ search, page: String(page) });
        const response = await fetch('/api/inventory?' + params, { signal: controller.signal, cache: 'no-store' });
        const data = await response.json() as InventoryPage & { error?: string };
        if (!response.ok) throw new Error(data.error);
        if (!controller.signal.aborted) setResult(data);
      } catch (error) {
        if (!controller.signal.aborted) setError((error as Error).message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 150);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [page, search, reload]);

  const pages = Math.max(1, Math.ceil((result?.total ?? 0) / inventoryPageSize));
  const currentPage = result?.page ?? 1;
  const refresh = () => setReload(value => value + 1);
  return <main className="workspace student-workspace">
    <div className="page-heading">
      <h1>Inventaris<span className="zh" lang="zh-Hans">库存</span></h1>
      <div className="heading-actions flex-wrap">
        {role === 'supervisor' && <Button variant="outline" disabled={!result} onClick={() => setEditor('category')}>
          <Tags data-icon="inline-start" />Kategori / 分类
        </Button>}
        {canAddInventory(role) && <Button disabled={!result} onClick={() => setEditor('product')}>
          <Plus data-icon="inline-start" />Tambah produk / 添加商品
        </Button>}
        {canAddInventory(role) && <>
          <Button variant="outline" onClick={() => setEditor('in')}><ArrowDownToLine data-icon="inline-start" />{movementLabels.in}</Button>
          <Button variant="outline" onClick={() => setEditor('out')}><ArrowUpFromLine data-icon="inline-start" />{movementLabels.out}</Button>
          <Button variant="outline" onClick={() => setEditor('history')}><History data-icon="inline-start" />Catatan I/O / 出入库记录</Button>
        </>}
      </div>
    </div>
    <ErrorMessage message={error} />
    <Card className="users-card student-table">
      <CardContent>
        <div className="filters pt-4">
          <Input value={search} maxLength={150} aria-label="Cari barang / 搜索商品" placeholder="Cari barang / 搜索商品"
            onChange={event => { setSearch(event.target.value); setPage(1); }} />
        </div>
        <Table>
          <TableHeader><TableRow>{labels.map(label => <TableHead key={label} scope="col">{label}</TableHead>)}</TableRow></TableHeader>
          <TableBody>
            {loading || error || !result?.rows.length ? <TableRow><TableCell colSpan={labels.length}>
              <div className="table-state">{loading ? 'Memuat / 加载中…' : error ? '—' : 'Belum ada barang / 暂无商品'}</div>
            </TableCell></TableRow> : result.rows.map(row => <TableRow key={row.id}>
              <TableCell>{row.id}</TableCell>
              <TableCell>{row.name}</TableCell>
              <TableCell>{row.category}</TableCell>
              <TableCell>{currency.format(row.salesPrice)}</TableCell>
              <TableCell>{numberFormat.format(row.quantity)}</TableCell>
              <TableCell>{row.createdAt ? dateFormat.format(new Date(row.createdAt)) : '—'}</TableCell>
              <TableCell>{row.recordedBy ?? '—'}</TableCell>
            </TableRow>)}
          </TableBody>
        </Table>
      </CardContent>
      <CardFooter>
        <p>Halaman / 页 {currentPage} / {pages}</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={loading || currentPage <= 1}
            onClick={() => setPage(currentPage - 1)}>Sebelumnya / 上一页</Button>
          <Button variant="outline" size="sm" disabled={loading || currentPage >= pages}
            onClick={() => setPage(currentPage + 1)}>Berikutnya / 下一页</Button>
        </div>
      </CardFooter>
    </Card>
    {editor === 'category' && result && <CategoryEditor categories={result.categories} close={() => setEditor(null)} changed={refresh} />}
    {editor === 'product' && result && <ProductEditor categories={result.categories} close={() => setEditor(null)} saved={() => {
      setEditor(null);
      setPage(1);
      setSearch('');
      refresh();
      toast.success('Produk disimpan / 商品已保存');
    }} />}
    {(editor === 'in' || editor === 'out') && <MovementEditor direction={editor} close={() => setEditor(null)} saved={() => {
      setEditor(null);
      refresh();
      toast.success('Catatan I/O disimpan / 出入库记录已保存');
    }} />}
    {editor === 'history' && <MovementHistory close={() => setEditor(null)} />}
  </main>;
}
