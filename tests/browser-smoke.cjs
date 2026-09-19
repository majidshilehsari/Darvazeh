// Optional real-browser integration test. Dependencies can live outside the repo.
const {chromium:pw}=require('playwright');const chromium=require('@sparticuz/chromium').default;
const {spawn}=require('node:child_process');const fs=require('node:fs');const os=require('node:os');const net=require('node:net');const assert=require('node:assert/strict');
const wait=async fn=>{for(let i=0;i<100;i++){if(await fn())return;await new Promise(r=>setTimeout(r,50))}throw Error('Timed out')};
(async()=>{
 const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const root=fs.mkdtempSync(os.tmpdir()+'/darvazeh-browser-');const base=`http://127.0.0.1:${port}`;
 const proc=spawn('python3',['app/server.py'],{env:{...process.env,DEMO_MODE:'1',DATA_DIR:root,PORT:String(port),PUBLIC_DOMAIN:'demo.example',ADMIN_PASSWORD:'test-ui-password-123456'},stdio:'ignore'});
 let browser;
 try{
  await wait(async()=>{try{return (await fetch(base+'/healthz')).ok}catch{return false}});
  browser=await pw.launch({executablePath:await chromium.executablePath(),args:chromium.args.filter(a=>!['--disable-web-security','--allow-running-insecure-content'].includes(a)),headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1050}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async d=>{errors.push('Unexpected native dialog: '+d.type());await d.dismiss()});
  await page.goto(base);await page.locator('#password').fill('test-ui-password-123456');await page.locator('#loginForm button').click();await page.locator('#dashboard').waitFor({state:'visible'});
  await page.locator('#tab-devices').click();await page.locator('.add-device').click();await page.locator('#modal').waitFor({state:'visible'});
  await page.locator('#editName').fill('گوشی آزمایش');await page.locator('#modalSubmit').click();await page.locator('.qr-image').waitFor();
  await page.screenshot({path:'/tmp/darvazeh-qr-desktop.png',fullPage:true});const qrshot=await page.locator('.qr-image').screenshot();const png=require('pngjs').PNG.sync.read(qrshot);const decoded=require('jsqr')(new Uint8ClampedArray(png.data),png.width,png.height);assert.equal(decoded.data,await page.locator('#link').inputValue());
  const qrDownload=page.waitForEvent('download');await page.getByRole('button',{name:'دانلود تصویر QR',exact:true}).click();const qrFile=await qrDownload;assert.match(fs.readFileSync(await qrFile.path(),'utf8'),/<svg/);await page.locator('#modalCancel').click();
  await page.locator('#deviceRows tr').filter({hasText:'گوشی آزمایش'}).waitFor();
  assert.equal(await page.locator('#deviceRows [role=progressbar]').count(),1);
  const row=page.locator('#deviceRows tr').filter({hasText:'گوشی آزمایش'});
  assert.match(await row.locator('.meter-percent').textContent(),/٪ مصرف‌شده/);await row.locator('.qr-button').click();await page.locator('.qr-image').waitFor();await page.locator('#modalCancel').click();await row.locator('.more-button').click();await page.getByRole('button',{name:'ویرایش نام، سهمیه و اعتبار',exact:true}).click();
  assert.match(await page.locator('#expiryPreview').textContent(),/تخمینی/);assert.equal(await page.locator('#editDays').inputValue(),'10');assert.equal(await page.locator('#editQuota').inputValue(),'5');
  await page.locator('#editName').fill('گوشی شخصی');await page.locator('#editQuota').fill('8');await page.locator('#modalSubmit').click();await page.locator('#modal').waitFor({state:'hidden'});
  await page.locator('#deviceRows tr').filter({hasText:'گوشی شخصی'}).waitFor();
  await page.locator('#deviceSearch').fill('نامی که نیست');await page.locator('#deviceRows .empty').waitFor();await page.locator('#deviceSearch').fill('');
  await page.locator('#deviceRows tr').filter({hasText:'گوشی شخصی'}).locator('.link-button').click();assert.match(await page.locator('#link').inputValue(),/^vless:\/\//);await page.keyboard.press('Escape');await page.locator('#modal').waitFor({state:'hidden'});
  await page.screenshot({path:'/tmp/darvazeh-devices-desktop.png',fullPage:true});
  await page.locator('#tab-online').click();await page.locator('#onlineRows .empty').waitFor();
  await page.locator('#tab-settings').click();await page.locator('#clientSettings').click();assert.equal(await page.locator('#profileMux').isChecked(),false);assert.equal(await page.locator('#profileFragment').isChecked(),false);
  await page.locator('#profileFragment').check();const download=page.waitForEvent('download');await page.locator('#modalSubmit').click();const d=await download;
  const profile=JSON.parse(fs.readFileSync(await d.path(),'utf8'));assert.equal(profile.outbounds[0].mux.enabled,false);assert.equal(profile.outbounds[0].streamSettings.tlsSettings.allowInsecure,false);assert.equal(profile.outbounds[0].streamSettings.sockopt.dialerProxy,'fragment');assert.equal(profile.outbounds[1].settings.fragment.packets,'tlshello');await page.locator('#modalCancel').click();
  await page.locator('#restart').click();await page.locator('#modalCancel').click();
  await page.locator('#tab-devices').click();await page.locator('.add-device').click();await page.screenshot({path:'/tmp/darvazeh-modal-desktop.png',fullPage:true});await page.locator('#modalCancel').click();
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/darvazeh-mobile.png',fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'Page overflow on mobile');
  assert.equal(errors.length,0,errors.join('\n'));
  console.log('PASS: real Chromium, login, tabs, modal create/edit/cancel, quota percentages, QR decode/download/creation, expiry preview, search, link, client JSON, desktop/mobile overflow; zero JS errors/native dialogs');
 }finally{if(browser)await browser.close();proc.kill();await new Promise(r=>proc.once('exit',r));fs.rmSync(root,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
