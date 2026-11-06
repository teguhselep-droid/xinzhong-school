import assert from 'node:assert/strict';
// Account-creating checks must be explicitly enabled against a disposable local database.
// This script is never part of installation, startup, migrations, or builds.
if (process.env.XINZHONG_TEST_DATABASE !== 'disposable') {
  console.error('Stopped: user lifecycle tests create test accounts. Use a separate disposable local database and explicitly set XINZHONG_TEST_DATABASE=disposable.');
  process.exit(1);
}
const base='http://127.0.0.1:5173/api/workspace';
async function call(body,cookie=''){const r=await fetch(base,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',cookie},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]||''};}
assert.equal((await call({action:'save'})).status,401);
assert.equal((await call({action:'login',username:'teguh',password:'incorrect'})).status,401);
const login=await call({action:'login',username:'teguh',password:process.env.INITIAL_SUPERVISOR_PASSWORD});assert.equal(login.status,200);const cookie=login.cookie;
const state=await call(null,cookie);assert.equal(state.data.me.role,'supervisor');assert.equal(state.data.me.username,'teguh');assert.equal('passwordHash' in state.data.me,false);
assert.equal((await call({action:'save',...state.data.me,role:'teacher'},cookie)).status,400);
for(const role of ['admin','accounting','teacher']){
 const username='qa_'+role;const user={username,name:'Pengujian 测试',role,active:true,password:'TestOnly927!'};
 assert.equal((await call({action:'save',...user},cookie)).status,200);
 assert.equal((await call({action:'save',...user},cookie)).status,409);
 let updated=await call(null,cookie);const id=updated.data.users.find(u=>u.username===username).id;
 let signed=await call({action:'login',username,password:user.password});assert.equal(signed.status,200);
 let restricted=await call(null,signed.cookie);assert.equal(restricted.data.me.role,role);assert.equal(restricted.data.users.length,0);
 assert.equal((await call({action:'save',...user},signed.cookie)).status,403);
 assert.equal((await call({action:'save',...user,id,name:'Diperbarui 已更新'},cookie)).status,200);
 assert.equal((await call({action:'save',...user,id,active:false},cookie)).status,200);
 assert.equal((await call(null,signed.cookie)).data.me,null);
 assert.equal((await call({action:'login',username,password:user.password})).status,401);
 assert.equal((await call({action:'save',...user,id,active:true,password:'Replacement927!'},cookie)).status,200);
 assert.equal((await call({action:'login',username,password:user.password})).status,401);
 signed=await call({action:'login',username,password:'Replacement927!'});assert.equal(signed.status,200);
 assert.equal((await call({action:'password',currentPassword:'Replacement927!',password:'Changed927!'},signed.cookie)).status,200);
 assert.equal((await call(null,signed.cookie)).data.me,null);
 assert.equal((await call({action:'login',username,password:'Changed927!'})).status,200);
}
assert.equal((await call({action:'logout'},cookie)).status,200);assert.equal((await call(null,cookie)).data.me,null);
console.log('PASS: supervisor login; invalid login; all three roles; account creation; duplicate rejection; saved edits; deactivation; session revocation; password reset and change; logout; no password disclosure.');
