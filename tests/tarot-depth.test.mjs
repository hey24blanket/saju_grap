import test from 'node:test';import assert from 'node:assert/strict';
import {cards} from '../lib/tarotCards.js';
import {readingMaterial,validateGrounding} from '../lib/tarotReadingMaterial.js';
import {validateTarot} from '../lib/tarotValidation.js';
test('every card supplies full selected and opposite meanings with server owned role',()=>{
 for(const c of cards)for(const reversed of [true,false]){const m=readingMaterial({...c,reversed,position:'걸림돌'});assert.equal(m.selectedMeaning.text,reversed?c.guide.reversed:c.guide.upright);assert.equal(m.oppositeMeaning.text,reversed?c.guide.upright:c.guide.reversed);assert.equal(m.picture,c.guide.picture);assert.ok(m.positionLens.includes('판단'));}
});
test('client cannot substitute its own symbolism or orientation label',()=>{
 const x=validateTarot({action:'reading',question:'지금 확장할까요?',messages:[],rounds:[{spread:'one',cards:[{id:'sw02',reversed:true,guide:{picture:'fake'},position:'fake'}]}]});const m=readingMaterial(x.cards[0]);assert.equal(m.orientation,'역방향');assert.notEqual(m.position,'fake');assert.notEqual(m.picture,'fake');
});

test('reject invented picture anchors, wrong orientation meaning, and invented user quotes',()=>{
 const c={...cards.find(c=>c.id==='cu04'),reversed:true};const input={question:'연애운?',messages:[],rounds:[]};
 const g={pictureQuote:c.guide.picture.slice(0,30),meaningQuote:c.guide.reversed.slice(0,30),userQuote:'연애운?'};
 assert.doesNotThrow(()=>validateGrounding(g,c,input));
 for(const bad of[{...g,pictureQuote:'그림에 없는 인물이 걷고 있어요.'},{...g,meaningQuote:c.guide.upright.slice(0,30)},{...g,userQuote:'나는 에너지가 바닥났어요.'}])assert.throws(()=>validateGrounding(bad,c,input));
});

test('every card and direction supplies copyable excerpts that pass the unchanged source checks',()=>{
 const input={question:'지금 새로운 일을 시작할지, 하던 일을 유지할지 고민이에요.',messages:[],rounds:[]};
 for(const card of cards)for(const reversed of [false,true]){
  const c={...card,reversed,position:'현재'},material=readingMaterial(c,input);
  assert.ok(material.groundingReferences.pictureQuote.length<=120);
  assert.ok(material.groundingReferences.meaningQuote.length<=120);
  assert.equal(material.groundingReferences.userQuote,input.question);
  assert.doesNotThrow(()=>validateGrounding(material.groundingReferences,c,input));
 }
});

test('follow-up references use the actual round question, including short questions',()=>{
 const input=validateTarot({action:'reading',question:'어떻게 시작할까요?',messages:[],context:{},rounds:[
  {spread:'one',question:'어떻게 시작할까요?',cards:[{id:'ar01',reversed:false}]},
  {spread:'advice',question:'왜요?',cards:[{id:'sw04',reversed:true}]}
 ]});
 const c=input.cards.at(-1),references=readingMaterial(c,input).groundingReferences;
 assert.equal(references.userQuote,'왜요?');
 assert.equal(references.meaningQuote,c.guide.reversed.trim().slice(0,120));
 assert.doesNotThrow(()=>validateGrounding(references,c,input));
});

test('prepared references do not authorize changed source text or opposite meanings',()=>{
 const c={...cards.find(x=>x.id==='ar01'),reversed:false,position:'현재'};
 const input={question:'대화를 다시 시작하고 싶어요.',messages:[],rounds:[]};
 const reference=readingMaterial(c,input).groundingReferences;
 for(const [field,quote] of [
  ['pictureQuote','원문에 없는 새로운 장면입니다.'],
  ['meaningQuote',c.guide.reversed.slice(0,80)],
  ['userQuote','상대는 이미 저를 좋아한다고 말했어요.']
 ]){
  assert.throws(()=>validateGrounding({...reference,[field]:quote},c,input),e=>{
   assert.equal(e.message,'UNGROUNDED_CARD_READING_'+field);
   assert.ok(!e.message.includes(quote));
   return true;
  });
 }
});

test('other accurate excerpts remain accepted without requiring a single fixed quote',()=>{
 const c={...cards.find(x=>x.id==='sw02'),reversed:true,position:'현재'};
 const input={question:'사업 확장 여부를 결정하려고 해요.',messages:[],rounds:[]};
 const g={pictureQuote:c.guide.picture.slice(20,75),meaningQuote:c.guide.reversed.slice(25,85),userQuote:input.question};
 assert.doesNotThrow(()=>validateGrounding(g,c,input));
});
