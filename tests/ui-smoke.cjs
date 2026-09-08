// Optional: NODE_PATH=/path/to/node_modules node tests/ui-smoke.cjs
// Exercises actual page JS against the real demo HTTP API in jsdom, not a visual browser.
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
  dom=new JSDOM(html,{url:base,runScripts:'dangerously',virtualConsole:vc,beforeParse(w){
   w.confirm=()=>true;w.prompt=()=>null;w.HTMLElement.prototype.scrollIntoView=()=>{};
   w.fetch=async(path,opts={})=>{const headers={...(opts.headers||{})};const cookie=dom.cookieJar.getCookieStringSync(base);if(cookie)headers.Cookie=cookie;const r=await fetch(new URL(path,base),{...opts,headers});for(const c of r.headers.getSetCookie())dom.cookieJar.setCookieSync(c,base);return r};
  }});
  const doc=dom.window.document;await wait(()=>!doc.querySelector('#password').disabled);
  doc.querySelector('#password').value='test-ui-password-123456';doc.querySelector('#loginForm').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  await wait(()=>!doc.querySelector('#dashboard').classList.contains('hidden')&&doc.querySelectorAll('#deviceRows tr').length===1);
  doc.querySelector('#deviceName').value='گوشی آزمایش';doc.querySelector('#deviceForm').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  await wait(()=>doc.querySelectorAll('#deviceRows tr').length===2);
  const row=Array.from(doc.querySelectorAll('#deviceRows tr')).find(r=>r.textContent.includes('گوشی آزمایش'));assert.ok(row);
  row.querySelector('button').click();await wait(()=>doc.querySelector('#link').value.startsWith('vless://'));
  assert.equal(doc.querySelectorAll('#profiles .profile').length,3);
  assert.match(doc.querySelector('#historyRows').textContent,/هنوز اتصال/);
  assert.equal(failures.length,0,failures.join('\n'));
  console.log('PASS: login, devices, generated link, profiles, empty truthful history; actual JS + HTTP API');
 } finally {
  if(dom)dom.window.close();proc.kill();await new Promise(r=>proc.once('exit',r));fs.rmSync(root,{recursive:true,force:true});
 }
})().catch(e=>{console.error(e);process.exitCode=1});
