import test from 'node:test';
import assert from 'node:assert/strict';
import {cards} from '../lib/tarotCards.js';
import {cardSymbols,symbolsFor} from '../lib/tarotSymbols.js';
import {readingMaterial,parseCardCallout} from '../lib/tarotReadingMaterial.js';
import {parseResponse} from '../lib/tarotResponse.js';
import {validateTarot} from '../lib/tarotValidation.js';

const legacy=validateTarot({action:'reading',question:'월급 때문에 퇴사가 망설여져요.',messages:[],context:{},rounds:[{spread:'one',cards:[{id:'ar15',reversed:true}]}]});
const visual={...legacy,visualMode:'callout-v1'};
const multi={...legacy,visualMode:'callout-v2'};
const c=visual.cards[0];
const callout=()=>({symbolId:cardSymbols[c.id].id,text:'목의 사슬은 월급 때문에 퇴사가 망설여진다는 이야기와 닿아 있어요. 수입을 지키면서도 선택할 여지를 넓히는 것이 이 카드가 짚는 과제예요.'});
const response=()=>({
 message:'월급을 지키는 일과 떠나고 싶은 마음 사이에서 고민하고 계시는군요.',
 cardReadings:[{id:c.id,grounding:readingMaterial(c,visual).groundingReferences,lead:'퇴사 여부를 곧장 정하기보다 선택할 조건을 준비하는 쪽입니다.',body:'퇴사를 망설이는 이유로 월급을 말씀하셨으니, 이번 해석의 기준은 그 수입이 맡고 있는 역할입니다. <악마> 역방향은 연결을 알아차리는 데서 한 걸음 더 나아가, 그 강도를 바꿀 조건을 마련하는 쪽이에요. 떠나고 싶은 마음을 증명하려고 바로 결론을 낼 필요는 없습니다.\n\n지금 지킬 생활의 기반과 바꿔볼 여지가 있는 부분을 나눠보세요. 무엇이 준비되면 선택이 달라지는지 설명할 수 있어야 기다리는 시간에도 목적이 생깁니다. 이 카드가 제안하는 변화는 단번에 모든 것을 끊는 행동보다, 실제로 선택할 수 있는 범위를 조금씩 넓히는 방향입니다.',callout:callout()}],
 summary:[
  {title:'지금 질문에 대한 답',body:'지금은 퇴사 여부를 급히 확정하기보다, 월급 때문에 선택이 좁아지는 조건을 구별하는 쪽입니다. <악마> 역방향은 연결의 강도를 조절할 준비를 읽으며, 수입을 지키려는 현실적인 이유를 무시하지 않습니다.'},
  {title:'카드가 짚는 차이',body:'떠나고 싶은 마음을 아는 것과 실제로 떠날 여건을 갖추는 것은 서로 다른 단계입니다. 이 카드가 강조하는 것은 의지를 더 강하게 만드는 일이 아니라, 무엇이 갖춰져야 다른 선택을 할 수 있는지 구체화하는 일입니다.'},
  {title:'선택의 기준',body:'무엇을 지켜야 하고 무엇을 바꿔도 되는지 나눠보세요. 그 기준이 생기면 남아 있는 시간도 준비의 시간이 됩니다. 언제나 참아야 한다거나 당장 그만두어야 한다는 판정 대신, 준비된 조건에 따라 선택을 다시 보는 방향입니다.'}
 ],context:{}
});

test('visual reading materials expose only the canonical focus symbol, independent of orientation',()=>{
 for(const card of cards)for(const reversed of [false,true]){
  const canonical=cardSymbols[card.id];
  assert.ok(canonical,card.id);
  const material=readingMaterial({...card,reversed,position:'현재'},visual);
  assert.deepEqual(material.focusSymbol,{id:canonical.id,label:canonical.label,evidence:canonical.evidence});
  assert.equal(material.focusSymbol.x,undefined);
  assert.equal(material.focusSymbol.y,undefined);
 }
 assert.equal(readingMaterial(c,legacy).focusSymbol,undefined);
});

