import test from 'node:test';
import assert from 'node:assert/strict';
import { DeviceConnection, openInBrowser } from '../plugins/100x/scripts/device-auth.mjs';

function client(fetchImpl,save=async()=>{}) {
  const value=new DeviceConnection({HUNDREDX_CONFIG_PATH:'unused-test-path'},{fetch:fetchImpl,save});
  value.loaded=true;
  value.pending={url:'http://127.0.0.1:4188/api/mcp',deviceCode:'a'.repeat(64),user_code:'ABC1234567',verification_uri:'http://127.0.0.1:5175/?connect_100x=ABC1234567',expires_at:new Date(Date.now()+600000).toISOString()};
  value.persist=async()=>{};
  return value;
}
const response=data=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});

test('denial remains visible after the private pending request is cleared',async()=>{
  let saves=0;const c=client(async()=>response({status:'denied'}),async()=>{saves++;});
  await c.advance();assert.equal(c.pending,null);assert.equal((await c.status()).status,'denied');assert.equal(saves,0);clearTimeout(c.timer);
});
test('expired authorization never claims or saves a token',async()=>{
  let calls=0;const c=client(async()=>{calls++;throw new Error('must not call');});c.pending.expires_at=new Date(0).toISOString();
  await c.advance();assert.equal((await c.status()).status,'expired');assert.equal(calls,0);clearTimeout(c.timer);
});
test('network loss keeps the same request and never reauthorizes',async()=>{
  let calls=0;const c=client(async()=>{calls++;throw new Error('offline');});
  await c.advance();assert.equal(c.publicState().status,'offline');
  const [a,b]=await Promise.all([c.connect(),c.connect()]);assert.equal(a.user_code,b.user_code);assert.equal(calls,1);
  assert.ok(!JSON.stringify(a).includes('deviceCode'));clearTimeout(c.timer);
});
test('lost acknowledgement retries the saved grant without requesting another token',async()=>{
  let claims=0,acks=0,saves=0;const c=client(async url=>{
    if(String(url).endsWith('/token')) {claims++;return response({status:'approved',access_token:'100x_'+'b'.repeat(48)});}
    acks++;if(acks===1)throw new Error('reply lost');return response({status:'connected'});
  },async()=>{saves++;});
  await c.advance();assert.equal(c.publicState().status,'offline');assert.equal(saves,1);
  await c.advance();assert.equal(c.publicState().status,'connected');assert.equal(claims,1);assert.equal(acks,2);assert.equal(saves,2);clearTimeout(c.timer);
});
test('connect opens the authorization page itself, again when the same request is resumed',async()=>{
  const opened=[];const c=client(async()=>response({status:'pending'}));c.open=url=>{opened.push(url);return true;};
  const state=await c.connect();assert.equal(state.browser_opened,true);assert.equal(state.user_code,'ABC1234567');
  assert.equal((await c.connect()).browser_opened,true);assert.deepEqual(opened,[c.pending.verification_uri,c.pending.verification_uri]);clearTimeout(c.timer);
});
test('without a browser the link is still returned and marked unopened',async()=>{
  for(const open of [()=>{throw new Error('no opener');},async()=>false]) {
    const c=client(async()=>response({status:'pending'}));c.open=open;
    const state=await c.connect();assert.equal(state.browser_opened,false);assert.ok(state.verification_uri);clearTimeout(c.timer);
  }
});
test('openInBrowser reports a failed system opener as unopened',async()=>{
  assert.equal(await openInBrowser('https://100xspeed.app/','linux'),false);
});
test('only http and https authorization pages reach the browser',async()=>{
  for(const verification of ['ftp://127.0.0.1/x','blob:http://127.0.0.1:4188/x']) {
    const opened=[];const c=new DeviceConnection({HUNDREDX_URL:'http://127.0.0.1:4188/api/mcp',HUNDREDX_CONFIG_PATH:'unused-test-path'},{open:url=>{opened.push(url);return true;},fetch:async url=>String(url).endsWith('/device')?response({verification_uri:verification,user_code:'ABC1234567',expires_at:new Date(Date.now()+600000).toISOString()}):response({},401)});
    c.loaded=true;c.persist=async()=>{};c.status=async()=>{const e=new Error('x');e.code='100X_NOT_CONNECTED';throw e;};
    await assert.rejects(c.connect(),{code:'100X_PROTOCOL_ERROR'});assert.deepEqual(opened,[]);
  }
});
test('status never polls sooner than the server interval after the previous poll',async()=>{
  const at=[];const c=client(async()=>{at.push(Date.now());return response({status:'pending'});});c.delay=200;c.lastPoll=Date.now();
  await c.status({wait:700});clearTimeout(c.timer);
  assert.ok(at.length>=2);for(let i=1;i<at.length;i++)assert.ok(at[i]-at[i-1]>=190,String(at[i]-at[i-1]));
});
test('a slow poll does not stretch status past its wait',async()=>{
  const c=client(async()=>{await new Promise(r=>setTimeout(r,800));return response({status:'pending'});});c.delay=20;
  const started=Date.now();const state=await c.status({wait:150});assert.equal(state.status,'waiting');assert.ok(Date.now()-started<500,String(Date.now()-started));clearTimeout(c.timer);
});
test('status waits for the approval and returns connected without another tool call',async()=>{
  let claims=0;const c=client(async url=>{
    if(String(url).endsWith('/token')) {claims++;return response(claims<2?{status:'pending'}:{status:'approved',access_token:'100x_'+'b'.repeat(48)});}
    return response({status:'connected'});
  });c.delay=20;
  const state=await c.status({wait:5000});assert.equal(state.status,'connected');assert.equal(claims,2);clearTimeout(c.timer);
});
test('status stops waiting at the deadline and reports waiting',async()=>{
  const c=client(async()=>response({status:'pending'}));c.delay=20;
  const started=Date.now();const state=await c.status({wait:120});assert.equal(state.status,'waiting');assert.ok(Date.now()-started<1000);clearTimeout(c.timer);
});
test('after approval, failed saves retry no faster than the poll interval',async()=>{
  const saves=[];const c=client(async()=>response({status:'approved',access_token:'100x_'+'b'.repeat(48)}),async()=>{saves.push(Date.now());throw new Error('locked');});c.delay=100;
  await c.status({wait:450});clearTimeout(c.timer);
  assert.ok(saves.length>=2 && saves.length<=6,String(saves.length));for(let i=1;i<saves.length;i++)assert.ok(saves[i]-saves[i-1]>=95,String(saves[i]-saves[i-1]));
});
test('the interval counts from when the previous reply arrived',async()=>{
  const sent=[];let first=true;const c=client(async()=>{sent.push(Date.now());if(first){first=false;await new Promise(r=>setTimeout(r,120));}return response({status:'pending'});});c.delay=100;
  await c.status({wait:400});clearTimeout(c.timer);
  assert.ok(sent.length>=2);assert.ok(sent[1]-sent[0]>=215,String(sent[1]-sent[0]));
});
test('an expiry stays visible when clearing the local request fails',async()=>{
  const c=client(async()=>{throw new Error('must not call');});c.pending.expires_at=new Date(0).toISOString();c.persist=async()=>{throw new Error('disk full');};
  await c.advance();clearTimeout(c.timer);assert.equal(c.publicState().status,'expired');assert.equal((await c.status()).status,'expired');
});
test('status returns soon after the background poll connects',async()=>{
  let claims=0;const c=client(async url=>String(url).endsWith('/token')?(++claims>1?response({status:'approved',access_token:'100x_'+'b'.repeat(48)}):response({status:'pending'})):response({status:'connected'}));c.delay=1000;
  await c.advance();const started=Date.now();const waiting=c.status({wait:5000});
  await new Promise(r=>setTimeout(r,1050));await c.advance();
  assert.equal((await waiting).status,'connected');assert.ok(Date.now()-started<1500,String(Date.now()-started));clearTimeout(c.timer);
});
test('the link and code come back even if the request ends while the browser opens',async()=>{
  const c=client(async()=>response({status:'pending'}));c.open=async()=>{c.pending=null;c.state={status:'expired'};return false;};
  const state=await c.connect();assert.equal(state.browser_opened,false);assert.ok(state.verification_uri);assert.equal(state.user_code,'ABC1234567');
});
