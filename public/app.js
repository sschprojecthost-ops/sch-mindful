'use strict';
const live=new URLSearchParams(window.location.search).get('demo')!=='1';
const adminEntry=/^\/admin\/?$/.test(window.location.pathname);
const by=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const durationText=value=>{const seconds=Math.round(Number(value||0)*60);return seconds%60?Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0'):String(seconds/60);};
const num=value=>new Intl.NumberFormat('th-TH',{maximumFractionDigits:2}).format(value||0);
const dt=value=>value?new Intl.DateTimeFormat('th-TH',{dateStyle:'medium',timeZone:'Asia/Bangkok'}).format(new Date(value.length===10?value+'T00:00:00+07:00':value)):'—';
const statusWords={QUEUED:'รออ่านภาพ',READING:'กำลังอ่านภาพ',REVIEW:'รอ HR ตรวจ',NEEDS_INFO:'ขอหลักฐานเพิ่ม',APPROVED:'อนุมัติแล้ว',REJECTED:'ไม่อนุมัติ'};
const badge=s=>'<span class="status '+esc(s)+'">'+esc(statusWords[s]||s)+'</span>';
const band=b=>({small:'10–49 คน',large:'50 คนขึ้นไป',unassigned:'ต่ำกว่า 10 คน'})[b]||'';
const state={tab:adminEntry?'admin':'employee',home:null,filter:'',page:1,boardTab:'people',selected:null,busy:false,flow:null};
by('mode').textContent=live?'ระบบกิจกรรม':'โหมดทดลอง · ข้อมูลสมมติ';
if(!live){const reset=document.createElement('button');reset.className='btn secondary';reset.type='button';reset.textContent='เริ่มทดลองใหม่';reset.onclick=()=>{demoData=seedDemo();saveDemo();state.tab=adminEntry?'admin':'employee';state.filter='';state.selected=null;state.correction=null;tell('เริ่มรอบทดลองใหม่แล้ว');task(render);};by('mode').after(reset);}
const menu=[['employee','ส่งผลของฉัน'],['board','อันดับและรางวัล'],['admin','ตรวจหลักฐาน HR'],['flow','โฟลวและกติกา']];
function tell(message,error=false){by('notice').innerHTML=message?'<div class="alert '+(error?'error':'')+'">'+esc(message)+'</div>':'';}
async function task(fn) {
  if(state.busy)return;
  state.busy=true;
  try{await fn();}
  catch(e){
    tell(e.message,true);
    if(live&&loginConfig&&(e.status===401||e.status===403&&state.tab==='admin')&&state.home){
      try{await showLogin();}catch(loginError){tell(loginError.message,true);}
    }
    if(by('uploadProgress'))by('uploadProgress').textContent='';
  }finally{state.busy=false;}
}
function nav(){
  by('nav').innerHTML=menu.filter(([key])=>key!=='admin'||state.home?.user.admin).map(([key,label])=>'<button data-tab="'+key+'" aria-pressed="'+(state.tab===key)+'">'+label+'</button>').join('');
}
async function render(useLoadedHome=false){
  const tab=state.tab;
  document.body.classList.toggle('review-page',tab==='admin'&&Boolean(state.home?.user.admin));
  nav();
  if(tab==='flow'){renderFlow();return;}
  by('app').innerHTML='<div class="empty">กำลังโหลด…</div>';
  if(tab==='employee'){state.home=(useLoadedHome&&state.home)||await rpc('home');if(state.tab===tab){nav();renderEmployee();}}
  if(tab==='board'){const data=await rpc('leaderboard');if(state.tab===tab)renderBoard(data);}
  if(tab==='admin'){const data=await rpc('adminQueue',state.filter,state.page);if(state.tab===tab){state.queue=data;renderAdmin(data);}}
}
function metrics(entries){
  return '<div class="metrics">'+entries.map(([label,value])=>'<div class="metric"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong></div>').join('')+'</div>';
}
function headline(title,sub){return '<div class="lead"><div><h1>'+title+'</h1><p class="muted">'+sub+'</p></div></div>';}
function renderEmployee(){
  const {user,campaign,points,days,history,published,prizes}=state.home;
  const correction=history.find(r=>r.id===state.correction&&r.status==='NEEDS_INFO');
  const today=history.find(r=>r.date===campaign.today);
  const opened=campaign.today>=campaign.start&&campaign.today<=campaign.end&&user.eligible;
  const formEnabled=Boolean(correction)||opened&&!today;
  const summary=correction?'แนบหลักฐานใหม่ให้ครบสำหรับวันที่ '+dt(correction.date)+' ระบบเก็บรายการเดิมและประวัติการตรวจไว้':
    !opened?'ขณะนี้อยู่นอกช่วงส่งผลหรือบัญชีนี้ไม่มีสิทธิ์ส่ง':today?'วันนี้ส่งผลแล้ว ดูสถานะได้ที่ประวัติของฉัน':'ฝึกได้หลายรอบ แล้วแนบภาพทั้งหมดในรายการเดียว';
  by('app').innerHTML=
  '<section class="hero"><small>'+esc(dt(campaign.start)+' – '+dt(campaign.end))+'</small><h1>สะสมเวลาฝึกสมาธิ</h1><p>'+esc(user.name)+' · '+esc(user.department)+' · ทุกนาทีที่ผ่านการตรวจมีค่า 1 คะแนน</p>'+(user.alias?'<small>รหัสอันดับของคุณ '+esc(user.alias)+'</small>':'')+'</section>'+
  metrics([['คะแนนอนุมัติ',num(points)],['วันฝึกที่อนุมัติ',num(days)+' วัน'],['สถานะวันนี้',today?statusWords[today.status]:'ยังไม่ส่ง']])+
  '<div class="cols"><section class="card"><h2>'+(correction?'ส่งหลักฐานเพิ่ม':'ส่งผลการฝึกวันนี้')+'</h2><p class="muted clean">'+esc(summary)+'</p>'+
  (formEnabled?'<form id="submitForm" class="stack gap"><div><label class="label" for="minutes">เวลาฝึกจริง</label><input class="field full" id="minutes" name="minutes" placeholder="เช่น 25 หรือ 7:30 (นาที:วินาที)" autocomplete="off" required value="'+esc(correction?durationText(correction.claim):'')+'"></div>'+
  '<div class="drop"><label class="label" for="proof">ภาพจากแอปนาก</label><input type="file" id="proof" multiple accept="image/png,image/jpeg" '+(live?'required':'')+'><div class="small muted">JPG หรือ PNG สูงสุด 10 ภาพ เห็นวันฝึกและเวลาฝึกจริง · ระบบเก็บภาพใน Google Drive</div></div>'+
  (!live?'<button class="btn secondary" type="button" id="loadSample">ใช้หลักฐานสมมติ 17 นาที</button>':'')+
  '<div class="row"><button class="btn" type="submit">ส่งหลักฐาน</button>'+(correction?'<button class="btn secondary" type="button" id="cancelCorrection">กลับ</button>':'')+'</div><p class="small muted" id="uploadProgress" aria-live="polite"></p></form>':'')+
  '</section><section class="card"><h2>ประวัติของฉัน</h2><div class="listScroll">'+
  (history.length?history.map(r=>'<div class="listItem"><div class="row between"><strong>'+esc(dt(r.date))+'</strong>'+badge(r.status)+'</div><div class="small muted">ส่ง '+num(r.claim)+' นาที · อนุมัติ '+num(r.approved)+' คะแนน</div>'+
  (r.note?'<div class="small">'+esc(r.note)+'</div>':'')+(r.status==='NEEDS_INFO'?'<button class="btn secondary gap" data-correct="'+esc(r.id)+'">แนบหลักฐานเพิ่ม</button>':'')+'</div>').join(''):'<div class="empty">ประวัติจะแสดงหลังส่งรายการแรก</div>')+
  '</div></section></div>'+
  (published?'<div class="card section"><h2>ประกาศรางวัลของฉัน</h2>'+ (prizes.length?prizes.map(p=>'<p>'+esc(p.label)+' · '+esc(p.prize)+' '+esc(p.team||'')+'</p>').join(''):'<p>ผลรางวัลทีมดูได้ที่หน้านี้เมื่อประกาศ และระบบจะแจ้งรางวัลส่วนบุคคลในบัญชีผู้ได้รับ</p>')+'</div>':'');
  const form=by('submitForm');
  if(form)form.onsubmit=e=>{
    e.preventDefault();
    task(async()=>{
      const f=Array.from(by('proof').files);
      if(f.length>10||f.some(x=>x.size>2000000)||f.reduce((n,x)=>n+x.size,0)>10000000)throw new Error('แนบได้สูงสุด 10 ภาพ ภาพละไม่เกิน 2 MB รวมไม่เกิน 10 MB');
      const raw=by('minutes').value.trim();
      if(!/^(?:\d{1,4}(?:\.\d{1,2})?|\d{1,4}:[0-5]\d)$/.test(raw))throw new Error('กรอกเวลาฝึกจริง เช่น 25 หรือ 7:30');
      const [minutes,seconds=0]=raw.split(':').map(Number);
      const actualSeconds=Math.round(minutes*60+seconds);
      if(actualSeconds<1||actualSeconds>86400)throw new Error('กรอกเวลาฝึกจริงตั้งแต่ 1 วินาทีถึง 24 ชั่วโมง');
      const returned=await sendEvidence(f,{id:correction?.id,minutes:raw});
      state.correction=null;
      state.home=null;
      tell('บันทึกแล้ว · '+statusWords[returned.status]);
      await render();
    });
  };
  if(by('loadSample'))by('loadSample').onclick=()=>{by('minutes').value='17';tell('เลือกค่าตัวอย่างแล้ว กดส่งเพื่อจำลองการอ่านภาพ');};
  if(by('cancelCorrection'))by('cancelCorrection').onclick=()=>{state.correction=null;renderEmployee();};
}
function renderBoard(data){
  const {people,teams,stats}=data;
  const weeklyRate=stats.joined?100*stats.consistent/stats.joined:0;
  by('app').innerHTML=headline('อันดับและผลกิจกรรม','สรุปจากรายการที่อนุมัติแล้ว')+
    metrics([['ผู้เข้าร่วม',num(stats.joined)+' / '+num(stats.eligible)],['นาทีสะสมทั้งหมด',num(stats.total)],['ฝึกต่อเนื่อง 4 สัปดาห์',num(weeklyRate)+'%']])+
    '<section class="card section"><div class="row"><button class="btn '+(state.boardTab==='people'?'':'secondary')+'" data-board="people">รายบุคคล</button><button class="btn '+(state.boardTab==='teams'?'':'secondary')+'" data-board="teams">รายแผนก</button></div>'+
    '<div class="gap muted small">'+(state.boardTab==='people'?'แสดงอันดับด้วยรหัสแทนชื่อ · ผลอันดับระหว่างกิจกรรมเป็นข้อมูลเบื้องต้น':'คะแนนแผนก = นาทีที่อนุมัติรวม ÷ พนักงานที่มีสิทธิ์ทั้งหมดในทีม')+'</div><div class="table gap">'+
    (state.boardTab==='people'?table(['อันดับ','ผู้เข้าร่วม','วันฝึก','คะแนน'],people.map(p=>[p.rank,p.label,p.days,num(p.points)])):
      table(['ทีม','กลุ่มขนาด','เข้าร่วม / มีสิทธิ์','คะแนนเฉลี่ย'],teams.map(t=>[t.label,band(t.band),t.joined+' / '+t.size,num(t.avg)])))+'</div></section>'+prizeTable();
}
function table(headers,rows){
  if(!rows.length)return '<div class="empty">ยังไม่มีข้อมูล</div>';
  return '<table><thead><tr>'+headers.map(x=>'<th scope="col">'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(x=>'<td>'+esc(x)+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
}
function prizeTable(){
  return '<section class="card section"><h2>ของรางวัล 10,000 บาท</h2><div class="table">'+table(['รางวัล','ของรางวัล','งบรวม'],[
    ['อันดับ 1','หูฟังไร้สาย','900 บาท'],['อันดับ 2','แก้วเก็บอุณหภูมิ','600 บาท'],['อันดับ 3','พัดลมพกพา','300 บาท'],['อันดับ 4–12','กระเป๋าจัดของ 9 ชิ้น','1,800 บาท'],
    ['รายสัปดาห์','ร่มพับ 20 ชิ้น','4,000 บาท'],['รายแผนก','ชุดของว่าง 2 ทีม','2,400 บาท']])+'</div></section>';
}
function renderAdmin(data){
  const c=data.counts;
  const item=data.items.find(r=>r.id===state.selected);
  const waiting=(c.QUEUED||0)+(c.READING||0);
  by('app').innerHTML=headline('ตรวจหลักฐาน','ตรวจวันที่ นาทีจริง และภาพซ้ำก่อนอนุมัติคะแนน')+
    '<p class="small"><a class="btn secondary" href="/admin'+(live?'':'?demo=1')+'">ลิงก์ตรวจหลักฐานบน PC</a></p>'+
    metrics([['รอ OCR',num(waiting)],['รอ HR / ขอเพิ่ม',num((c.REVIEW||0)+(c.NEEDS_INFO||0))],['อนุมัติแล้ว',num(c.APPROVED)]])+
    '<div class="reviewLayout"><section class="card queueCard"><div class="row between"><h2>คิวรายการ</h2><button class="btn secondary" id="refreshQueue">รีเฟรช</button></div>'+
    '<label class="label" for="filter">สถานะ</label><select class="field full" id="filter">'+[['','รอ HR / ขอหลักฐานเพิ่ม'],['ALL','ทุกรายการ'],...Object.entries(statusWords)].map(([key,value])=>'<option value="'+esc(key)+'" '+(key===state.filter?'selected':'')+'>'+esc(value)+'</option>').join('')+'</select>'+
    '<div class="gap listScroll">'+(data.items.length?data.items.map(r=>'<div class="listItem"><div class="row between"><strong>'+esc(r.name)+'</strong>'+badge(r.status)+'</div><div class="small muted">'+esc(dt(r.date))+' · ส่ง '+num(r.claim)+' นาที</div><button class="btn secondary gap" data-review="'+esc(r.id)+'">เปิดรายการ</button></div>').join(''):'<div class="empty">ไม่มีรายการในหมวดนี้</div>')+'</div>'+
    '<div class="row gap"><button class="btn secondary" id="prevPage" '+(data.page===1?'disabled':'')+'>ก่อนหน้า</button><span class="small">'+data.page+' / '+data.pages+'</span><button class="btn secondary" id="nextPage" '+(data.page>=data.pages?'disabled':'')+'>ถัดไป</button></div></section>'+
    '<section class="card"><h2>หลักฐานและผล OCR</h2>'+(item?reviewPanel(item,data):'<p class="muted">เลือกรายการจากคิวเพื่อเปิดภาพและตรวจคะแนน</p>')+'</section></div>'+
    '<section class="card section"><h2>ปิดผลและประกาศรางวัล</h2><p class="muted">'+(data.award==='PUBLISHED'?'ประกาศผลแล้ว':data.award==='DRAWN'?'ปิดผลแล้ว ตรวจรายชื่อก่อนเผยแพร่':'ปิดผลได้เมื่อพ้นวันสุดท้ายและตรวจรายการทั้งหมดแล้ว')+'</p>'+
    (!live?'<button class="btn secondary" id="demoClose">จำลองสิ้นสุดกิจกรรม</button>':'')+
    (data.canDraw&&!data.award?'<div class="gap"><label><input type="checkbox" id="confirmDraw"> ตรวจหลักฐานครบและพร้อมล็อกคะแนน</label><div class="gap"><button class="btn" id="drawAwards">ปิดผลและจัดรางวัล</button></div></div>':'')+
    (data.winners.length?'<div class="table gap">'+table(['รางวัล','ผู้รับ','ของรางวัล','งบ'],data.winners.map(w=>[w.label,w.name||w.team,w.prize,num(w.budget)+' บาท']))+'</div><button class="btn secondary gap" id="exportAwards">ดาวน์โหลดรายชื่อ CSV</button>':'')+
    (data.award==='DRAWN'?'<div class="gap"><label><input type="checkbox" id="confirmPublish"> ตรวจรายชื่อและหลักฐานของผู้ได้รับรางวัลแล้ว</label><div class="gap"><button class="btn" id="publishAwards">ประกาศผล</button></div><details class="gap"><summary>เปิดตรวจผลใหม่</summary><div class="stack gap"><label for="reopenWhy">เหตุผลที่ต้องตรวจใหม่</label><textarea id="reopenWhy" class="field full" rows="2"></textarea><button class="btn secondary" id="reopenAwards">ยกเลิกผลชั่วคราวและเปิดตรวจ</button></div></details></div>':'')+'</section>';
  by('filter').onchange=()=>{state.filter=by('filter').value;state.page=1;state.selected=null;task(render);};
  by('refreshQueue').onclick=()=>task(render);
  by('prevPage').onclick=()=>{state.page=data.page-1;state.selected=null;task(render);};
  by('nextPage').onclick=()=>{state.page=data.page+1;state.selected=null;task(render);};
  if(by('demoClose'))by('demoClose').onclick=()=>{demoData.closed=true;saveDemo();tell('จำลองสิ้นสุดรอบแล้ว');task(render);};
  if(by('drawAwards'))by('drawAwards').onclick=()=>task(async()=>{await rpc('finalizeAwards',by('confirmDraw').checked);tell('ล็อกผลและจัดรางวัลแล้ว');await render();});
  if(by('reopenAwards'))by('reopenAwards').onclick=()=>task(async()=>{await rpc('reopenAwards',by('reopenWhy').value);tell('เปิดตรวจผลอีกครั้งแล้ว');await render();});
  if(by('publishAwards'))by('publishAwards').onclick=()=>task(async()=>{await rpc('publishAwards',by('confirmPublish').checked);tell('ประกาศผลแล้ว');await render();});
  if(by('exportAwards'))by('exportAwards').onclick=()=>downloadWinners(data.winners);
}
function reviewPanel(r,data){
  const ready=!data.award&&!['QUEUED','READING'].includes(r.status);
  const buttons=r.files.map((f,i)=>'<button class="btn secondary" data-picture="'+i+'">'+esc(f.label)+'</button>').join('');
  return '<div class="row between"><strong>'+esc(r.name)+'</strong>'+badge(r.status)+'</div><div class="small muted">'+esc(dt(r.date))+' · '+esc(r.department)+'</div>'+
    '<div class="reviewBody"><div class="picturePane"><div class="row gap">'+buttons+'</div><div id="picture"></div></div><div class="decisionPane"><div class="summary gap">แจ้ง '+num(r.claim)+' นาที · OCR '+(r.ocr?num(r.ocr)+' นาที':'ยังไม่พบเวลาที่ใช้ได้')+' · อนุมัติ '+num(r.approved)+' คะแนน</div>'+
    (r.note?'<p class="small">'+esc(r.note)+'</p>':'')+(r.summary?'<details class="gap"><summary>ข้อความจาก OCR</summary><div class="result small">'+esc(r.summary)+'</div></details>':'')+
    (r.history?.length?'<details class="gap"><summary>ประวัติการตรวจ</summary>'+r.history.map(h=>'<div class="listItem small">'+esc(h.actor)+' · '+esc(statusWords[h.status]||h.status)+' · '+esc(dt(h.updated))+' '+esc(h.note)+'</div>').join('')+'</details>':'')+
    (ready?'<hr class="split"><div class="stack"><div><label class="label" for="approvedMinutes">นาทีที่ยืนยันได้</label><input class="field full" id="approvedMinutes" value="'+esc(durationText(r.approved||r.ocr||r.claim))+'"></div><div><label class="label" for="reason">เหตุผลหรือหมายเหตุ</label><textarea id="reason" class="field full" rows="2" placeholder="ระบุเมื่อปรับคะแนน ขอเพิ่ม หรือไม่อนุมัติ"></textarea></div><div class="row"><button class="btn" data-verdict="approve">อนุมัติ</button><button class="btn secondary" data-verdict="need">ขอหลักฐานเพิ่ม</button><button class="btn danger" data-verdict="reject">ไม่อนุมัติ</button></div></div>':'')+'</div></div>';
}
function downloadWinners(winners){
  const csvField=value=>'"'+String(value??'').replace(/^[=+\-@\t\r]/,m=>"'"+m).replaceAll('"','""')+'"';
  const csv=[['รางวัล','ชื่อผู้รับ','รหัสพนักงาน','ทีม','ของรางวัล','งบ'],...winners.map(w=>[w.label,w.name,w.code,w.team,w.prize,w.budget])].map(r=>r.map(csvField).join(',')).join('\r\n');
  const a=document.createElement('a');
  const u=URL.createObjectURL(new Blob(['\ufeff',csv],{type:'text/csv;charset=utf-8'}));
  a.href=u;
  a.download='SCH-Mindful-Winners.csv';
  a.click();
  setTimeout(()=>URL.revokeObjectURL(u),1200);
}
function renderFlow(){
  const node=(role,title,desc)=>'<div class="flowstep"><em>'+role+'</em><b>'+title+'</b><div class="small muted">'+desc+'</div></div>';
  by('app').innerHTML=headline('โฟลวและกติกา','เส้นทางจากการฝึกสมาธิไปถึงคะแนนและรางวัล')+
    '<section class="card"><h2>ส่งหลักฐานรายวัน</h2><div class="flowgrid">'+
    node('พนักงาน','ฝึกผ่านแอปนาก','เลือกระยะเวลาเอง ฝึกได้หลายครั้งในวันเดียว')+
    node('พนักงาน','ส่ง Web App','รหัสพนักงาน · นาทีที่ฝึก · ภาพที่ระบุวันที่และเวลาจริง')+
    node('Netlify','รับรายการในวันฝึก','เว็บไซต์ส่งภาพทีละไฟล์ไปยัง Google Drive ของโรงพยาบาล · เวลาส่งตามเวลาไทย')+
    '</div><div class="branch"><b>เมื่อระบบรับแล้ว</b> พนักงานติดตามสถานะได้จากหน้าประวัติ</div></section>'+
    '<section class="card section"><h2>ตรวจภาพและคำนวณคะแนน</h2><div class="flowgrid">'+
    node('ระบบ','อ่านภาพจากคิว','แปลงสำเนาชั่วคราวเป็น Google Docs เพื่ออ่านข้อความ OCR')+
    node('ระบบ','ตรวจเงื่อนไข','ตรวจรูปแบบ วันฝึก นาทีที่แจ้ง และภาพไฟล์เดียวกัน')+
    node('HR','ตรวจกรณีที่ต้องใช้คน','เปิดภาพเทียบข้อความ ปรับนาที ขอภาพเพิ่ม หรือปฏิเสธพร้อมเหตุผล')+
    '</div><div class="branch"><b>ผ่านการตรวจ</b> นำทุกนาทีจริงเข้าคะแนน <span class="arrow">·</span> <b>ขอหลักฐานเพิ่ม</b> พนักงานส่งภาพทดแทนในรายการเดิม</div></section>'+
    '<section class="card section"><h2>ปิดผลรอบ 30 วัน</h2><div class="flowgrid">'+
    node('ระบบ','คำนวณอันดับ','รายบุคคลใช้คะแนนสะสม รายแผนกใช้นาทีรวมต่อผู้มีสิทธิ์')+
    node('HR','ปิดผลและจัดรางวัล','จัดอันดับ 12 คนก่อน แล้วสุ่มสัปดาห์ละ 5 คนจากผู้ฝึกอย่างน้อย 2 วัน')+
    node('HR','ประกาศผล','ตรวจหลักฐานผู้ได้รางวัลและเผยแพร่ผล ใช้ไฟล์รายชื่อภายในสำหรับส่งมอบของ')+
    '</div><div class="branch"><b>รางวัลรายบุคคลสูงสุด 1 ชิ้นต่อคน</b> · รางวัลแผนกแยกกลุ่มขนาด · วันที่ 29–30 ยังนับยอดสะสมและแผนก</div></section>'+prizeTable();
}
async function openEvidence(index){
    const target=by('picture');
    target.textContent='กำลังเปิดหลักฐาน…';
    try{
      const img=await rpc('evidenceImage',state.selected,index);
      if(live){if(!/^data:image\/(png|jpeg);base64,[\w+/=]+$/.test(img))throw new Error('เปิดภาพไม่ได้');
        target.innerHTML='<img class="evidence" alt="ภาพหลักฐานการฝึก" src="'+img+'">';
      }else{
        const rec=state.queue.items.find(x=>x.id===state.selected);
        target.innerHTML='<div class="sampleEvidence">ภาพหลักฐานสมมติ<strong>'+num(rec.ocr||rec.claim)+' นาที</strong>'+esc(dt(rec.date))+'</div>';
      }
    } catch(err){target.textContent='เปิดภาพไม่ได้';throw err;}
}
document.addEventListener('click',e=>{
  const b=e.target.closest('button');
  if(!b)return;
  const d=b.dataset;
  if(d.tab&&!state.busy){state.tab=d.tab;tell('');task(render);}
  if(d.board){state.boardTab=d.board;task(render);}
  if(d.correct){state.correction=d.correct;renderEmployee();}
  if(d.review)task(async()=>{
    state.selected=d.review;
    renderAdmin(state.queue);
    const item=state.queue.items.find(r=>r.id===state.selected);
    if(item?.files.length)await openEvidence(0);
  });
  if(d.picture!==undefined)task(()=>openEvidence(Number(d.picture)));
  if(d.verdict)task(async()=>{
    const item=state.queue.items.find(r=>r.id===state.selected);
    await rpc('reviewEvidence',{id:item.id,revision:item.revision,action:d.verdict,minutes:by('approvedMinutes').value,note:by('reason').value});
    tell('บันทึกผลตรวจแล้ว');
    state.selected=null;
    await render();
  });
});

const demoKey='sch-mindful-preview-v1';
const demoUser={name:'ณัฐชา ใจดี',department:'ทรัพยากรบุคคล',admin:true,eligible:true,alias:'100'};
const demoCampaign={start:'2026-11-01',end:'2026-11-30',today:'2026-11-25'};
function seedDemo(){
  const row=(id,date,claim,ocr,approved,status,name,department,mine,note='')=>({id,date,claim,ocr,approved,status,name,department,mine,note,
    revision:1,files:[{label:'หลักฐาน 1'}],summary:ocr?'วันที่ '+date+'\nเวลาฝึกจริง '+ocr+' นาที':'',history:[]});
  return {closed:false,award:'',winners:[],rows:[
    row('demo-21','2026-11-24',20,17,0,'REVIEW','อารยา ตั้งใจ','ผู้ป่วยนอก',false,'นาทีที่อ่านได้ไม่ตรงกับยอดที่ส่ง'),
    row('demo-16','2026-11-23',8,0,0,'REVIEW','ภูริ แสนดี','หอผู้ป่วย',false,'วันที่บนภาพอ่านไม่ชัด'),
    row('demo-12','2026-11-22',15,15,15,'APPROVED',demoUser.name,demoUser.department,true),
    row('demo-11','2026-11-19',10,10,10,'APPROVED',demoUser.name,demoUser.department,true),
    row('demo-09','2026-11-18',22,22,22,'APPROVED','อารยา ตั้งใจ','ผู้ป่วยนอก',false)]};
}
let demoData;
if(!live){try{demoData=JSON.parse(localStorage.getItem(demoKey))||seedDemo();}catch(_){demoData=seedDemo();}}
function saveDemo(){try{localStorage.setItem(demoKey,JSON.stringify(demoData));}catch(_){}}
function demoDuration(value){
  const input=String(value).trim();
  if(!/^(?:\d{1,4}:\d{2}|\d{1,4}(?:\.\d{1,2})?)$/.test(input))throw new Error('กรอกเวลาฝึกจริง เช่น 25 หรือ 7:30');
  const parts=input.split(':').map(Number);
  if(parts.length===2&&parts[1]>59)throw new Error('วินาทีต้องอยู่ระหว่าง 00–59');
  const n=parts[0]+(parts[1]||0)/60;
  if(n<=0||n>1440)throw new Error('กรอกเวลาฝึกระหว่าง 1 วินาทีถึง 24 ชั่วโมง');
  return n;
}
async function demo(name,param,more){
  const {rows}=demoData;
  if(name==='home') {
    const history=rows.filter(r=>r.mine);
    return {user:demoUser,campaign:demoData.closed?{...demoCampaign,today:'2026-12-01'}:demoCampaign,
      points:history.reduce((n,r)=>n+r.approved,0),days:history.filter(r=>r.status==='APPROVED').length,history,
      published:demoData.award==='PUBLISHED',prizes:demoData.winners.filter(w=>w.type==='team'||w.name===demoUser.name)};
  }
  if(name==='submitEvidence'){
    if(demoData.award)throw new Error('รอบนี้ปิดผลแล้ว');
    const value=demoDuration(param.minutes);
    let rec=param.id?rows.find(x=>x.id===param.id&&x.mine&&x.status==='NEEDS_INFO'):null;
    if(param.id&&!rec)throw new Error('รายการนี้แก้ไขไม่ได้');
    if(!rec){
      if(demoData.closed||rows.some(x=>x.mine&&x.date===demoCampaign.today))throw new Error('วันนี้ส่งผลแล้วหรือปิดรอบแล้ว');
      rec={id:'demo-'+Date.now(),mine:true,name:demoUser.name,department:demoUser.department,date:demoCampaign.today,revision:0,history:[]};
      rows.unshift(rec);
    }
    const passes=value===17;
    Object.assign(rec,{claim:value,ocr:17,approved:passes?17:0,status:passes?'APPROVED':'REVIEW',
      note:passes?'ผ่านการตรวจตัวอย่าง':'นาทีที่อ่านได้ไม่ตรงกับยอดที่ส่ง',summary:'วันที่ '+rec.date+'\nเวลาฝึกจริง 17 นาที',
      files:[{label:'หลักฐานสมมติ'}],revision:rec.revision+1,actor:'OCR จำลอง',updated:new Date().toISOString()});
    saveDemo();
    return rec;
  }
  if(name==='leaderboard'){
    const totals=new Map();
    for(const r of rows.filter(x=>x.status==='APPROVED')){
      const t=totals.get(r.name)||{label:'ผู้เข้าร่วม '+(r.mine?'100':String(101+totals.size)),points:0,days:0,department:r.department};
      t.points+=r.approved;t.days++;totals.set(r.name,t);
    }
    const people=[...totals.values()].sort((a,b)=>b.points-a.points).map((x,i)=>({...x,rank:i+1}));
    const teams=[['ทรัพยากรบุคคล',35],['ผู้ป่วยนอก',86],['หอผู้ป่วย',120]].map(([label,size])=>{
      const group=people.filter(x=>x.department===label);
      const points=group.reduce((n,p)=>n+p.points,0);
      return {label,size,joined:group.length,points,avg:points/size,band:size<50?'small':'large'};
    }).sort((a,b)=>b.avg-a.avg);
    return {people,teams,stats:{eligible:2200,joined:people.length,total:people.reduce((n,x)=>n+x.points,0),consistent:0}};
  }
  if(name==='adminQueue'){
    const counts={};
    rows.forEach(r=>{counts[r.status]=(counts[r.status]||0)+1;});
    return {items:rows.filter(r=>param==='ALL'||r.status===param||(!param&&['REVIEW','NEEDS_INFO'].includes(r.status))),counts,page:1,pages:1,
      award:demoData.award,winners:demoData.winners,canDraw:demoData.closed};
  }
  if(name==='evidenceImage')return 'demo';
  if(name==='reviewEvidence'){
    if(demoData.award)throw new Error('รอบนี้ปิดผลแล้ว');
    const row=rows.find(r=>r.id===param.id);
    if(!row||row.revision!==param.revision)throw new Error('ข้อมูลเปลี่ยนแล้ว');
    const status={approve:'APPROVED',need:'NEEDS_INFO',reject:'REJECTED'}[param.action];
    const approved=status==='APPROVED'?demoDuration(param.minutes):0;
    if((status!=='APPROVED'||approved!==row.claim)&&!param.note.trim())throw new Error('กรุณาระบุเหตุผล');
    row.history.push({status:row.status,actor:row.actor||'ระบบ',updated:row.updated||row.date,note:row.note});
    Object.assign(row,{status,approved,note:param.note,revision:row.revision+1,actor:'HR ทดลอง',updated:new Date().toISOString()});
    saveDemo();
    return row;
  }
  if(name==='finalizeAwards'){
    if(!param||!demoData.closed)throw new Error('กรุณายืนยันการปิดผล');
    if(rows.some(r=>!['APPROVED','REJECTED'].includes(r.status)))throw new Error('ต้องจบการตรวจทุกรายการก่อนปิดผล');
    if(!demoData.award){
      const individuals=new Map(), teamScores=new Map();
      for(const r of rows.filter(x=>x.status==='APPROVED')){
        const info=individuals.get(r.name)||{name:r.name,points:0,days:0,team:r.department};
        info.points+=r.approved;info.days++;individuals.set(r.name,info);
        teamScores.set(r.department,(teamScores.get(r.department)||0)+r.approved);
      }
      const first=[['หูฟังไร้สาย',900],['แก้วเก็บอุณหภูมิ',600],['พัดลมพกพา',300]];
      demoData.winners=[...individuals.values()].sort((a,b)=>b.points-a.points||b.days-a.days).slice(0,12).map((p,i)=>({...p,
        type:'individual',label:'อันดับ '+(i+1),prize:(first[i]||['กระเป๋าจัดของ'])[0],budget:(first[i]||['',200])[1]}));
      const teams=[['ทรัพยากรบุคคล',35],['ผู้ป่วยนอก',86],['หอผู้ป่วย',120]];
      for(const large of [false,true]){
        const winner=teams.filter(([t,n])=>Boolean(teamScores.get(t))&&(n>=50)===large)
          .sort(([a,x],[b,y])=>teamScores.get(b)/y-teamScores.get(a)/x)[0];
        if(winner)demoData.winners.push({type:'team',label:large?'แผนกขนาด 50 คนขึ้นไป':'แผนกขนาด 10–49 คน',team:winner[0],prize:'ชุดของว่างแบ่งทีม',budget:1200});
      }
      demoData.award='DRAWN';saveDemo();
    }
    return {state:demoData.award,winners:demoData.winners};
  }
  if(name==='reopenAwards'){
    if(demoData.award!=='DRAWN'||!String(param).trim())throw new Error('กรุณาระบุเหตุผลก่อนเปิดผลใหม่');
    demoData.award='';demoData.winners=[];saveDemo();return true;
  }
  if(name==='publishAwards'){
    if(!param||!demoData.award)throw new Error('กรุณายืนยันและปิดผลก่อน');
    demoData.award='PUBLISHED';saveDemo();return {state:'PUBLISHED',winners:demoData.winners};
  }
  throw new Error('ไม่พบคำสั่ง');
}
by('signOut').onclick=()=>task(async()=>{
  await apiRequest({action:'logout'});
  tell('');
  await showLogin();
});
task(initialize);
