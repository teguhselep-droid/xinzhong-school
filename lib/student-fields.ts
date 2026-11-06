export const studentFields = [
  ['nameId','Nama Indonesia / 印尼姓名'], ['nameZh','Nama Mandarin / 中文姓名'],
  ['nik','NIK / 身份证号码'], ['birthdate','Tgl lahir / 出生日期'],
  ['phone','No. telepon / 电话号码'], ['address','Alamat / 地址'], ['city','Kota / 城市'],
  ['parentName','Nama orang tua / 家长姓名'], ['parentPhone','Telepon orang tua / 家长电话'],
  ['registeredDate','Tgl daftar / 注册日期'], ['notes','Catatan khusus / 特别备注'],
] as const;
export type StudentField = typeof studentFields[number][0];
export type Student = Record<StudentField,string> & {id:number; registrationNumber:string; currentClass:string; lastAttendanceDate:string|null; revision:number};
export const registrationNumber = (id:number) => `SHHS-${String(id).padStart(6,'0')}`;
export const todayJakarta = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function ageYears(birthdate:string, today=todayJakarta()):number|null {
  if(!birthdate) return null;
  const [y,m,d]=birthdate.split('-').map(Number), [ty,tm,td]=today.split('-').map(Number);
  return ty-y-(tm<m||(tm===m&&td<d)?1:0);
}
