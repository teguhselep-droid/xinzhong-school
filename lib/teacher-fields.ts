const teacherPersonalFields = [
  ['nameId', 'Nama Indonesia / 印尼姓名'],
  ['nameZh', 'Nama Mandarin / 中文姓名'],
  ['nik', 'NIK / 身份证号码'],
  ['birthdate', 'Tgl lahir / 出生日期'],
  ['phone', 'No. telepon / 电话号码'],
  ['address', 'Alamat / 地址'],
  ['city', 'Kota / 城市'],
] as const;

const registrationDateField = ['registeredDate', 'Tgl daftar / 登记日期'] as const;
export const teacherStatusField = 'Status guru / 教师状态';
export const teacherStatusLabel = (active: boolean) => active ? 'Aktif / 在职' : 'Nonaktif / 非在职';
export const teacherFields = [...teacherPersonalFields, registrationDateField] as const;

export const teacherColumns = [
  ['active', teacherStatusField],
  ...teacherPersonalFields,
  ['classCount', 'Jumlah kelas / 班级数量'],
  ['attendanceCount', 'Jumlah kehadiran / 出勤次数'],
  registrationDateField,
  ['recordedBy', 'Dicatat oleh / 登记人'],
] as const;

export type TeacherField = typeof teacherFields[number][0];
export type TeacherProfile = Record<Exclude<TeacherField, 'nik'>, string> & { nik?: string };
export type Teacher = TeacherProfile & {
  id: number;
  revision: number;
  active: boolean;
  classCount: number;
  attendanceCount: number;
  recordedBy: string | null;
};

export const teacherPageLabel = 'Data guru / 教师资料';
export const teacherPageSize = 10;
export const canEditTeachers = (role: string) => role === 'admin' || role === 'supervisor';
