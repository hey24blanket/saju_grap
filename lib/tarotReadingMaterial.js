// Server-owned card material keeps direction and role explicit throughout generation.
const lenses={현재:'사용자의 질문을 둘러싼 지금의 긴장과 움직임을 비춘다. 행동 과제를 부여하는 자리가 아니다.',걸림돌:'현재의 흐름을 막거나 판단을 흐리는 요인을 읽는다. 사용자의 결함을 단정하지 않는다.',대응:'앞선 카드의 긴장에 응답할 태도와 방향을 읽는다. 확정된 결과가 아니다.'};
export const READING_VERSION='tarot-depth-v7-two-choices';
export function readingMaterial(c){const g=c.guide;return{id:c.id,name:c.name,reversed:c.reversed,orientation:c.reversed?'역방향':'정방향',position:c.position,positionLens:lenses[c.position]||`${c.position}이라는 자리의 질문에 답한다.`,theme:g.theme,picture:g.picture,selectedMeaning:{title:c.reversed?g.reversedTitle:g.uprightTitle,text:c.reversed?g.reversed:g.upright},oppositeMeaning:{title:c.reversed?g.uprightTitle:g.reversedTitle,text:c.reversed?g.upright:g.reversed},reflection:g.question};}
export const READING_TASK='최신 round 각 카드에 정확한 id의 cardReadings를 작성한다. lead는 카드·방향·자리의 핵심 해석, body는 450~650자의 타로 풀이 3문단이다. 그림→방향의 차이→질문과 자리의 연결을 본문 끝까지 유지한다. 일반 실행 체크리스트로 끝내지 않는다. summary는 별도 800~1100자, 3~4개 소제목으로 첫 질문에 답하고 카드 사이의 긴장/보완을 통합한다. 두 선택 배열은 A/B 카드 각각의 장면을 선택지와 연결하고 두 길의 차이와 부담을 비교한다. 추가 카드는 이전 배열과 연결한다.';

const normalized=s=>String(s||'').replace(/\s+/g,' ').trim();
export function validateGrounding(g,c,input){
 const sources=[input.question,...(input.messages||[]).filter(m=>m.role==='user').map(m=>m.text),...(input.rounds||[]).map(r=>r.question)].filter(Boolean);
 const quoteIn=(quote,sources)=>typeof quote==='string'&&normalized(quote).length>0&&normalized(quote).length<=180&&sources.some(s=>normalized(quote).length>=Math.min(8,normalized(s).length)&&normalized(s).includes(normalized(quote)));
 if(!g||!quoteIn(g.pictureQuote,[c.guide.picture])||!quoteIn(g.meaningQuote,[c.reversed?c.guide.reversed:c.guide.upright])||!quoteIn(g.userQuote,sources))throw Error('UNGROUNDED_CARD_READING');
}
