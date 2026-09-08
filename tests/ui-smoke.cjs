// Optional: NODE_PATH=/path/to/node_modules node tests/ui-smoke.cjs
// Executes the shipped HTML/JS against the real demo HTTP API, not mock responses.
const {JSDOM,VirtualConsole}=require('jsdom');
const {spawn}=require('node:child_process');const fs=require('node:fs');const os=require('node:os');const net=require('node:net');const assert=require('node:assert/strict');
const wait=async fn=>{for(let i=0;i<100;i++){if(await fn())return;await new Promise(r=>setTimeout(r,50))}throw Error('Timed out')};
(async()=>{
 const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const root=fs.mkdtempSync(os.tmpdir()+'/darvazeh-ui-');const base=`http://127.0.0.1:${port}`;
 const proc=spawn('python3',['app/server.py'],{env:{...process.env,DEMO_MODE:'1',DATA_DIR:root,PORT:String(port),PUBLIC_DOMAIN:'demo.example',ADMIN_PASSWORD:'test-ui-password-123456'},stdio:'ignore'});
 let dom;
 try{
  await wait(async()=>{try{return (await fetch(base+'/healthz')).ok}catch{return false}});
  const html=await (await fetch(base)).text();const failures=[];const vc=new VirtualConsole();vc.on('jsdomError',e=>failures.push(e.message));
  dom=new JSDOM(html,{url:base,runScripts:'dangerously',resources:'usable',virtualConsole:vc,beforeParse(w){
   w.confirm=w.prompt=w.alert=()=>{throw Error('Native browser dialog must not be used')};
   w.fetch=async(path,opts={})=>{const headers={...(opts.headers||{})};const cookie=dom.cookieJar.getCookieStringSync(base);if(cookie)headers.Cookie=cookie;const r=await fetch(new URL(path,base),{...opts,headers});for(const c of r.headers.getSetCookie())dom.cookieJar.setCookieSync(c,base);return r};
  }});
  const doc=dom.window.document;await wait(()=>doc.querySelector('#loginForm').onsubmit);
  doc.querySelector('#password').value='test-ui-password-123456';doc.querySelector('#loginForm').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  await wait(()=>!doc.querySelector('#dashboard').classList.contains('hidden')&&doc.querySelectorAll('#deviceRows tr').length===1);
  doc.querySelector('#tab-devices').click();doc.querySelector('.add-device').click();
  assert.match(doc.querySelector('#expiryPreview').textContent,/تخمینی/);doc.querySelector('#editDays').value='0';doc.querySelector('#editDays').dispatchEvent(new dom.window.Event('input'));assert.equal(doc.querySelector('#expiryPreview').textContent,'بدون انقضا');doc.querySelector('#editDays').value='10';doc.querySelector('#editName').value='گوشی آزمایش';doc.querySelector('#modalForm').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  await wait(()=>doc.querySelectorAll('#deviceRows tr').length===2);
  const row=Array.from(doc.querySelectorAll('#deviceRows tr')).find(r=>r.textContent.includes('گوشی آزمایش'));assert.ok(row.querySelector('[role=progressbar]'));
  assert.match(row.querySelector('.meter-percent').textContent,/٪ مصرف‌شده/);assert.ok(row.querySelector('.qr-button'));await wait(()=>doc.querySelector('#link')?.value.startsWith('vless://'));
  assert.ok(doc.querySelector('svg.qr-image'));const link=doc.querySelector('#link').value;doc.querySelector('#modalCancel').click();
  const baseline=dom.window.buildClientConfig(link,{port:10818,mux:false,fragment:false,concurrency:8});
  assert.equal(baseline.outbounds[0].mux.enabled,false);assert.equal(baseline.outbounds[0].streamSettings.tlsSettings.allowInsecure,false);assert.equal(baseline.inbounds[0].listen,'127.0.0.1');
  assert.throws(()=>dom.window.buildClientConfig(link,{port:10818,fragment:true,length:'bad',interval:'1-3'}));
  assert.equal(doc.querySelectorAll('#profiles .profile').length,3);
  // Deterministic UI-only fixtures exercise known expiry and connected rows.
  dom.window.eval(`state.devices=[{id:'fixture',name:'fixture',enabled:true,quota_bytes:1000,used_bytes:350,remaining_bytes:650,duration_days:10,first_seen:1800000000,expires_at:1800864000}];state.summary=[{device_id:'fixture',active_connections:1}];renderDevices();editModal(state.devices[0]);`);
  assert.match(doc.querySelector('#expiryPreview').textContent,/انقضای دقیق/);
  assert.ok(!doc.querySelector('#expiryPreview').textContent.includes('تخمینی'));
  assert.ok(doc.querySelector('#onlineRows .qr-button'));
  assert.equal(doc.querySelector('#deviceRows [role=progressbar]').getAttribute('aria-valuenow'),'35');
  assert.match(doc.querySelector('#deviceRows .meter-percent').textContent,/۳۵٪ مصرف‌شده/);
  doc.querySelector('#modalCancel').click();

  doc.querySelector('#tab-online').click();assert.equal(doc.querySelector('#tab-online').getAttribute('aria-selected'),'true');
  assert.equal(failures.length,0,failures.join('\n'));
  console.log('PASS: shipped JS + HTTP, login, modal device creation, progress, link, client JSON defaults/validation, online tab; no native dialogs');
 } finally {if(dom)dom.window.close();proc.kill();await new Promise(r=>proc.once('exit',r));fs.rmSync(root,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
