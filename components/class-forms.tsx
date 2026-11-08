"use client";

import { useEffect, useState, type FormEvent } from 'react';
import { Plus, X } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { type AttendanceEntry, type ClassDay, type ClassRow, type ClassStudent, type ClassTeacher } from '@/lib/class-fields';
import { todayJakarta } from '@/lib/student-fields';

export async function getClassData<T>(params: Record<string, string>, signal?: AbortSignal): Promise<T> {
  const response = await fetch('/api/classes?' + new URLSearchParams(params), { signal, cache: 'no-store' });
  if (!response.ok) {
    const data = await response.json() as { error?: string };
    throw new Error(data.error ?? 'Gagal memuat data kelas / 无法加载班级资料');
  }
  return await response.json() as T;
}

export async function saveClassData(body: object) {
  const response = await fetch('/api/classes', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!response.ok) {
    const data = await response.json() as { error?: string };
    throw new Error(data.error ?? 'Gagal menyimpan / 无法保存');
  }
}

function useClassSave(saved: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent, body: object) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await saveClassData(body);
      saved();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, submit };
}

const isoDate = (date: Date) =>
  [date.getFullYear(), date.getMonth() + 1, date.getDate()].map((value, i) => String(value).padStart(i === 0 ? 4 : 2, '0')).join('-');

export function classDate(date: string | null) {
  if (!date) return '—';
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeZone: 'Asia/Jakarta' })
    .format(new Date(date.length === 10 ? date + 'T00:00:00+07:00' : date));
}

export const classHours = (minutes: number) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(minutes / 60);
const personName = (person: { nameId: string; nameZh: string }) => [person.nameId, person.nameZh].filter(Boolean).join(' ');

function TeacherField({ value, change, teachers }: { value: string; change: (value: string) => void; teachers: ClassTeacher[] }) {
  return <Field>
    <FieldLabel htmlFor="class-form-teacher">Guru / 教师</FieldLabel>
    <NativeSelect id="class-form-teacher" required value={value} onChange={e => change(e.target.value)}>
      <NativeSelectOption value="">Pilih guru / 选择教师</NativeSelectOption>
      {teachers.map(teacher => <NativeSelectOption key={teacher.id} value={teacher.id}>{personName(teacher)}</NativeSelectOption>)}
    </NativeSelect>
  </Field>;
}

function SubmitFooter({ busy, close, disabled = false }: { busy: boolean; close: () => void; disabled?: boolean }) {
  return <DialogFooter>
    <Button type="button" variant="outline" disabled={busy} onClick={close}>Batal / 取消</Button>
    <Button type="submit" disabled={busy || disabled}>{busy ? 'Menyimpan / 正在保存…' : 'Simpan / 保存'}</Button>
  </DialogFooter>;
}

