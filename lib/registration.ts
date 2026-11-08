import {ageYears,todayJakarta} from './student-fields';
import {isChineseName,chineseNameError,isFavChar,favCharError} from './chinese-input';
export const registrationFields=[
 ['nameId','Nama Indonesia / 印尼姓名'],['nameZh','Nama Mandarin / 中文姓名'],
 ['nik','NIK / 身份证号码'],['birthdate','Tgl lahir / 出生日期'],
 ['favChar','Fav Char / 喜爱汉字'],
 ['phone','No. telepon / 电话号码'],['address','Alamat / 地址'],['city','Kota / 城市'],
 ['parentName','Nama orang tua / 家长姓名'],['parentPhone','Telepon orang tua / 家长电话'],
 ['notes','Catatan khusus / 特别备注'],
] as const;
export type RegistrationData=Record<typeof registrationFields[number][0],string>;
export type RegistrationErrors=Partial<Record<keyof RegistrationData,string>>;
export function validateRegistration(data:RegistrationData,today=todayJakarta()):RegistrationErrors{
 const errors:RegistrationErrors={};
 if(!isFavChar(data.favChar||''))errors.favChar=favCharError;
 if(!isChineseName(data.nameZh))errors.nameZh=chineseNameError;
 for(const key of ['nameId','nik','birthdate','phone','address','city'] as const)if(!data[key]?.trim())errors[key]='Wajib diisi / 必填';
 for(const [key] of registrationFields)if(data[key].length>(key==='notes'?20000:key==='address'?2000:200))errors[key]='Terlalu panjang / 内容过长';
 const dob=data.birthdate;
 if(dob&&(!/^\d{4}-\d{2}-\d{2}$/.test(dob)||!Number.isFinite(Date.parse(dob))||new Date(dob).toISOString().slice(0,10)!==dob||dob>today||dob<'1900-01-01'))errors.birthdate='Tanggal lahir tidak valid / 出生日期无效';
 if(data.nik&&!/^\d{16}$/.test(data.nik))errors.nik='NIK harus 16 angka / 身份证号码须为16位数字';
 if(dob&&!errors.birthdate&&(ageYears(dob,today)??18)<18){
  if(!data.parentName.trim())errors.parentName='Wajib untuk usia di bawah 18 tahun / 未满18岁必填';
  if(!data.parentPhone.trim())errors.parentPhone='Wajib untuk usia di bawah 18 tahun / 未满18岁必填';
 }
 for(const key of ['phone','parentPhone'] as const)if(data[key]&&(!/^[+\d\s().-]+$/.test(data[key])||data[key].replace(/\D/g,'').length<6||data[key].replace(/\D/g,'').length>20))errors[key]='Nomor telepon tidak valid / 电话号码无效';
 return errors;
}
