import {env} from 'cloudflare:workers';
function keyBytes(){
 const raw=(env as unknown as Record<string,string>).FAV_CHAR_ENCRYPTION_KEY;
 if(!raw||!/^[a-f0-9]{64}$/i.test(raw))throw Error('FAV_CHAR_ENCRYPTION_KEY is not configured');
 return Uint8Array.from(raw.match(/../g)!,x=>parseInt(x,16));
}
export async function encryptFavChar(value:string){
 const key=await crypto.subtle.importKey('raw',keyBytes(),'AES-GCM',false,['encrypt']);
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode('shhs-fav-char-v1')},key,new TextEncoder().encode(value)));
 return 'v1:'+Array.from(iv).map(x=>x.toString(16).padStart(2,'0')).join('')+':'+Array.from(encrypted).map(x=>x.toString(16).padStart(2,'0')).join('');
}
export async function decryptFavChar(value:string){
 const [version,nonce,data]=value.split(':');if(version!=='v1'||!nonce||!data)throw Error('Invalid Fav Char ciphertext');
 const key=await crypto.subtle.importKey('raw',keyBytes(),'AES-GCM',false,['decrypt']);
 const bytes=(hex:string)=>Uint8Array.from(hex.match(/../g)!,x=>parseInt(x,16));
 return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(nonce),additionalData:new TextEncoder().encode('shhs-fav-char-v1')},key,bytes(data)));
}
export async function verifyFavChar(value:string,ciphertext:string){
 const expected=await decryptFavChar(ciphertext);let difference=expected.length^value.length;
 for(let i=0;i<expected.length;i++)difference|=expected.charCodeAt(i)^(value.charCodeAt(i)||0);
 return difference===0;
}