function StudentPicker({ selected, change }: {
  selected: ClassStudent[]; change: (students: ClassStudent[]) => void;
}) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<ClassStudent[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    if (!search.trim()) return;
    const timer = setTimeout(() => {
      getClassData<ClassStudent[]>({ view: 'students', search }, controller.signal)
        .then(rows => { if (!controller.signal.aborted) setResults(rows); })
        .catch(error => { if (!controller.signal.aborted) setError(error.message); });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [search]);
  const available = results.filter(student => !selected.some(person => person.id === student.id));
  return <Field>
    <FieldLabel htmlFor="class-form-student">Pendaftaran murid / 学生报名</FieldLabel>
    <Input id="class-form-student" value={search} maxLength={100} placeholder="Cari nama atau no. registrasi / 搜索姓名或注册编号"
      onChange={e => { setSearch(e.target.value); setResults([]); setError(''); }} />
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {!!available.length && <ul className="max-h-32 overflow-auto rounded-md border">
      {available.map(student => <li key={student.id}>
        <Button type="button" variant="ghost" size="sm" className="w-full justify-start"
          onClick={() => change([...selected, student])}>
          <Plus data-icon="inline-start" />{student.registrationNumber} {personName(student)}
        </Button>
      </li>)}
    </ul>}
    {!!selected.length && <ul className="flex flex-wrap gap-2">
      {selected.map(student => <li key={student.id}>
        <Button type="button" variant="outline" size="sm" onClick={() => change(selected.filter(person => person.id !== student.id))}>
          {personName(student)}<X data-icon="inline-end" /><span className="sr-only">Keluarkan dari kelas / 从班级移除</span>
        </Button>
      </li>)}
    </ul>}
  </Field>;
}

export function ClassEditor({ group, roster, teachers, close, saved }: {
  group?: ClassRow; roster: ClassStudent[]; teachers: ClassTeacher[]; close: () => void; saved: () => void;
}) {
  const [id] = useState(() => group?.id ?? crypto.randomUUID());
  const [name, setName] = useState(group?.name ?? '');
  const [teacher, setTeacher] = useState(String(group?.teacherId ?? ''));
  const [location, setLocation] = useState(group?.location ?? '');
  const [dates, setDates] = useState<Date[]>([]);
  const [minutes, setMinutes] = useState('60');
  const [selected, setSelected] = useState<ClassStudent[]>(roster);
  const originalIds = new Set(roster.map(student => student.id));
  const selectedIds = new Set(selected.map(student => student.id));
  const { busy, error, submit } = useClassSave(saved);
  return <Dialog open onOpenChange={open => { if (!open && !busy) close(); }}>
    <DialogContent showCloseButton={false} aria-describedby={undefined} className="student-editor">
      <DialogHeader><DialogTitle>{group ? 'Edit kelas / 编辑班级' : 'Tambah kelas / 添加班级'}</DialogTitle></DialogHeader>
      <form onSubmit={e => submit(e, {
        action: group ? 'edit' : 'create', id, name, teacherId: Number(teacher), location,
        studentIds: [...selectedIds].filter(id => !originalIds.has(id)),
        removeStudentIds: [...originalIds].filter(id => !selectedIds.has(id)), revision: group?.revision,
        dates: dates.map(isoDate), time: new FormData(e.currentTarget).get('time'), minutes: Number(minutes),
      })}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="class-form-name">Nama kelas / 班级名称</FieldLabel>
            <Input id="class-form-name" required maxLength={200} value={name} onChange={e => setName(e.target.value)} />
          </Field>
          <FieldGroup className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TeacherField value={teacher} change={setTeacher} teachers={teachers} />
            <Field>
              <FieldLabel htmlFor="class-form-location">Lokasi / 地点</FieldLabel>
              <Input id="class-form-location" required maxLength={200} value={location} onChange={e => setLocation(e.target.value)} />
            </Field>
            {!group && <>
              <Field>
                <FieldLabel htmlFor="class-form-time">Jam mulai / 开始时间</FieldLabel>
                <Input id="class-form-time" name="time" type="time" required />
              </Field>
              <DurationField value={minutes} change={setMinutes} />
            </>}
          </FieldGroup>
          {!group && <Field>
            <FieldLabel>Jadwal pertemuan / 课次日期 · {dates.length} / 99</FieldLabel>
            <Calendar mode="multiple" max={99} selected={dates} onSelect={value => setDates(value ?? [])}
              formatters={{
                formatCaption: date => new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(date)
                  + ' / ' + date.getFullYear() + '年' + (date.getMonth() + 1) + '月',
                formatWeekdayName: date => ['Min 日', 'Sen 一', 'Sel 二', 'Rab 三', 'Kam 四', 'Jum 五', 'Sab 六'][date.getDay()],
              }}
              labels={{
                labelPrevious: () => 'Bulan sebelumnya / 上个月',
                labelNext: () => 'Bulan berikutnya / 下个月',
                labelDayButton: date => classDate(isoDate(date)),
              }} />
            {!!dates.length && <ul className="flex flex-wrap gap-2">
              {[...dates].sort((a, b) => a.getTime() - b.getTime()).map(date => <li key={isoDate(date)}>
                <Button type="button" variant="outline" size="sm" onClick={() => setDates(dates.filter(day => day !== date))}>
                  {classDate(isoDate(date))}<X data-icon="inline-end" /><span className="sr-only">Hapus tanggal / 移除日期</span>
                </Button>
              </li>)}
            </ul>}
          </Field>}
          <StudentPicker selected={selected} change={setSelected} />
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          <SubmitFooter busy={busy} close={close} disabled={!group && !dates.length} />
        </FieldGroup>
      </form>
    </DialogContent>
  </Dialog>;
}

function DurationField({ value, change }: { value: string; change: (value: string) => void }) {
  return <Field>
    <FieldLabel htmlFor="class-form-duration">Durasi (menit) / 时长（分钟）</FieldLabel>
    <Input id="class-form-duration" type="number" min={1} max={1440} required value={value} onChange={e => change(e.target.value)} />
  </Field>;
}

export function AddMeetingDialog({ classId, close, saved }: { classId: string; close: () => void; saved: () => void }) {
  const [id] = useState(() => crypto.randomUUID());
  const [minutes, setMinutes] = useState('60');
  const { busy, error, submit } = useClassSave(saved);
  return <Dialog open onOpenChange={open => { if (!open && !busy) close(); }}>
    <DialogContent showCloseButton={false} aria-describedby={undefined}>
      <DialogHeader><DialogTitle>Tambah jadwal / 添加课次</DialogTitle></DialogHeader>
      <form onSubmit={event => {
        const values = new FormData(event.currentTarget);
        return submit(event, {
          action: 'add-day', classId, id, date: values.get('date'), time: values.get('time'), minutes: Number(minutes),
        });
      }}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="new-meeting-date">Tanggal / 日期</FieldLabel>
            <Input id="new-meeting-date" name="date" type="date" min={todayJakarta()} required />
          </Field>
          <Field>
            <FieldLabel htmlFor="new-meeting-time">Jam mulai / 开始时间</FieldLabel>
            <Input id="new-meeting-time" name="time" type="time" required />
          </Field>
          <DurationField value={minutes} change={setMinutes} />
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          <SubmitFooter busy={busy} close={close} />
        </FieldGroup>
      </form>
    </DialogContent>
  </Dialog>;
}

export function MeetingEditor({ group, day, roster, teachers, close, saved }: {
  group: ClassRow; day: ClassDay; roster?: AttendanceEntry[]; teachers: ClassTeacher[]; close: () => void; saved: () => void;
}) {
  const [minutes, setMinutes] = useState(String(day.minutes));
  const [teacher, setTeacher] = useState(String(day.teacherId));
  const [location, setLocation] = useState(day.location);
  const [entries, setEntries] = useState(roster ?? []);
  const { busy, error, submit } = useClassSave(saved);
  function editEntry(assignmentId: string, update: Partial<AttendanceEntry>) {
    setEntries(entries.map(entry => entry.assignmentId === assignmentId ? { ...entry, ...update } : entry));
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) close(); }}>
    <DialogContent showCloseButton={false} aria-describedby={undefined} className="student-editor">
      <DialogHeader><DialogTitle>{roster ? 'Catat kelas / 记录课堂' : 'Edit jadwal / 编辑课次'} · {day.code}</DialogTitle></DialogHeader>
      <form onSubmit={e => {
        const values = new FormData(e.currentTarget);
        return submit(e, {
          action: roster ? 'record' : 'schedule', id: day.id, classId: group.id, revision: day.revision,
          date: values.get('date'), time: values.get('time'), minutes: Number(minutes), teacherId: Number(teacher), location,
          entries: entries.map(({ assignmentId, present, notes }) => ({ assignmentId, present, notes })),
        });
      }}>
        <FieldGroup>
          <FieldGroup className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="meeting-date">Tanggal / 日期</FieldLabel>
              <Input id="meeting-date" name="date" type="date" required defaultValue={day.date} />
            </Field>
            <Field>
              <FieldLabel htmlFor="meeting-time">Jam mulai / 开始时间</FieldLabel>
              <Input id="meeting-time" name="time" type="time" required defaultValue={day.time} />
            </Field>
            <DurationField value={minutes} change={setMinutes} />
            <TeacherField value={teacher} change={setTeacher} teachers={teachers} />
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="meeting-location">Lokasi / 地点</FieldLabel>
              <Input id="meeting-location" required maxLength={200} value={location} onChange={e => setLocation(e.target.value)} />
            </Field>
          </FieldGroup>
          {roster && <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong>Kehadiran / 出勤</strong>
              {!!entries.length && <Button type="button" variant="outline" size="sm"
                onClick={() => setEntries(entries.map(entry => ({ ...entry, present: true })))}>
                Semua hadir / 全部出勤
              </Button>}
            </div>
            {!entries.length && <p>Belum ada murid / 暂无学生</p>}
            {entries.map((entry, index) => <FieldGroup key={entry.assignmentId} className="rounded-md border p-3">
              <Field>
                <FieldLabel htmlFor={'meeting-attendance-' + index}>{entry.registrationNumber} {personName(entry)}</FieldLabel>
                <NativeSelect id={'meeting-attendance-' + index} required
                  value={entry.present === null ? '' : entry.present ? 'present' : 'absent'}
                  onChange={e => editEntry(entry.assignmentId, { present: e.target.value ? e.target.value === 'present' : null })}>
                  <NativeSelectOption value="">Pilih kehadiran / 选择出勤</NativeSelectOption>
                  <NativeSelectOption value="present">Hadir / 出勤</NativeSelectOption>
                  <NativeSelectOption value="absent">Tidak hadir / 缺席</NativeSelectOption>
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor={'meeting-notes-' + index}>Catatan / 备注</FieldLabel>
                <Textarea id={'meeting-notes-' + index} rows={2} maxLength={2000} value={entry.notes}
                  onChange={e => editEntry(entry.assignmentId, { notes: e.target.value })} />
              </Field>
            </FieldGroup>)}
          </>}
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          <SubmitFooter busy={busy} close={close} />
        </FieldGroup>
      </form>
    </DialogContent>
  </Dialog>;
}
