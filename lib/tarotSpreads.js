export const spreads={
 one:{name:'핵심 한 가지 보기',label:'원 카드',roles:['지금 필요한 관점'],layout:'line'},
 three:{name:'상황과 대응 살펴보기',label:'쓰리 카드',roles:['현재','걸림돌','대응'],layout:'line'},
 timeline:{name:'지나온 길과 앞으로의 흐름',label:'쓰리 카드',roles:['과거의 영향','현재','가능한 흐름'],layout:'line'},
 cross:{name:'문제의 원인과 대응 보기',label:'십자 배열',roles:['현재 상황','걸림돌','배경과 원인','도움이 되는 것','대응 방향'],layout:'cross'},
 choice:{name:'두 선택지 비교하기',label:'양자택일',roles:['공통 현재','A의 가능성','A의 유의점','B의 가능성','B의 유의점'],layout:'choice'},
 relationship:{name:'관계의 서로 다른 관점 보기',label:'관계 배열',roles:['나의 태도','상대에게 확인할 점','관계의 연결점','엇갈리는 기대','대화와 대응'],layout:'line'},
 horseshoe:{name:'흐름과 주변 영향 보기',label:'호스슈',roles:['과거의 영향','현재','가까운 흐름','나의 태도','주변 환경','걸림돌','대응과 가능성'],layout:'horseshoe'},
 celtic:{name:'배경과 주변 영향까지 보기',label:'켈틱 크로스',roles:['현재 상황','가로막는 요소','목표와 의식','기저 원인','과거의 영향','가까운 미래의 가능성','나의 태도','주변 환경','희망과 두려움','현재 흐름의 귀결'],layout:'celtic'},
 free:{name:'궁금한 점을 직접 정하기',label:'자유 배열',roles:['첫 번째 관점','두 번째 관점','세 번째 관점'],layout:'line'}
};
export const followups={clarifier:{name:'모호한 의미 더 살펴보기',roles:['보충할 관점']},advice:{name:'실행할 조언 얻기',roles:['작은 실천']},obstacle:{name:'걸림돌과 대응 살펴보기',roles:['추가로 확인할 걸림돌','대응 방법']},compare:{name:'두 행동 비교하기',roles:['A를 선택할 때','B를 선택할 때']},candidate:{name:'후보 두 장 중 한 장 고르기',roles:['보충할 관점']}};
export function recommend(question){if(/이직|남을까|할까.*말까|A.*B|둘 중|선택지|비교/.test(question))return'choice';if(/얽|복합|여러.*문제|자세히|깊이/.test(question))return'celtic';if(/오늘|하루|한마디|간단한 조언/.test(question))return'one';if(/관계|연애|동업|상대|재회/.test(question))return'relationship';return'three'}
export function rolesFor(key,custom,options){if(key==='free'){if(!Array.isArray(custom)||custom.length<1||custom.length>7||custom.some(r=>typeof r!=='string'||!r.trim()||r.length>60))throw Error('INVALID_ROLES');return custom.map(r=>r.trim())}if(['choice','compare'].includes(key)&&options){if(!Array.isArray(options)||options.length!==2||options.some(x=>typeof x!=='string'||!x.trim()||x.length>50))throw Error('INVALID_OPTIONS');return key==='choice'?['공통 현재','A · '+options[0]+'의 가능성','A · '+options[0]+'의 유의점','B · '+options[1]+'의 가능성','B · '+options[1]+'의 유의점']:['A · '+options[0],'B · '+options[1]]}const def=spreads[key]||followups[key];if(!def)throw Error('INVALID_SPREAD');return [...def.roles]}
export function remainingDeck(deck,rounds){const used=new Set(rounds.flatMap(r=>r.cards).map(c=>c.id));return deck.filter(c=>!used.has(c.id))}
export function guideLength(g){return [g.theme,g.picture,g.uprightTitle,g.upright,g.reversedTitle,g.reversed,g.question].join('').length}
