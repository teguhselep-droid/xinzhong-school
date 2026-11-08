"use client";

import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, BookOpen, ClipboardPenLine, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AddMeetingDialog, ClassEditor, classDate, classHours, getClassData, MeetingEditor, saveClassData } from '@/components/class-forms';
import {
  canManageClasses, classPageSize, classPages, type AttendanceEntry, type AttendanceRecord,
  type ClassDay, type ClassRow, type ClassTeacher, type Enrollment,
} from '@/lib/class-fields';

type Detail = { group: ClassRow; days: ClassDay[]; roster: Enrollment[] };
type Meeting = { day: ClassDay; roster: AttendanceEntry[] };
type Page<T> = { rows: T[]; total: number; page: number };
const detailLink = (id: string) => '/class-details?' + new URLSearchParams({ class: id });
const recordsLink = (id: string, day?: string, entry = false) => '/class-records?' +
  new URLSearchParams({ class: id, ...(day ? { day } : {}), ...(entry ? { entry: '1' } : {}) });
const empty = 'Belum ada data / 暂无资料';
const loadingText = 'Memuat / 加载中…';

function useClassData<T>(params: Record<string, string> | null, reload = 0) {
  const key = params ? JSON.stringify(params) : '';
  const [result, setResult] = useState<{ key: string; reload: number; data: T | null; error: string }>();
  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      getClassData<T>(JSON.parse(key), controller.signal)
        .then(data => { if (!controller.signal.aborted) setResult({ key, reload, data, error: '' }); })
        .catch(error => { if (!controller.signal.aborted) setResult({ key, reload, data: null, error: error.message }); });
    }, 100);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [key, reload]);
  return result?.key === key && result.reload === reload ? result : { data: null, error: '' };
}

function ErrorMessage({ message }: { message: string }) {
  return message ? <Alert variant="destructive"><AlertDescription>{message}</AlertDescription></Alert> : null;
}

function ClassTable({ labels, children, status }: { labels: string[]; children?: ReactNode; status?: string }) {
  return <Table>
    <TableHeader><TableRow>{labels.map((label, index) => <TableHead key={label || index} scope="col">
      {label.startsWith('!') ? <span className="sr-only">{label.slice(1)}</span> : label}
    </TableHead>)}</TableRow></TableHeader>
    <TableBody>{status ? <TableRow><TableCell colSpan={labels.length}><div className="table-state">{status}</div></TableCell></TableRow> : children}</TableBody>
  </Table>;
}

function Pagination({ result, change }: { result: Page<unknown> | null; change: (page: number) => void }) {
  const page = result?.page ?? 1;
  const pages = Math.max(1, Math.ceil((result?.total ?? 0) / classPageSize));
  return <CardFooter>
    <p>Halaman / 页 {page} / {pages}</p>
    <div className="flex gap-2">
      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => change(page - 1)}>Sebelumnya / 上一页</Button>
      <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => change(page + 1)}>Berikutnya / 下一页</Button>
    </div>
  </CardFooter>;
}

function Heading({ view, children }: { view: keyof typeof classPages; children?: ReactNode }) {
  const [id, zh] = classPages[view].split(' / ');
  return <div className="page-heading">
    <h1>{id}<span className="zh" lang="zh-Hans">{zh}</span></h1>
    {children && <div className="heading-actions">{children}</div>}
  </div>;
}

function SearchBox({ search, change }: { search: string; change: (search: string) => void }) {
  return <div className="filters pt-4">
    <Input value={search} onChange={event => change(event.target.value)} maxLength={150}
      aria-label="Cari / 搜索" placeholder="Cari / 搜索" />
  </div>;
}