test('visual response preserves the symbol text without accepting model coordinates',()=>{
 const d=response();d.cardReadings[0].callout.x=.99;d.cardReadings[0].callout.y=.01;
 const parsed=parseResponse(JSON.stringify(d),visual);
 assert.deepEqual(parsed.cardReadings[0].callout,callout());
 assert.match(parsed.cardReadings[0].body,/생활/);
});

test('multi-symbol reading has 2–4 canonical anchors and preserves concise text without coordinates',()=>{
 const material=readingMaterial(c,multi),symbols=symbolsFor(c.id);
 assert.deepEqual(material.focusSymbols,symbols.map(({id,label,evidence})=>({id,label,evidence})));
 const d=response();delete d.cardReadings[0].callout;
 d.cardReadings[0].callouts=symbols.slice(0,2).map(s=>({symbolId:s.id,text:'월급을 지키면서 퇴사 여부를 고르는 일과 닿아요.',x:.01}));
 const parsed=parseResponse(JSON.stringify(d),multi);
 assert.deepEqual(parsed.cardReadings[0].callouts,d.cardReadings[0].callouts.map(({symbolId,text})=>({symbolId,text})));
 for(const invalid of [[d.cardReadings[0].callouts[0]],[d.cardReadings[0].callouts[0],d.cardReadings[0].callouts[0]],[{symbolId:'invented',text:'아주 길고 그럴듯한 새 상징이에요.'},d.cardReadings[0].callouts[1]]]){
  d.cardReadings[0].callouts=invalid;
  assert.throws(()=>parseResponse(JSON.stringify(d),multi),/INVALID_CALLOUT/);
 }
 delete d.cardReadings[0].callouts;
 assert.throws(()=>parseResponse(JSON.stringify(d),multi),/MISSING_CARD_CALLOUTS/);
});

test('callouts are required only for the new visual contract; legacy content stays usable',()=>{
 const d=response();delete d.cardReadings[0].callout;
 assert.throws(()=>parseResponse(JSON.stringify(d),visual),/MISSING_CARD_CALLOUT/);
 const parsed=parseResponse(JSON.stringify(d),legacy);
 assert.equal(parsed.cardReadings[0].callout,undefined);
 assert.equal(parsed.cardReadings[0].body,d.cardReadings[0].body);
 assert.deepEqual(parseResponse(JSON.stringify(response()),legacy).cardReadings[0].callout,callout());
});

test('invented and cross-card symbol ids are rejected rather than placed on the wrong image',()=>{
 const other=Object.values(cardSymbols).find(s=>s.id!==cardSymbols[c.id].id);
 for(const symbolId of ['invented_symbol',other.id]){
  const d=response();d.cardReadings[0].callout.symbolId=symbolId;
  assert.throws(()=>parseResponse(JSON.stringify(d),visual),/INVALID_CALLOUT_SYMBOL/);
 }
});

test('empty or oversized callouts are rejected while readable short text remains allowed',()=>{
 for(const text of ['', '   ', '짧음', '가'.repeat(241)]){
  assert.throws(()=>parseCardCallout({...callout(),text},c,{required:true}),/INVALID_CALLOUT_TEXT/);
 }
 const short='수입을 지키면서 선택할 여지를 넓히는 상징이에요.';
 assert.equal(parseCardCallout({...callout(),text:short},c).text,short);
});

test('a valid symbol does not bypass the original selected-direction grounding check',()=>{
 const d=response();d.cardReadings[0].grounding.meaningQuote=c.guide.upright.slice(0,80);
 assert.throws(()=>parseResponse(JSON.stringify(d),visual),/UNGROUNDED_CARD_READING_meaningQuote/);
});

test('clarification does not require a card callout even from a new client',()=>{
 const input={...visual,action:'clarify',rounds:[],cards:[]};
 const result=parseResponse(JSON.stringify({message:'월급이 가장 중요한 조건이군요.',choices:[],context:{}}),input);
 assert.deepEqual(result.cardReadings,[]);
});
