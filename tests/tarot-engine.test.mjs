import test from 'node:test';
import assert from 'node:assert/strict';
import {cards} from '../lib/tarotCards.js';
import {meanings} from '../lib/tarotMeaningData.js';
import {validateTarot} from '../lib/tarotValidation.js';
import {evidenceMaterial,validateInterpretation,parseReader,generateReading} from '../lib/tarotEngine.js';
import {references} from '../eval/tarot-engine/reference-readings.js';
import fs from 'node:fs';
const cases=JSON.parse(fs.readFileSync(new URL('../eval/tarot-engine/cases.json',import.meta.url)));
const input=c=>validateTarot({action:'reading',visualMode:'callout-v2',question:c.question,rounds:c.rounds,messages:[],context:{facts:['사용자가 직접 말한 사실']}});
const i=input(cases[0]);
const plan={answer:'지금은 연락을 멈추세요.',distinction:'조회와 답장은 다릅니다.',unknowns:['상대의 속마음'],nextStep:'추가 메시지를 보내지 마세요.',cards:i.cards.map(c=>({id:c.id,meaningId:evidenceMaterial(c).selectedMeaning.id,symbolIds:[evidenceMaterial(c).pictureFacts[0].id],application:'그 자리에서 질문을 해석한 문장입니다.'}))};
test('all 78 cards have two separate editorial meanings and real picture references',()=>{
 assert.equal(Object.keys(meanings).length,78);
 for(const c of cards)for(const reversed of [false,true]){const m=evidenceMaterial({...c,reversed,position:'현재'});assert.ok(m.selectedMeaning.text.length>10);assert.ok(m.pictureFacts.length>=2);assert.ok(m.selectedMeaning.id.includes(reversed?':reversed:':':upright:'));}
});
test('evidence rejects wrong direction, wrong card, missing cards, and invented symbols',()=>{
 assert.ok(validateInterpretation(plan,i));
 for(const edit of [p=>p.cards[0].meaningId='sw04:reversed:v13',p=>p.cards[0].id='cuac',p=>p.cards.pop(),p=>p.cards[0].symbolIds=['invented'],p=>p.cards[0].symbolIds=[]]){const p=structuredClone(plan);edit(p);assert.throws(()=>validateInterpretation(p,i));}
});
test('all 20 fixtures and five full editorial references meet the product contract',()=>{
 assert.equal(cases.length,20);assert.equal(cases.filter(c=>c.split==='holdout').length,10);
 for(const c of cases){const v=input(c);if(references[c.id]){const d=parseReader({message:references[c.id].summary[0].body,...references[c.id]},v);assert.deepEqual(d.context,v.context);assert.ok(d.cardReadings.every(x=>x.callouts.length===2));}}
});
test('staged generation expands only validated references and never promotes model context',async()=>{
 let n=0;
 const reader={message:references.reunion.summary[0].body,...references.reunion,context:{facts:['만들어낸 사실']}};
 const result=await generateReading(i,{results:[]},{strategy:'staged',complete:async({payload})=>{n++;if(n===2){const p=JSON.parse(payload);assert.equal(p.supports[0].pictureFacts.length,1);assert.equal(p.supports[0].selectedMeaning.id,plan.cards[0].meaningId);}return {text:JSON.stringify(n===1?plan:reader),metrics:{elapsedMs:1}};}});
 assert.equal(n,2);assert.deepEqual(result.context,i.context);
 let calls=0;await assert.rejects(generateReading(i,{results:[]},{strategy:'staged',complete:async()=>{calls++;return {text:JSON.stringify({...plan,cards:[]})};}}));assert.equal(calls,1);
});
test('single and staged use same validated output adapter; malformed outputs fail closed',async()=>{
 const reader={message:references.reunion.summary[0].body,...references.reunion};
 const r=await generateReading(i,{results:[]},{complete:async()=>({text:JSON.stringify({interpretation:plan,reading:reader}),metrics:{}})});
 assert.equal(r.summary.length,3);
 assert.throws(()=>parseReader({...reader,cardReadings:[...reader.cardReadings].reverse()},i));
 assert.throws(()=>parseReader({...reader,summary:[]},i));
 assert.throws(()=>parseReader({...reader,message:''},i));
});
