'use strict';
let loginConfig;
let currentUpload;

async function apiRequest(body) {
  let response;
  try {
    response=await fetch('/api',body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store'}:{cache:'no-store'});
  } catch {
    throw new Error('เชื่อมต่อระบบไม่ได้ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่');
  }
  let result;
  try {result=await response.json();}
  catch {throw new Error('ยังเข้า Web App ไม่ได้ กรุณาติดต่อ HR');}
  if(!response.ok||!result.ok){
    const message = result.error || 'ระบบจัดการรายการไม่สำเร็จ';
    const reference = /^RELAY_[A-Z_]+$/.test(result.diagnosticCode || '') ? ' (รหัส ' + result.diagnosticCode + ')' : '';
    const error = new Error(message + reference);
    error.status=response.status;
    throw error;
  }
  return result.data;
}
function rpc(name,...args) {
  return live?apiRequest({action:name,args}):demo(name,...args);
}
function readFile(file) {
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve({data:reader.result});
    reader.onerror=()=>reject(new Error('เปิดไฟล์ภาพไม่ได้'));
    reader.readAsDataURL(file);
  });
}
async function sendEvidence(files,input) {
  if(!live)return rpc('submitEvidence',{...input,files:[]});
  if(!files.length)throw new Error('กรุณาแนบภาพหลักฐาน');
  if(!currentUpload||currentUpload.id!==input.id||currentUpload.files.length!==files.length||
    currentUpload.files.some((file,i)=>file!==files[i])||Date.now()-currentUpload.started>110*60000){
    currentUpload={id:input.id,files,receipts:[],started:Date.now()};
  }
  const current=currentUpload;
  const progress=by('uploadProgress');
  for(let i=current.receipts.length;i<files.length;i++){
    progress.textContent='กำลังส่งภาพ '+(i+1)+' จาก '+files.length+' ไปยัง Google Drive';
    current.receipts.push(await rpc('stageEvidence',{id:input.id,...await readFile(files[i])}));
  }
  progress.textContent='กำลังบันทึกรายการของวันนี้';
  try {
    const result=await rpc('submitEvidence',{...input,receipts:current.receipts});
    currentUpload=null;
    return result;
  } catch(err) {
    if(err.status===422&&/ใบรับไฟล์หมดอายุ|ไฟล์พักเปลี่ยนแปลง/.test(err.message))currentUpload=null;
    throw err;
  }
}
function readSpmLink() {
  if (adminEntry) return null;
  const url=new URL(location.href);
  const fromSpm=/^\/spm\/?$/.test(url.pathname)||url.searchParams.get('source')==='happyanyday';
  if (!fromSpm) return null;
  const staffIds=url.searchParams.getAll('staffid');
  const raw=staffIds.length===1?staffIds[0].trim():'';
  const code=/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(raw)?raw.toUpperCase():'';
  url.pathname='/';
  for (const key of ['source','staffid','v']) url.searchParams.delete(key);
  history.replaceState(null,'',url.pathname+url.search+url.hash);
  return {code};
}

async function showLogin(spm=null) {
  state.home=null;
  state.queue=null;
  state.selected=null;
  state.correction=null;
  state.tab=adminEntry?'admin':'employee';
  currentUpload=null;
  by('signOut').hidden=true;
  by('nav').textContent='';
  const title=adminEntry?'เข้าสู่หน้าตรวจหลักฐาน':'เข้าสู่ระบบพนักงาน';
  const helper=spm?(spm.code?'รับรหัสจาก SPM แล้ว กรุณาตรวจรหัสก่อนเข้าใช้งาน':'SPM ไม่ได้ส่งรหัสพนักงาน กรุณากรอกรหัสของคุณ'):
    adminEntry?'ใช้รหัสพนักงานที่ได้รับสิทธิ์ HR':'ใช้รหัสพนักงานของคุณ';
  by('app').innerHTML='<section class="hero"><h1>SCH Mindful</h1><p>ส่งหลักฐานการฝึกสมาธิและติดตามคะแนนของคุณ</p></section>'+
    '<section class="card signin"><h2>'+title+'</h2><p class="muted">'+helper+'</p>'+
    '<form id="employeeLogin" method="post" class="stack gap"><div><label for="employeeCode" class="label">รหัสพนักงาน</label>'+
    '<input class="field full" id="employeeCode" name="employeeCode" type="text" autocomplete="username" autocapitalize="characters" maxlength="32" value="'+esc(spm?.code||'')+'" required></div>'+
    '<div><button class="btn" type="submit">เข้าใช้งาน</button></div></form>'+
    '<p class="small gap">'+(adminEntry?'<a href="/">กลับไปหน้าพนักงาน</a>':'')+'</p></section>';
  by('employeeLogin').onsubmit=e=>{
    e.preventDefault();
    task(async()=>{
      const button=by('employeeLogin').querySelector('button');
      button.disabled=true;
      try {
        await apiRequest({action:'employeeLogin',code:by('employeeCode').value});
        tell('');
        await openHome();
      } finally {
        button.disabled=false;
      }
    });
  };
}

async function openHome() {
  try {
    state.home=await rpc('home');
    if (adminEntry&&!state.home.user.admin) {
      await showLogin();
      tell('รหัสนี้ยังไม่ได้รับสิทธิ์ตรวจหลักฐาน กรุณาติดต่อ HR',true);
      return;
    }
    state.tab=adminEntry?'admin':'employee';
    await render(true);
    by('signOut').hidden=false;
  } catch(error) {
    await showLogin();
    throw error;
  }
}
async function initialize() {
  const spm=readSpmLink();
  if (!live) {
    state.home=await rpc('home');
    await render(true);
    return;
  }
  try {loginConfig=await apiRequest();}
  catch(err){
    by('app').innerHTML='<section class="card signin"><h1>กำลังตั้งค่าระบบ</h1><p class="muted">'+esc(err.message)+'</p><a href="'+(adminEntry?'/admin':'/')+'?demo=1">เปิดโหมดทดลองด้วยข้อมูลจำลอง</a></section>';
    return;
  }
  if(loginConfig.signedIn&&(!spm||spm.code===loginConfig.employeeCode)) await openHome();
  else await showLogin(spm);
}
