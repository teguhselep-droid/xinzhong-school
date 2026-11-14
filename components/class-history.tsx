"use client";

import { useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getClassData } from '@/components/class-forms';
import { classPageSize, type ClassHistoryPage } from '@/lib/class-fields';

type HistorySubject = { kind: 'student' | 'teacher'; id: number };

function ClassHistorySection({ kind, id, period }: HistorySubject & { period: 'current' | 'previous' }) {
  const title = period === 'current' ? 'Kelas saat ini / 当前班级' : 'Kelas sebelumnya / 以往班级';
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ requested: number; data?: ClassHistoryPage; error?: string }>();
  useEffect(() => {
    const controller = new AbortController();
    getClassData<ClassHistoryPage>({
      view: kind + '-history', [kind]: String(id), period, page: String(page),
    }, controller.signal)
      .then(data => { if (!controller.signal.aborted) setResult({ requested: page, data }); })
      .catch(error => { if (!controller.signal.aborted) setResult({ requested: page, error: error.message }); });
    return () => controller.abort();
  }, [kind, id, period]);
  const loading = result?.requested !== page;
  const data = result?.data;
  const pageCount = Math.ceil((data?.total ?? 0) / classPageSize);
  return <section aria-label={title} className="flex flex-col gap-2 rounded-md border p-3">
    <h3 className="font-medium">{title}</h3>
    {!loading && result?.error
      ? <Alert variant="destructive"><AlertDescription>{result.error}</AlertDescription></Alert>
      : <Table>
        <TableHeader><TableRow>
          <TableHead scope="col">ID kelas / 班级编号</TableHead>
          <TableHead scope="col">Nama kelas / 班级名称</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {loading || !data?.rows.length ? <TableRow><TableCell colSpan={2}>
            {loading ? 'Memuat / 加载中…' : '—'}
          </TableCell></TableRow> : data.rows.map(row => <TableRow key={row.id}>
            <TableCell>{row.code}</TableCell>
            <TableCell className="whitespace-normal break-words">
              <a className="underline" href={'/class-details?' + new URLSearchParams({ class: row.id })}>{row.name}</a>
            </TableCell>
          </TableRow>)}
        </TableBody>
      </Table>}
    {data && pageCount > 1 && <nav aria-label={title} className="flex flex-wrap items-center justify-between gap-2">
      <span>Halaman / 页 {data.page} / {pageCount}</span>
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" disabled={loading || data.page <= 1}
          onClick={() => setPage(data.page - 1)}>Sebelumnya / 上一页</Button>
        <Button type="button" variant="outline" size="sm" disabled={loading || data.page >= pageCount}
          onClick={() => setPage(data.page + 1)}>Berikutnya / 下一页</Button>
      </div>
    </nav>}
  </section>;
}

export default function ClassHistory(subject: HistorySubject) {
  return <div className="flex flex-col gap-3">
    <ClassHistorySection {...subject} period="current" />
    <ClassHistorySection {...subject} period="previous" />
  </div>;
}
