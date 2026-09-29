import test from 'node:test';
import assert from 'node:assert/strict';
import {eligible,summarize,authorize,categories} from '../lib/blanketRag.js';
test('Only active production version can reach Blanket',()=>{
 assert.equal(eligible({ragVersion:'v1',status:'active'},'v1'),true);
 for(const d of [{ragVersion:'draft'},{ragVersion:'v1',status:'inactive'},{ragVersion:'v1',corpus:'evaluation_negative'},{ragVersion:'v1',reviewedManifest:{retrievalAllowed:false}}])assert.equal(eligible(d,'v1'),false);
 assert.equal(eligible({ragVersion:'draft'},null),false);
});
test('Knowledge deduplicates across chunks and missing classification stays unknown',()=>{
 const summary=summarize([{id:'a',data:{knowledgeId:'k',category:{domain:'심리',topic:'관계'}},vec:[1]},{id:'b',data:{knowledgeId:'k',category:{domain:'심리',topic:'관계'}},vec:[1]},{id:'c',data:{},vec:null}],null,'now');
 assert.equal(summary.chunks,3);assert.equal(summary.knowledgeCount,1);assert.equal(summary.unidentifiedChunks,1);assert.equal(summary.searchable,2);
 assert.equal(summary.categories.find(c=>c.name==='미분류').chunks,1);assert.equal(summary.categories.find(c=>c.name==='심리').chunks,2);
});
test('Missing and expired authentication cannot read RAG',async()=>{
 await assert.rejects(()=>authorize({headers:{},body:{action:'inventory'}}));
 const payload=Buffer.from(JSON.stringify({iss:'https://app-idea-git-build-daily-pitch-blanket2.vercel.app',aud:'sajugrap-rag',scope:'rag:read',sub:'user',iat:1,exp:2})).toString('base64url');
 await assert.rejects(()=>authorize({headers:{authorization:`Bearer ${payload}.invalid`},body:{action:'inventory'}}));
});

test('Slash hierarchy preserves the stored category path',()=>{assert.deepEqual(categories({category:'cycle/transition/month'}),['cycle','transition','month']);});
