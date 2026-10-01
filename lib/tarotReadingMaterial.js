// Server-owned card material keeps direction and role explicit throughout generation.
import {cardSymbols,symbolsFor} from './tarotSymbols.js';
const lenses={현재:'사용자의 질문에서 지금 가장 중요한 쟁점을 한 문장으로 짚고 카드의 그림과 방향으로 설명한다.',걸림돌:'무엇이 판단이나 진행을 어렵게 하는지 구체적으로 짚는다. 사용자 성격이나 말하지 않은 과거를 만들어내지 않는다.',대응:'앞선 쟁점에 어떤 태도나 행동으로 응답할지 분명히 제안하고 그 카드의 근거를 설명한다. 선택의 제안과 미래 결과의 보장은 구분한다.'};
export const READING_VERSION='tarot-depth-v10-multi-callout';
const excerpt=s=>String(s||'').trim().slice(0,120);
export function readingMaterial(c,input){
 const g=c.guide,selectedText=c.reversed?g.reversed:g.upright;
 const userQuestion=input?.rounds?.[c.round]?.question||input?.question;
 // Copyable server-owned excerpts reduce accidental paraphrasing in hidden evidence.
 // Validation still checks each returned quote against its original source and direction.
 const groundingReferences=userQuestion?{pictureQuote:excerpt(g.picture),meaningQuote:excerpt(selectedText),userQuote:excerpt(userQuestion)}:undefined;
 const symbol=['callout-v1','callout-v2'].includes(input?.visualMode)?cardSymbols[c.id]:undefined;
 const focusSymbol=symbol?{id:symbol.id,label:symbol.label,evidence:symbol.evidence}:undefined;
 const focusSymbols=input?.visualMode==='callout-v2'?symbolsFor(c.id).map(({id,label,evidence})=>({id,label,evidence})):undefined;
 return{id:c.id,name:c.name,reversed:c.reversed,orientation:c.reversed?'역방향':'정방향',position:c.position,positionLens:lenses[c.position]||`${c.position}이라는 자리의 질문에 답한다.`,theme:g.theme,picture:g.picture,selectedMeaning:{title:c.reversed?g.reversedTitle:g.uprightTitle,text:selectedText},oppositeMeaning:{title:c.reversed?g.uprightTitle:g.reversedTitle,text:c.reversed?g.upright:g.reversed},reflection:g.question,groundingReferences,focusSymbol,focusSymbols};
}
export const READING_TASK='최신 round 각 카드에 정확한 id의 cardReadings를 작성한다. grounding은 각 카드의 groundingReferences 객체를 문자열 수정 없이 그대로 복사한다. lead에서 질문과 자리에 대한 핵심 해석을 먼저 답한다. visualMode가 callout-v2이면 focusSymbols의 서로 다른 2~4개 id로 짧은 callouts=[{symbolId,text}]를 작성한다. text는 그림의 서로 다른 부분과 사용자가 실제 말한 쟁점을 잇는 20~55자의 한 문장이고 상징 제목은 반복하지 않는다. body는 160~260자의 짧은 두 문단으로 답과 이유·선택 기준에 집중한다. visualMode가 callout-v1이면 각 카드에 callout={symbolId:focusSymbol.id,text:상징과 실제 질문을 연결한 40~120자}를 반드시 작성한다. 이때 body는 카드 탭 후 읽을 핵심 해석 2문단, 보통 250~400자로 질문에 대한 의미와 기준에 집중하고 콜아웃의 그림 설명을 반복하지 않는다. 다른 모드의 body는 보통 250~450자의 2~3문단이며 그림·선택 방향의 근거와 질문에의 적용을 설명한다. 내용이 충분하면 짧게 끝내고 분량을 채우지 않는다. summary는 보통 합계 400~700자의 3개 소제목이다. 첫 항목에서 결론을 먼저 말하고, 카드 조합의 근거, 선택의 대가나 다음 기준을 잇는다. 두 선택은 A/B의 결정적인 차이와 각 선택이 얻고 감수하는 것을 설명한다. 사용자가 말한 목표가 있으면 그 목표에 더 맞는 방향을 제시하고, 없으면 어떤 목표에 어느 선택이 맞는지 말한다. 추가 카드는 앞선 풀이를 반복하지 말고 무엇이 구체화되거나 달라졌는지 답한다. 은유를 쓰면 바로 쉬운 말로 풀며 성찰 질문으로 끝낼 의무는 없다.';

export function parseCardCallout(value,c,{required=false}={}){
 if(value===undefined||value===null){if(required)throw Error('MISSING_CARD_CALLOUT');return undefined;}
 const symbol=cardSymbols[c.id];
 if(!symbol||value.symbolId!==symbol.id)throw Error('INVALID_CALLOUT_SYMBOL');
 if(typeof value.text!=='string')throw Error('INVALID_CALLOUT_TEXT');
 const text=value.text.replace(/\[\s*지식\s*\d+\s*\]/g,'').replace(/\*\*/g,'').trim();
 // The target is 40–120 characters; allow natural shorter/longer phrasing without style retries.
 if(text.length<12||text.length>240)throw Error('INVALID_CALLOUT_TEXT');
 return{symbolId:symbol.id,text};
}

export function parseCardCallouts(value,c,{required=false}={}){
 if(value===undefined||value===null){if(required)throw Error('MISSING_CARD_CALLOUTS');return undefined;}
 if(!Array.isArray(value)||value.length<2||value.length>4)throw Error('INVALID_CALLOUT_COUNT');
 const allowed=new Set(symbolsFor(c.id).map(x=>x.id)),seen=new Set();
 return value.map(x=>{
  if(!allowed.has(x?.symbolId)||seen.has(x.symbolId))throw Error('INVALID_CALLOUT_SYMBOL');
  seen.add(x.symbolId);
  if(typeof x.text!=='string')throw Error('INVALID_CALLOUT_TEXT');
  const text=x.text.replace(/\[\s*지식\s*\d+\s*\]/g,'').replace(/\*\*/g,'').trim();
  if(text.length<10||text.length>150)throw Error('INVALID_CALLOUT_TEXT');
  return{symbolId:x.symbolId,text};
 });
}

const normalized=s=>String(s||'').replace(/\s+/g,' ').trim();
export function validateGrounding(g,c,input){
 const sources=[input.question,...(input.messages||[]).filter(m=>m.role==='user').map(m=>m.text),...(input.rounds||[]).map(r=>r.question)].filter(Boolean);
 const quoteIn=(quote,sources)=>typeof quote==='string'&&normalized(quote).length>0&&normalized(quote).length<=180&&sources.some(s=>normalized(quote).length>=Math.min(8,normalized(s).length)&&normalized(s).includes(normalized(quote)));
 for(const [key,source] of [['pictureQuote',[c.guide.picture]],['meaningQuote',[c.reversed?c.guide.reversed:c.guide.upright]],['userQuote',sources]]){
  if(!quoteIn(g?.[key],source))throw Error('UNGROUNDED_CARD_READING_'+key);
 }
}