function ClassList({ manager }: { manager: boolean }) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [editor, setEditor] = useState<'new' | ClassRow | null>(null);
  const list = useClassData<Page<ClassRow>>({ search, page: String(page) }, reload);
  const teachers = useClassData<ClassTeacher[]>(editor ? { view: 'teachers' } : null);
  const detail = useClassData<Detail>(editor && editor !== 'new' ? { view: 'detail', class: editor.id } : null, reload);
  const error = list.error || teachers.error || detail.error;
  return <>
    <Heading view="classes">{manager && <Button onClick={() => setEditor('new')}>
      <Plus data-icon="inline-start" />Tambah kelas / 添加班级
    </Button>}</Heading>
    <ErrorMessage message={error} />
    <Card className="users-card student-table">
      <CardContent>
        <SearchBox search={search} change={value => { setSearch(value); setPage(1); }} />
        <ClassTable labels={[
          ...(manager ? ['!Edit / 编辑'] : []), '!Detail kelas / 班级详情', 'ID kelas / 班级编号', 'Nama kelas / 班级名称',
          'Guru default / 默认教师', 'Lokasi / 地点', 'Tgl mulai / 开始日期', 'Tgl selesai / 结束日期',
          'Jumlah hari kelas / 课次数', 'Jumlah Murid / 报名人数', 'Jumlah Kehadiran Terbaru / 最近出勤人数',
          'Tgl dicatat / 登记日期', 'Dicatat oleh / 登记人',
        ]} status={list.error ? empty : !list.data ? loadingText : !list.data.rows.length ? empty : undefined}>
          {list.data?.rows.map(group => <TableRow key={group.id}>
            {manager && <TableCell><Button variant="ghost" size="icon-sm" title="Edit / 编辑"
              aria-label={'Edit ' + group.name + ' / 编辑'} onClick={() => setEditor(group)}><Pencil /></Button></TableCell>}
            <TableCell><Button asChild variant="ghost" size="icon-sm">
              <a href={detailLink(group.id)} title="Detail kelas / 班级详情"
                aria-label={'Detail ' + group.name + ' / 班级详情'}><BookOpen /></a>
            </Button></TableCell>
            <TableCell>{group.code}</TableCell><TableCell>{group.name}</TableCell>
            <TableCell>{group.teacher}</TableCell><TableCell>{group.location}</TableCell>
            <TableCell>{classDate(group.start)}</TableCell><TableCell>{classDate(group.finish)}</TableCell>
            <TableCell>{group.dayCount}</TableCell><TableCell>{group.studentCount}</TableCell>
            <TableCell>{group.latestAttendance ?? '—'}</TableCell>
            <TableCell>{classDate(group.createdAt)}</TableCell><TableCell>{group.recordedBy ?? '—'}</TableCell>
          </TableRow>)}
        </ClassTable>
      </CardContent>
      <Pagination result={list.data} change={setPage} />
    </Card>
    {editor && teachers.data && (editor === 'new' || detail.data) && <ClassEditor
      group={editor === 'new' ? undefined : detail.data?.group} roster={detail.data?.roster ?? []} teachers={teachers.data}
      close={() => setEditor(null)} saved={() => {
        setEditor(null);
        setReload(value => value + 1);
        toast.success('Kelas disimpan / 班级已保存');
      }} />}
  </>;
}

