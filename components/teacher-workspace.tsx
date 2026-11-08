"use client";

import { useEffect, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, BookOpen, LoaderCircle, Pencil, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { getClassData } from '@/components/class-forms';
import { classPageSize, type TeacherClassHistoryPage } from '@/lib/class-fields';
import { chineseNameError, chineseNamePattern } from '@/lib/chinese-input';
import { todayJakarta } from '@/lib/student-fields';
import {
  canEditTeachers, teacherColumns, teacherFields, teacherPageLabel, teacherPageSize,
  type Teacher, type TeacherProfile,
} from '@/lib/teacher-fields';

type Draft = TeacherProfile & { id?: number; revision?: number };
type ListResult = { rows: Teacher[]; total: number; page: number; error?: string };
const dateFormat = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium' });

function TeacherClassSection({ teacherId, period }: { teacherId: number; period: 'current' | 'previous' }) {
  const title = period === 'current' ? 'Kelas saat ini / 当前班级' : 'Kelas sebelumnya / 以往班级';
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ requested: number; data?: TeacherClassHistoryPage; error?: string }>();
  useEffect(() => {
    const controller = new AbortController();
    getClassData<TeacherClassHistoryPage>({
      view: 'teacher-history', teacher: String(teacherId), period, page: String(page),
    }, controller.signal)
      .then(data => { if (!controller.signal.aborted) setResult({ requested: page, data }); })
      .catch(error => { if (!controller.signal.aborted) setResult({ requested: page, error: error.message }); });
    return () => controller.abort();
  }, [teacherId, period, page]);
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

function TeacherClasses({ teacherId }: { teacherId: number }) {
  return <div className="flex flex-col gap-3">
    <TeacherClassSection teacherId={teacherId} period="current" />
    <TeacherClassSection teacherId={teacherId} period="previous" />
  </div>;
}

export default function TeacherWorkspace({ role }: { role: string }) {
  const canEdit = canEditTeachers(role);
  const fields = teacherFields.filter(([key]) => key !== 'nik' || role === 'supervisor');
  const columns = teacherColumns.filter(([key]) => key !== 'nik' || role === 'supervisor');
  const columnCount = columns.length + (canEdit ? 2 : 1);
  const [result, setResult] = useState<ListResult>({ rows: [], total: 0, page: 1 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('nameId');
  const [direction, setDirection] = useState<'asc' | 'desc'>('asc');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [historyTeacher, setHistoryTeacher] = useState<Teacher | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ page: String(page), search, sort, direction });
    const timer = setTimeout(async () => {
      try {
        const response = await fetch('/api/teachers?' + params, { signal: controller.signal, cache: 'no-store' });
        const data: ListResult = await response.json();
        if (!response.ok) throw new Error(data.error);
        if (!controller.signal.aborted) setResult(data);
      } catch (error) {
        if (!controller.signal.aborted) setError((error as Error).message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [page, search, sort, direction, reload]);

  function changeSort(key: string) {
    setDirection(sort === key && direction === 'asc' ? 'desc' : 'asc');
    setSort(key);
    setPage(1);
  }

  function openEditor(teacher?: Teacher) {
    const profile: Draft = {
      nameId: '', nameZh: '', birthdate: '', phone: '', address: '', city: '',
      registeredDate: todayJakarta(),
    };
    if (role === 'supervisor') profile.nik = '';
    if (teacher) {
      for (const [key] of fields) profile[key] = teacher[key] ?? '';
      profile.id = teacher.id;
      profile.revision = teacher.revision;
    }
    setEditError('');
    setDraft(profile);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft || saving) return;
    setSaving(true);
    setEditError('');
    try {
      const response = await fetch('/api/teachers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      if (!response.ok) {
        const data: { error?: string } = await response.json();
        throw new Error(data.error ?? 'Gagal menyimpan data guru / 无法保存教师资料');
      }
      setDraft(null);
      setReload(value => value + 1);
      toast.success('Data guru disimpan / 教师资料已保存');
    } catch (error) {
      setEditError((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const pageCount = Math.max(1, Math.ceil(result.total / teacherPageSize));
  const today = todayJakarta();

  return (
    <main className="workspace student-workspace">
      <div className="page-heading">
        <h1>Data guru<span className="zh" lang="zh-Hans">教师资料</span></h1>
        {canEdit && <div className="heading-actions">
          <Button onClick={() => openEditor()}><Plus data-icon="inline-start" />Tambah guru / 添加教师</Button>
        </div>}
      </div>
      <Card className="users-card student-table">
        <CardHeader><CardTitle>{teacherPageLabel}</CardTitle></CardHeader>
        <CardContent>
          <div className="filters">
            <Input
              aria-label="Cari guru / 搜索教师" placeholder="Cari guru / 搜索教师" value={search}
              onChange={event => { setSearch(event.target.value); setPage(1); }}
            />
          </div>
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          <Table>
            <TableHeader>
              <TableRow>
                {canEdit && <TableHead><span className="sr-only">Edit / 编辑</span></TableHead>}
                <TableHead><span className="sr-only">Riwayat kelas / 课程记录</span></TableHead>
                {columns.map(([key, label]) => {
                  const active = sort === key;
                  const SortIcon = active ? (direction === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
                  return (
                    <TableHead key={key} aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
                      <Button variant="ghost" size="sm" onClick={() => changeSort(key)}>
                        {label}<SortIcon data-icon="inline-end" />
                      </Button>
                    </TableHead>
                  );
                })}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && <TableRow><TableCell colSpan={columnCount}>
                <div className="table-state"><LoaderCircle className="animate-spin" />Memuat / 加载中…</div>
              </TableCell></TableRow>}
              {!loading && !error && (result.rows.length ? result.rows.map(teacher => (
                <TableRow key={teacher.id}>
                  {canEdit && <TableCell>
                    <Button variant="ghost" size="icon-sm" title="Edit / 编辑"
                      aria-label={`Edit ${teacher.nameId} / 编辑`} onClick={() => openEditor(teacher)}>
                      <Pencil />
                    </Button>
                  </TableCell>}
                  <TableCell>
                    <Button variant="ghost" size="icon-sm" title="Riwayat kelas / 课程记录"
                      aria-label={`Riwayat kelas ${teacher.nameId} / 课程记录`}
                      onClick={() => setHistoryTeacher(teacher)}>
                      <BookOpen />
                    </Button>
                  </TableCell>
                  {columns.map(([key]) => {
                    const value = teacher[key];
                    const text = value && (key === 'birthdate' || key === 'registeredDate')
                      ? dateFormat.format(new Date(value + 'T00:00:00+07:00'))
                      : String(value ?? '') || '—';
                    return <TableCell key={key} className={key === 'address' ? 'long-cell' : undefined}>{text}</TableCell>;
                  })}
                </TableRow>
              )) : <TableRow><TableCell colSpan={columnCount}>
                <div className="no-results">Tidak ada data guru / 暂无教师资料</div>
              </TableCell></TableRow>)}
            </TableBody>
          </Table>
        </CardContent>
        <CardFooter>
          <p>{result.total} guru / 位教师 · Halaman / 页 {result.page} / {pageCount}</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={loading || !!error || result.page <= 1}
              onClick={() => setPage(result.page - 1)}>Sebelumnya / 上一页</Button>
            <Button variant="outline" size="sm" disabled={loading || !!error || result.page >= pageCount}
              onClick={() => setPage(result.page + 1)}>Berikutnya / 下一页</Button>
          </div>
        </CardFooter>
      </Card>

      <Dialog open={!!draft} onOpenChange={open => { if (!open && !saving) setDraft(null); }}>
        <DialogContent className="student-editor" showCloseButton={false} aria-describedby={undefined}>
          <DialogHeader><DialogTitle>{draft?.id ? 'Edit guru / 编辑教师' : 'Tambah guru / 添加教师'}</DialogTitle></DialogHeader>
          {draft && <form onSubmit={save}>
            <FieldGroup>
              <FieldGroup className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {fields.map(([key, label]) => {
                  const id = 'teacher-' + key;
                  const date = key === 'birthdate' || key === 'registeredDate';
                  const update = (value: string) => setDraft({ ...draft, [key]: value });
                  return <Field key={key} className={key === 'address' ? 'sm:col-span-2' : undefined}>
                    <FieldLabel htmlFor={id}>{label}</FieldLabel>
                    {key === 'address'
                      ? <Textarea id={id} value={draft.address} maxLength={2000} rows={3}
                          onChange={event => update(event.target.value)} />
                      : <Input id={id} value={draft[key] ?? ''} required={key === 'nameId' || key === 'registeredDate'}
                          type={date ? 'date' : key === 'phone' ? 'tel' : 'text'} max={date ? today : undefined}
                          inputMode={key === 'nik' ? 'numeric' : undefined} maxLength={key === 'nik' ? 16 : 200}
                          pattern={key === 'nik' ? '[0-9]{16}' : key === 'nameZh' ? chineseNamePattern : undefined}
                          title={key === 'nameZh' ? chineseNameError : undefined}
                          onChange={event => update(event.target.value)} />}
                  </Field>;
                })}
              </FieldGroup>
              {editError && <Alert variant="destructive"><AlertDescription>{editError}</AlertDescription></Alert>}
              <DialogFooter>
                <Button type="button" variant="outline" disabled={saving} onClick={() => setDraft(null)}>Batal / 取消</Button>
                <Button type="submit" disabled={saving}>
                  {saving && <LoaderCircle className="animate-spin" data-icon="inline-start" />}Simpan / 保存
                </Button>
              </DialogFooter>
            </FieldGroup>
          </form>}
        </DialogContent>
      </Dialog>

      <Dialog open={!!historyTeacher} onOpenChange={open => { if (!open) setHistoryTeacher(null); }}>
        <DialogContent showCloseButton={false} aria-describedby={undefined}>
          <DialogHeader><DialogTitle>Riwayat kelas / 课程记录 · {historyTeacher?.nameId} {historyTeacher?.nameZh}</DialogTitle></DialogHeader>
          {historyTeacher && <TeacherClasses key={historyTeacher.id} teacherId={historyTeacher.id} />}
          <DialogFooter><Button variant="outline" onClick={() => setHistoryTeacher(null)}>Tutup / 关闭</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
