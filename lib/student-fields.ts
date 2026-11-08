export const studentFields = [
  ['nameId','Nama Indonesia / 印尼姓名'], ['nameZh','Nama Mandarin / 中文姓名'],
  ['nik','NIK / 身份证号码'], ['birthdate','Tgl lahir / 出生日期'],
  ['phone','No. telepon / 电话号码'], ['address','Alamat / 地址'], ['city','Kota / 城市'],
  ['parentName','Nama orang tua / 家长姓名'], ['parentPhone','Telepon orang tua / 家长电话'],
  ['registeredDate','Tgl daftar / 注册日期'], ['notes','Catatan khusus / 特别备注'],
] as const;
export type StudentField = typeof studentFields[number][0];
export const loginStatusLabels:Record<string,string>={active:'Aktif / 启用',locked:'Terkunci / 已锁定'};
export const staffStudentFields=[...studentFields,['favChar','Fav Char / 喜爱汉字'],['loginStatus','Status login / 登录状态']] as const;
export type Student = Omit<Record<StudentField,string>,'nik'> & {nik?:string;favChar?:string;hasFavChar?:boolean; id:number; registrationNumber:string; currentClass:string; lastAttendanceDate:string|null; revision:number; canDelete:boolean; loginStatus:string;failedLoginAttempts:number;lastFailedLoginAt:string|null;loginVersion:number};
export function registrationNumber(student:{registrationNumber:string|null}){
 if(!student.registrationNumber||!/^\d{7}$/.test(student.registrationNumber))throw Error('Student registration number has not been assigned');
 return student.registrationNumber;
}
export const todayJakarta = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function ageYears(birthdate:string, today=todayJakarta()):number|null {
  if(!birthdate) return null;
  const [y,m,d]=birthdate.split('-').map(Number), [ty,tm,td]=today.split('-').map(Number);
  return ty-y-(tm<m||(tm===m&&td<d)?1:0);
}
