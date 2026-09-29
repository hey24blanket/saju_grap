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
