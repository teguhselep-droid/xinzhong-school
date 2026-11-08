export const chineseNamePattern=String.raw`[\p{Script=Han}]+`;
export const chineseNameError='Hanya huruf Mandarin yang diperbolehkan / 仅可输入汉字';
const hanOnly=new RegExp(`^(?:${chineseNamePattern})$`,'u');
export const isChineseName=(value:string)=>value===''||hanOnly.test(value);
export const favCharPattern=String.raw`[\p{Script=Han}]`;
export const favCharError='Fav Char harus tepat 1 huruf Mandarin / 喜爱汉字必须为一个汉字';
export const isFavChar=(value:string)=>Array.from(value).length===1&&hanOnly.test(value);