function ClassDetail({ id, manager }: { id: string; manager: boolean }) {
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState<ClassDay | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<ClassDay | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState('');
  const detail = useClassData<Detail>({ view: 'detail', class: id }, reload);
  const teachers = useClassData<ClassTeacher[]>(editing ? { view: 'teachers' } : null);
  const group = detail.data?.group;
  function refreshSchedule(message: string) {
    setReload(value => value + 1);
    toast.success(message);
  }
  async function removeMeeting() {
    if (!removing || removeBusy) return;
    setRemoveBusy(true);
    setRemoveError('');
    try {
      await saveClassData({ action: 'remove-day', classId: id, id: removing.id, revision: removing.revision });
      setRemoving(null);
      refreshSchedule('Jadwal dihapus / 课次已删除');
    } catch (error) {
      setRemoveError((error as Error).message);
    } finally {
      setRemoveBusy(false);
    }
  }
  return <>
    <Heading view="detail">
      <Button asChild variant="outline"><a href="/classes"><ArrowLeft data-icon="inline-start" />Data Kelas / 班级资料</a></Button>
      {group && <Button asChild variant="outline"><a href={recordsLink(group.id)}>Record Kelas / 课堂记录</a></Button>}
      {manager && group && <Button onClick={() => setAdding(true)}><Plus data-icon="inline-start" />Tambah jadwal / 添加课次</Button>}
    </Heading>
    <ErrorMessage message={detail.error || teachers.error} />
    {group && <h2 className="mb-3 text-base font-semibold text-white">{group.code} · {group.name}</h2>}
    <Card className="users-card student-table">
      <CardContent>
        <ClassTable labels={[
          '!Aksi / 操作', 'ID hari kelas / 课次编号', 'Tanggal / 日期', 'Jam / 时间', 'Jumlah jam / 小时数',
          'Guru / 教师', 'Lokasi / 地点', 'Jumlah kehadiran / 出勤人数',
        ]} status={detail.error ? empty : !group ? loadingText : !detail.data?.days.length ? empty : undefined}>
          {group && detail.data?.days.map(day => <TableRow key={day.id}>
            <TableCell><div className="flex gap-1">
              {manager && !day.recordedAt && <Button variant="ghost" size="icon-sm" onClick={() => setEditing(day)}
                title="Edit jadwal / 编辑课次" aria-label={'Edit jadwal ' + day.code + ' / 编辑课次'}><Pencil /></Button>}
              {day.canRemove && <Button variant="ghost" size="icon-sm" onClick={() => { setRemoveError(''); setRemoving(day); }}
                title="Hapus jadwal / 删除课次" aria-label={'Hapus jadwal ' + day.code + ' / 删除课次'}><Trash2 /></Button>}
              {day.canRecord && <Button asChild variant="ghost" size="icon-sm">
                <a href={recordsLink(group.id, day.id, true)} title="Catat kelas / 记录课堂"
                  aria-label={'Catat kelas ' + day.code + ' / 记录课堂'}><ClipboardPenLine /></a>
              </Button>}
              {day.recordedAt && <Button asChild variant="ghost" size="icon-sm">
                <a href={recordsLink(group.id, day.id)} title="Lihat record / 查看记录"
                  aria-label={'Lihat record ' + day.code + ' / 查看记录'}><BookOpen /></a>
              </Button>}
            </div></TableCell>
            <TableCell>{day.code}</TableCell><TableCell>{classDate(day.date)}</TableCell><TableCell>{day.time}</TableCell>
            <TableCell>{classHours(day.minutes)}</TableCell><TableCell>{day.teacher}</TableCell>
            <TableCell>{day.location}</TableCell><TableCell>{day.attendance ?? '—'}</TableCell>
          </TableRow>)}
        </ClassTable>
      </CardContent>
    </Card>
    {editing && group && teachers.data && <MeetingEditor group={group} day={editing} teachers={teachers.data}
      close={() => setEditing(null)} saved={() => {
        setEditing(null);
        refreshSchedule('Jadwal disimpan / 课次已保存');
      }} />}
    {adding && <AddMeetingDialog classId={id} close={() => setAdding(false)} saved={() => {
      setAdding(false);
      refreshSchedule('Jadwal ditambahkan / 课次已添加');
    }} />}
    {removing && <AlertDialog open onOpenChange={open => { if (!open && !removeBusy) setRemoving(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Hapus jadwal? / 删除课次？</AlertDialogTitle>
          <AlertDialogDescription>{removing.code} · {classDate(removing.date)} · {removing.time}</AlertDialogDescription>
        </AlertDialogHeader>
        <ErrorMessage message={removeError} />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={removeBusy}>Batal / 取消</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={removeBusy} onClick={event => {
            event.preventDefault();
            void removeMeeting();
          }}>Hapus / 删除</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>}
  </>;
}

function ClassRecords({ params }: { params: URLSearchParams }) {
  const groupId = params.get('class') ?? '';
  const dayId = params.get('day') ?? '';
  const [editing, setEditing] = useState(params.get('entry') === '1');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const records = useClassData<Page<AttendanceRecord>>({ view: 'records', class: groupId, day: dayId, search, page: String(page) }, reload);
  const detail = useClassData<Detail>(groupId ? { view: 'detail', class: groupId } : null, reload);
  const meeting = useClassData<Meeting>(editing && dayId ? { view: 'meeting', class: groupId, day: dayId } : null, reload);
  const teachers = useClassData<ClassTeacher[]>(editing ? { view: 'teachers' } : null);
  const day = detail.data?.days.find(day => day.id === dayId);
  return <>
    <Heading view="records">
      <Button asChild variant="outline"><a href={groupId ? detailLink(groupId) : '/classes'}>
        <ArrowLeft data-icon="inline-start" />{groupId ? 'Detail Kelas / 班级详情' : 'Data Kelas / 班级资料'}
      </a></Button>
      {day?.canRecord && <Button onClick={() => setEditing(true)}>
        <ClipboardPenLine data-icon="inline-start" />Catat kelas / 记录课堂
      </Button>}
    </Heading>
    {detail.data && <h2 className="mb-3 text-base font-semibold text-white">
      {day?.code ?? detail.data.group.code} · {detail.data.group.name}
    </h2>}
    <ErrorMessage message={records.error || detail.error || meeting.error || teachers.error} />
    <Card className="users-card student-table">
      <CardContent>
        <SearchBox search={search} change={value => { setSearch(value); setPage(1); }} />
        <ClassTable labels={[
          'ID hari kelas / 课次编号', 'Kelas / 班级', 'Tanggal / 日期', 'Jam / 时间', 'Jumlah jam / 小时数',
          'Guru / 教师', 'Murid / 学生', 'Kehadiran / 出勤', 'Catatan / 备注',
        ]} status={records.error ? empty : !records.data ? loadingText : !records.data.rows.length ? empty : undefined}>
          {records.data?.rows.map(row => <TableRow key={row.dayId + ':' + row.assignmentId}>
            <TableCell><a className="underline" href={recordsLink(row.classId, row.dayId)}>{row.code}</a></TableCell>
            <TableCell>{row.className}</TableCell><TableCell>{classDate(row.date)}</TableCell><TableCell>{row.time}</TableCell>
            <TableCell>{classHours(row.minutes)}</TableCell><TableCell>{row.teacher}</TableCell><TableCell>{row.student}</TableCell>
            <TableCell>{row.present ? 'Hadir / 出勤' : 'Tidak hadir / 缺席'}</TableCell>
            <TableCell className="long-cell">{row.notes || '—'}</TableCell>
          </TableRow>)}
        </ClassTable>
      </CardContent>
      <Pagination result={records.data} change={setPage} />
    </Card>
    {editing && detail.data && meeting.data && teachers.data && <MeetingEditor
      group={detail.data.group} day={meeting.data.day} roster={meeting.data.roster} teachers={teachers.data}
      close={() => setEditing(false)} saved={() => {
        setEditing(false);
        setReload(value => value + 1);
        toast.success('Kehadiran disimpan / 出勤已保存');
      }} />}
  </>;
}

export default function ClassWorkspace({ role, view }: { role: string; view: keyof typeof classPages }) {
  const [params, setParams] = useState<URLSearchParams>();
  useEffect(() => { setParams(new URLSearchParams(window.location.search)); }, []);
  const manager = canManageClasses(role);
  return <main className="workspace student-workspace">
    {view === 'classes' ? <ClassList manager={manager} /> :
      !params ? <Heading view={view} /> :
      view === 'detail' ? <ClassDetail id={params.get('class') ?? ''} manager={manager} /> : <ClassRecords params={params} />}
  </main>;
}
