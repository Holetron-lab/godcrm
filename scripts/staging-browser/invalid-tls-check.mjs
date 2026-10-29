// Counterfactual TLS test: a self-signed dev.godcrm.ai endpoint behind the same
// Unix proxy must be rejected by Chromium. No certificate is trusted/installed.
import net from 'node:net';
import { chromium } from 'playwright';
const sockets=new Set();
const bridge=net.createServer(peer=>{const remote=net.createConnection('/egress.sock');sockets.add(peer);sockets.add(remote);peer.pipe(remote).pipe(peer);for(const s of [peer,remote])s.on('error',()=>{peer.destroy();remote.destroy();});});
await new Promise(resolve=>bridge.listen(18080,'127.0.0.1',resolve));
let browser;
const timer=setTimeout(()=>process.exit(3),15000);
try {
  browser=await chromium.launch({channel:'chromium',headless:true,chromiumSandbox:true,proxy:{server:'http://127.0.0.1:18080',bypass:'<-loopback>'},args:['--ssl-version-max=tls1.2','--disable-quic']});
  const context=await browser.newContext({ignoreHTTPSErrors:false});const page=await context.newPage();
  let rejected=false;
  try{await page.goto('https://dev.godcrm.ai/',{timeout:6000});}catch(error){rejected=String(error).includes('ERR_CERT_AUTHORITY_INVALID');}
  process.stdout.write(JSON.stringify({status:rejected?'PASS':'FAIL',checks:rejected?['invalid_certificate_rejected']:[]}));
  if(!rejected)process.exitCode=1;
} finally {await browser?.close();for(const s of sockets)s.destroy();bridge.close();clearTimeout(timer);}
