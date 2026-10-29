// Explicit preparation test only; not in the registered suite interface.
import assert from 'node:assert/strict';
import net from 'node:net';
import { chromium } from 'playwright';
const checks = [];
let browser;
const sockets = new Set();
const bridge = net.createServer(peer => {
  const remote = net.createConnection('/egress.sock'); sockets.add(peer); sockets.add(remote);
  peer.pipe(remote).pipe(peer);
  for (const s of [peer,remote]) s.on('error', () => { peer.destroy(); remote.destroy(); });
  peer.on('close',()=>remote.destroy());
});
const timer = setTimeout(() => process.exit(3), 45000);
try {
  assert.notEqual(process.getuid(), 0); checks.push('non_root');
  for (const host of ['<PROD_IP>','<RING1_IP>','169.254.169.254','<DEV_IP>','1.1.1.1','127.0.0.1','::1']) {
    const blocked = await new Promise(resolve => {
      const s = net.createConnection({host,port:443}); const t=setTimeout(()=>{s.destroy();resolve(true);},500);
      s.once('connect',()=>{clearTimeout(t);s.destroy();resolve(false);});s.once('error',()=>{clearTimeout(t);resolve(true);});
    });
    assert.ok(blocked); checks.push('direct_denied:' + host);
  }
  await new Promise(resolve=>bridge.listen(18080,'127.0.0.1',resolve));
  browser = await chromium.launch({ channel: 'chromium', headless:true, chromiumSandbox:true, timeout:10000,
    proxy:{server:'http://127.0.0.1:18080',bypass:'<-loopback>'},args:['--disable-quic','--ssl-version-max=tls1.2','--disable-features=EncryptedClientHello'] });
  const context=await browser.newContext({ignoreHTTPSErrors:false});const page=await context.newPage();
  await page.goto('chrome://sandbox');
  const status=await page.locator('body').innerText();
  assert.match(status,/PID namespaces\s+Yes/i);assert.match(status,/Seccomp-BPF sandbox\s+Yes/i);
  checks.push('chromium_namespace_seccomp');
  await page.goto('https://dev.godcrm.ai/api/health',{waitUntil:'domcontentloaded',timeout:10000});
  checks.push('staging_tls_via_pinned_proxy');
  for(const url of ['https://app.godcrm.ai/','https://crm.hltrn.cc/','https://example.com/','https://<DEV_IP>/','http://169.254.169.254/','http://127.0.0.1:18080/']) {
    let denied=false;try{await page.goto(url,{timeout:1500});}catch{denied=true;}assert.ok(denied);checks.push('proxy_denied:'+url);
  }
  await page.close();
  const wsPage=await context.newPage();
  await wsPage.goto('https://dev.godcrm.ai/api/health',{waitUntil:'domcontentloaded'});
  for (const host of ['app.godcrm.ai','crm.hltrn.cc','example.com','127.0.0.1']) {
    const denied=await wsPage.evaluate(host=>new Promise(resolve=>{
      const socket=new WebSocket('wss://'+host+'/'); const timer=setTimeout(()=>{socket.close();resolve(true);},1000);
      socket.onopen=()=>{clearTimeout(timer);socket.close();resolve(false);};socket.onerror=()=>{clearTimeout(timer);resolve(true);};
    }),host);
    assert.ok(denied);checks.push('websocket_denied:'+host);
  }
  // Synthetic 302 is test stimulus only. The destination is blocked by the
  // actual Unix proxy/network namespace, never by Playwright interception.
  await wsPage.route('https://dev.godcrm.ai/__browser_redirect_fixture__',route=>route.fulfill({status:302,headers:{location:'https://app.godcrm.ai/'}}));
  let redirectDenied=false;
  try{await wsPage.goto('https://dev.godcrm.ai/__browser_redirect_fixture__',{timeout:2000});}catch{redirectDenied=true;}
  assert.ok(redirectDenied);checks.push('redirect_to_ring0_denied');
  await context.close();
  process.stdout.write(JSON.stringify({status:'PASS',checks}));
} catch(error) {
  const sandbox=String(error).includes('Operation not permitted') || String(error).includes('No usable sandbox');
  process.stdout.write(JSON.stringify({status:'BLOCKED',reason:sandbox?'kernel_sandbox_unavailable':'container_validation_failed',diagnostic:String(error).slice(0,900),checks}));
  process.exitCode=1;
} finally {
  await browser?.close();for(const s of sockets)s.destroy();bridge.close();clearTimeout(timer);
}
