import test from 'node:test';
import assert from 'node:assert/strict';
import { DeviceConnection } from '../plugins/100x/scripts/device-auth.mjs';

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
  const c=client(async()=>response({status:'pending'}));c.open=()=>{throw new Error('no opener');};
  const state=await c.connect();assert.equal(state.browser_opened,false);assert.ok(state.verification_uri);clearTimeout(c.timer);
});
test('status waits for the approval and returns connected without another tool call',async()=>{
  let claims=0;const c=client(async url=>{
    if(String(url).endsWith('/token')) {claims++;return response(claims<2?{status:'pending'}:{status:'approved',access_token:'100x_'+'b'.repeat(48)});}
    return response({status:'connected'});
  });c.delay=20;c.env={HUNDREDX_URL:'http://127.0.0.1:4188/api/mcp',HUNDREDX_TOKEN:'100x_'+'b'.repeat(48)};
  const state=await c.status({wait:5000});assert.equal(state.status,'connected');assert.equal(claims,2);clearTimeout(c.timer);
});
test('status stops waiting at the deadline and reports waiting',async()=>{
  const c=client(async()=>response({status:'pending'}));c.delay=20;
  const started=Date.now();const state=await c.status({wait:120});assert.equal(state.status,'waiting');assert.ok(Date.now()-started<1000);clearTimeout(c.timer);
});
