import test from 'node:test';import assert from 'node:assert/strict';
import {createStoryRepository,normalizeThreads,userStoryPath} from '../lib/tarotStoryStore.js';
import {requireTarotUser} from '../lib/tarotUserAuth.js';
import {createHandler} from '../api/tarot-stories.js';
import {memoizeFor} from '../lib/tarotMemo.js';
const thread=(id='one')=>({id,title:'테스트 고민',createdAt:1,updatedAt:1,status:'active',memory:{enabled:false,text:''},entries:[],sessions:[]});
function fakeStorage(){const values=new Map();return{values,read:async k=>values.get(k)||null,write:async(k,v,etag)=>{const old=values.get(k);if(old?old.etag!==etag:etag!==undefined)throw Error('precondition failed');values.set(k,{value:v,etag:String((Number(old?.etag)||0)+1)});}};}
test('authentication rejects missing, expired, anonymous and unverified tokens',async()=>{
 for(const user of [{uid:'u',email_verified:false},{uid:'u',email_verified:true,firebase:{sign_in_provider:'anonymous'}},{}])await assert.rejects(requireTarotUser({headers:{authorization:'Bearer x'}},{verify:async()=>user}));
 await assert.rejects(requireTarotUser({headers:{}},{verify:async()=>({uid:'u',email_verified:true})}),{status:401});
 await assert.rejects(requireTarotUser({headers:{authorization:'Bearer x'}},{verify:async()=>{throw Error('expired');}}),{status:401});
 assert.equal((await requireTarotUser({headers:{authorization:'Bearer x'}},{verify:async()=>({uid:'u',email_verified:true})})).uid,'u');
});
test('account paths are server-derived and distinct, stale revisions never overwrite',async()=>{
 const store=fakeStorage(),repo=createStoryRepository(store);assert.notEqual(userStoryPath('alice'),userStoryPath('bob'));
 await repo.update('alice',{revision:0,epoch:0,threads:[thread()],deleted:[]});assert.equal((await repo.get('bob')).threads.length,0);
 await assert.rejects(repo.update('alice',{revision:0,epoch:0,threads:[],deleted:[]}),{status:409});assert.equal((await repo.get('alice')).threads.length,1);
});
test('simultaneous writes allow only one commit and report latest for recovery',async()=>{
 const repo=createStoryRepository(fakeStorage()),p={revision:0,epoch:0,threads:[thread()],deleted:[]};
 const results=await Promise.allSettled([repo.update('a',p),repo.update('a',{...p,threads:[thread('two')]})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.latest.revision,1);
});
test('missing records require explicit deletion and tombstones prevent resurrection',async()=>{
 const repo=createStoryRepository(fakeStorage());await repo.update('a',{revision:0,epoch:0,threads:[thread()],deleted:[]});
 await assert.rejects(repo.update('a',{revision:1,epoch:0,threads:[],deleted:[]}),{status:409});
 await repo.update('a',{revision:1,epoch:0,threads:[],deleted:['one']});
 const result=await repo.update('a',{revision:2,epoch:0,threads:[thread()],deleted:[]});assert.equal(result.threads.length,0);
});
test('clearing account advances epoch so offline devices cannot restore old records',async()=>{
 const repo=createStoryRepository(fakeStorage());await repo.update('a',{revision:0,epoch:0,threads:[thread()],deleted:[]});
 const cleared=await repo.update('a',{revision:1,epoch:0},{clear:true});assert.equal(cleared.epoch,1);
 await assert.rejects(repo.update('a',{revision:2,epoch:0,threads:[thread()],deleted:[]}),{status:409});
});
test('record schema rejects oversized, duplicate and invented data',()=>{
 assert.throws(()=>normalizeThreads([thread(),thread()]));assert.throws(()=>normalizeThreads([{...thread(),id:'../../another-user'}]));
 assert.throws(()=>normalizeThreads([{...thread(),memory:{text:'a'.repeat(301)}}]));
 const t=thread();t.sessions=[{id:'s',question:'q',mode:'short',spread:'one',roles:['현재'],cards:[{id:'fake',reversed:false}],messages:[],createdAt:1}];assert.throws(()=>normalizeThreads([t]));
});
function response(){return{headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(d){this.data=d;return this;},end(){return this;}};}
test('HTTP route ignores forged uid, rejects other origins and requires recent login to clear',async()=>{
 let called;const handler=createHandler({authenticate:async()=>({uid:'actual',auth_time:1}),repo:{get:async uid=>{called=uid;return{};}}});
 let res=response();await handler({method:'GET',headers:{},query:{uid:'victim'}},res);assert.equal(called,'actual');
 res=response();await handler({method:'GET',headers:{origin:'https://attacker.example'}},res);assert.equal(res.code,403);
 res=response();await handler({method:'DELETE',headers:{},body:{revision:0,epoch:0}},res);assert.equal(res.code,401);assert.equal(res.data.reauth,true);
});
test('warm retrieval cache coalesces work, expires, and recovers after failure',async()=>{
 let n=0,clock=0;const memo=memoizeFor(async()=>{n++;return{n};},60,()=>clock);
 await Promise.all([memo(),memo()]);assert.equal(n,1);clock=59;await memo();assert.equal(n,1);clock=61;await memo();assert.equal(n,2);
 let fail=true;const retry=memoizeFor(async()=>{if(fail)throw Error('offline');return'ok';});await assert.rejects(retry());fail=false;assert.equal(await retry(),'ok');
});
