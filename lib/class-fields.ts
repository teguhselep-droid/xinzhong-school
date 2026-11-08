export type ClassRow = {
  id: string;
  code: string;
  name: string;
  teacherId: number;
  teacher: string;
  location: string;
  start: string | null;
  finish: string | null;
  dayCount: number;
  studentCount: number;
  latestAttendance: number | null;
  createdAt: string | null;
  recordedBy: string | null;
  revision: number;
};

export type ClassDay = {
  id: string;
  code: string;
  date: string;
  time: string;
  minutes: number;
  teacherId: number;
  teacher: string;
  location: string;
  recordedAt: string | null;
  canRecord: boolean;
  canRemove: boolean;
  attendance: number | null;
  revision: number;
};

export type ClassStudent = { id: number; nameId: string; nameZh: string; registrationNumber: string | null };
export type ClassTeacher = { id: number; nameId: string; nameZh: string };
export type TeacherClassHistoryPage = {
  rows: Pick<ClassRow, 'id' | 'code' | 'name'>[];
  page: number;
  total: number;
};
export type Enrollment = ClassStudent & { assignmentId: string };
export type AttendanceEntry = Enrollment & { present: boolean | null; notes: string };
export type AttendanceRecord = {
  code: string;
  className: string;
  date: string;
  time: string;
  minutes: number;
  teacher: string;
  student: string;
  present: boolean;
  notes: string;
  dayId: string;
  classId: string;
  assignmentId: string;
};

export const classPageSize = 10;
export const meetingStart = (date: string, time: string) => Date.parse(date + 'T' + time + ':00+07:00');
export const canManageClasses = (role: string) => role === 'admin' || role === 'supervisor';
export const canTakeAttendance = (role: string) => canManageClasses(role) || role === 'teacher';
export const classPages = {
  classes: 'Data Kelas / 班级资料',
  detail: 'Detail Kelas / 班级详情',
  records: 'Record Kelas / 课堂记录',
};
