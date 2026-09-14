// Optional: NODE_PATH=/path/to/node_modules node tests/ui-bulk-smoke.cjs
// Exercises the add-devices tab (manual table, CSV, code string), bulk selection
// and the suggestions tab against the real demo HTTP API.
const {JSDOM,VirtualConsole}=require('jsdom');
const {spawn}=require('node:child_process');const fs=require('node:fs');const os=require('node:os');const net=require('node:net');const assert=require('node:assert/strict');
const wait=async fn=>{for(let i=0;i<200;i++){if(await fn())return;await new Promise(r=>setTimeout(r,50))}throw Error('Timed out')};
(async()=>{
 const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const root=fs.mkdtempSync(os.tmpdir()+'/darvazeh-bulk-');const base=`http://127.0.0.1:${port}`;
 const proc=spawn('python3',['app/server.py'],{env:{...process.env,DEMO_MODE:'1',DATA_DIR:root,PORT:String(port),PUBLIC_DOMAIN:'demo.example',ADMIN_PASSWORD:'test-ui-password-123456'},stdio:'ignore'});
 let dom;
 try{
  await wait(async()=>{try{return (await fetch(base+'/healthz')).ok}catch{return false}});
  const html=await (await fetch(base)).text();const failures=[];const vc=new VirtualConsole();vc.on('jsdomError',e=>failures.push(e.message));
  dom=new JSDOM(html,{url:base,runScripts:'dangerously',resources:'usable',virtualConsole:vc,beforeParse(w){
   w.confirm=w.prompt=w.alert=()=>{throw Error('Native browser dialog must not be used')};
   try{Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async()=>{}},configurable:true})}catch{}
   w.fetch=async(path,opts={})=>{const headers={...(opts.headers||{})};const cookie=dom.cookieJar.getCookieStringSync(base);if(cookie)headers.Cookie=cookie;const r=await fetch(new URL(path,base),{...opts,headers});for(const c of r.headers.getSetCookie())dom.cookieJar.setCookieSync(c,base);return r};
  }});
  const doc=dom.window.document;const click=(sel)=>{const n=doc.querySelector(sel);assert.ok(n,'missing element: '+sel);n.click();return n};
  const setVal=(sel,value,evt='input')=>{const n=doc.querySelector(sel);assert.ok(n,'missing: '+sel);n.value=value;n.dispatchEvent(new dom.window.Event(evt,{bubbles:true}));return n};
  const rows=()=>doc.querySelectorAll('#deviceRows tr').length;
  await wait(()=>doc.querySelector('#loginForm').onsubmit);
  setVal('#password','test-ui-password-123456');
  doc.querySelector('#loginForm').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  await wait(()=>!doc.querySelector('#dashboard').classList.contains('hidden')&&rows()===1);

  // --- tabs exist in the intended order ---
  const tabs=[...doc.querySelectorAll('#tabs [data-tab]')].map(b=>b.dataset.tab);
  assert.deepEqual(tabs,['overview','add','devices','online','history','settings','ideas'],'tab order: '+tabs);
  assert.equal(doc.querySelector('#stagedCap').textContent.trim(),'۴۹','capacity is 50 total incl. the legacy slot');

  // --- 1. manual table ---
  click('#tab-add');
  assert.equal(doc.querySelector('#tab-add').getAttribute('aria-selected'),'true');
  let draft=doc.querySelectorAll('#draftRows input');
  assert.equal(draft.length,3,'draft row has name, gb, days inputs');
  assert.equal(draft[1].value,'50','manual default quota is 50 GB');
  assert.equal(draft[2].value,'30','manual default duration is 30 days');
  draft[0].value='خانواده-علی';draft[0].dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  click('#stageDraft');
  await wait(()=>doc.querySelectorAll('#stagedRows tr').length===1);
  assert.equal(doc.querySelector('#stagedValid').textContent.trim(),'۱');

  // --- 2. CSV ---
  setVal('#csvText','name,quota_gb,days\n"خانواده, مریم",20,30\n');
  click('#stageCsv');
  await wait(()=>doc.querySelectorAll('#stagedRows tr').length===2);
  assert.ok(doc.querySelector('#stagedRows').textContent.includes('خانواده, مریم'),'quoted CSV field survives');

  // --- 3. code string ---
  setVal('#codeText',"// family\n[{name:'دوست-۱', quota_gb:0, days:0},\n {name:'دستگاه بد', quota_gb:-5, days:30},]");
  click('#stageCode');
  await wait(()=>doc.querySelectorAll('#stagedRows tr').length===4);
  assert.equal(doc.querySelector('#stagedValid').textContent.trim(),'۳','the invalid row is not counted');
  assert.ok(doc.querySelector('#stagedRows tr.invalid-row'),'invalid row is flagged in the staging table');
  assert.equal(doc.querySelector('#importStaged').disabled,false,'import allowed with the valid rows');

  // --- 4. import ---
  click('#importStaged');
  await wait(()=>rows()===4);
  await wait(()=>doc.querySelector('.link-list .link-row'));           // links modal for new devices
  assert.equal(doc.querySelectorAll('.link-list .link-row').length,3);
  await wait(()=>doc.querySelector('.link-list code').textContent.startsWith('vless://'));
  assert.ok(doc.querySelector('.link-list .copy-button'),'new-device modal offers copy');
  click('#modalCancel');

  // --- 5. the invalid row stayed behind for correction ---
  assert.equal(doc.querySelectorAll('#stagedRows tr').length,1);
  assert.equal(doc.querySelector('#stagedCap').textContent.trim(),'۴۶');

  // --- 6. per-row copy button + bulk selection ---
  click('#tab-devices');
  await wait(()=>rows()===4);
  assert.equal(doc.querySelectorAll('#deviceRows .copy-button').length,4,'every row has a copy button');
  assert.equal(doc.querySelectorAll('#deviceRows input[type=checkbox]').length,4,'every row is selectable');
  assert.ok(doc.querySelector('#bulkBar').classList.contains('hidden'),'bulk bar hidden with no selection');

  click('#selectAllDevices');
  await wait(()=>!doc.querySelector('#bulkBar').classList.contains('hidden'));
  assert.equal(doc.querySelector('#bulkCount').textContent.trim(),'۴ دستگاه انتخاب شده');
  assert.equal(doc.querySelector('#bulkDelete').disabled,true,'legacy selection must block bulk delete');
  assert.ok(!doc.querySelector('#bulkDeleteHint').classList.contains('hidden'));

  // deselect the legacy row -> delete becomes available
  const legacyRow=[...doc.querySelectorAll('#deviceRows tr')].find(r=>r.textContent.includes('اتصال قبلی'));
  assert.ok(legacyRow,'legacy row present');
  const legacyBox=legacyRow.querySelector('input[type=checkbox]');
  legacyBox.checked=false;legacyBox.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  await wait(()=>doc.querySelector('#bulkDelete').disabled===false);
  assert.equal(doc.querySelector('#bulkCount').textContent.trim(),'۳ دستگاه انتخاب شده');

  // --- 7. bulk disable then enable ---
  click('#bulkDisable');
  await wait(()=>doc.querySelector('#modalForm'));
  doc.querySelector('#modalForm').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  await wait(()=>doc.querySelectorAll('#deviceRows .pill.bad').length===3);
  assert.equal(doc.querySelectorAll('#deviceRows .pill.bad').length,3,'three devices show the disabled state');

  // --- 8. bulk delete the same three ---
  click('#selectAllDevices');
  await wait(()=>!doc.querySelector('#bulkBar').classList.contains('hidden'));
  const legacyBox2=[...doc.querySelectorAll('#deviceRows tr')].find(r=>r.textContent.includes('اتصال قبلی')).querySelector('input[type=checkbox]');
  legacyBox2.checked=false;legacyBox2.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  await wait(()=>doc.querySelector('#bulkCount').textContent.trim()==='۳ دستگاه انتخاب شده');
  click('#bulkDelete');
  await wait(()=>doc.querySelector('#modalForm'));
  doc.querySelector('#modalForm').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  await wait(()=>rows()===1);
  assert.equal(rows(),1,'only the legacy device remains');
  assert.ok(doc.querySelector('#deviceRows').textContent.includes('اتصال قبلی'));

  // --- 9. suggestions tab: listed but nothing active ---
  click('#tab-ideas');
  await wait(()=>doc.querySelectorAll('#ideaGrid .profile').length>0);
  assert.equal(doc.querySelectorAll('#ideaGrid .profile').length,12,'all suggestions listed');
  assert.equal(doc.querySelectorAll('#ideaGrid button').length,0,'suggestions expose no actions');
  assert.match(doc.querySelector('#ideaGrid').textContent,/پیش‌نیاز:/);

  assert.equal(failures.length,0,failures.join('\n'));
  console.log('PASS: tab order, 50GB/30d defaults, manual table + CSV + code string staging, invalid-row handling, bulk import, per-row copy, select-all, legacy protection, bulk disable/delete, suggestions tab; no native dialogs');
 } finally {if(dom)dom.window.close();proc.kill();await new Promise(r=>proc.once('exit',r));fs.rmSync(root,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
