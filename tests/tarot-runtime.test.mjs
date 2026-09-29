import test from 'node:test';
import assert from 'node:assert/strict';
import {consumeLimit} from '../lib/tarotRateLimit.js';
import {mutatePrivate} from '../lib/tarotRuntimeStore.js';
import {usableSnapshot} from '../lib/tarotSnapshot.js';
test('concurrent requests never lose increments or pass the IP cap',async()=>{
  let value,revision=0;
  const read=async()=>value?{value:structuredClone(value),etag:String(revision)}:null;
  const write=async(_p,next,etag)=>{await new Promise(r=>setTimeout(r,1));if(etag!==(revision?String(revision):undefined))throw Error('precondition failed');value=structuredClone(next);revision++;};
  const results=await Promise.allSettled(Array.from({length:25},()=>mutatePrivate('test',old=>consumeLimit(old,'same-ip',10000000),{read,write,attempts:80})));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,15);
  assert.equal(value.count,15);
  assert.ok(results.filter(r=>r.status==='rejected').every(r=>r.reason.message==='RATE_LIMIT'));
});
test('global cap, bucket rollover and store failure stay enforced',async()=>{
  const now=10000000,day=Math.floor(now/86400000);
  assert.throws(()=>consumeLimit({day,count:300,ips:{}},'new',now),/RATE_LIMIT/);
  const next=consumeLimit({day,count:20,ips:{same:{bucket:Math.floor(now/600000)-1,count:15}}},'same',now);
  assert.equal(next.count,21);assert.equal(next.ips.same.count,1);
  await assert.rejects(mutatePrivate('x',()=>({}),{read:async()=>{throw Error('offline')}}),/offline/);
});
test('snapshot is bounded and never treats malformed or expired data as approved',()=>{
  const now=Date.now(),s={schema:1,createdAt:now,rows:[{text:'approved',kind:'tarot'}],summary:{}};
  assert.equal(usableSnapshot(s,now),true);
  assert.equal(usableSnapshot({...s,createdAt:now-86400001},now),false);
  assert.equal(usableSnapshot({...s,rows:[{kind:'other'}]},now),false);
});
