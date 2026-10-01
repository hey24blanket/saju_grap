import test from 'node:test';
import assert from 'node:assert/strict';
import {validateTarot} from '../lib/tarotValidation.js';
import {parseResponse} from '../lib/tarotResponse.js';

const input = validateTarot({
  action:'reading', question:'대화를 다시 시작하고 싶어요. 먼저 연락할까요, 기다릴까요?',
  messages:[], context:{},
  rounds:[{spread:'two_choice', options:['먼저 연락하기','기다리기'], cards:[
    {id:'ar01',reversed:false},{id:'sw04',reversed:false}
  ]}]
});
const bodyA='먼저 연락하기는 손에 있는 방법을 직접 쓰는 선택입니다. <마법사>의 탁자에는 네 가지 도구가 이미 놓여 있어요. 정방향은 더 준비하며 기다리는 시간보다 가진 것을 실제로 사용하는 시작에 무게를 둡니다.\n\n대화를 다시 시작하고 싶다는 목표에는 이 방향이 맞습니다. 이 선택에서 감수할 것은 먼저 말을 건 뒤의 반응도 직접 받아들이는 일입니다. 짧게 안부를 건네는 정도로 시작의 크기를 정해보세요.';
const bodyB='기다리기는 대화에 개입하지 않고 쉴 틈을 남기는 선택입니다. <소드4>의 인물은 검들이 있는 공간에 누워 있어요. 검이 사라지지는 않았지만 그 사이에서 잠시 움직임을 멈춥니다. 정방향은 이렇게 거리를 두는 시간을 읽습니다.\n\n쉬는 것이 목적이라면 맞는 방향입니다. 다만 먼저 대화를 다시 열고 싶다는 목표에서는 기다리는 기간만큼 자신의 시작도 미뤄집니다. 휴식과 재개 중 지금 앞에 놓을 것을 구별하세요.';
const concise=()=>({
  message:'대화를 다시 시작하는 데 어느 선택이 맞는지 비교하시는군요.',
  cardReadings:input.cards.map((c,i)=>({
    id:c.id,
    grounding:{pictureQuote:c.guide.picture.slice(0,35),meaningQuote:c.guide.upright.slice(0,35),userQuote:input.question},
    lead:i?'기다리기는 쉬는 시간을 남기지만 자신의 시작도 미루는 선택입니다.':'대화를 다시 시작하려면 먼저 연락하는 쪽이 더 맞습니다.',
    body:i?bodyB:bodyA
  })),
  summary:[
    {title:'두 선택의 결론',body:'대화를 다시 시작하는 것이 목적이라면 A, 먼저 연락하기 쪽입니다. <마법사>는 손에 놓인 도구를 사용하는 시작이고, <소드4>는 개입을 멈추는 시간이므로 두 카드가 목표에 응답하는 방식이 다릅니다.'},
    {title:'얻는 것과 감수할 것',body:'먼저 연락하면 시작의 시점을 직접 정하는 대신 그 뒤의 반응도 받아들여야 합니다. 기다리면 먼저 말을 꺼낼 부담을 내려놓지만 자신의 대화 시도도 함께 미룹니다. 두 카드는 상대의 반응보다 내가 맡을 역할을 비교합니다.'},
    {title:'선택의 기준',body:'지금 말한 목표는 휴식보다 대화의 재개입니다. 그 목표를 기준으로 짧은 안부부터 건네는 쪽을 제안합니다. 쉬는 시간이 먼저 필요해 목표가 바뀐다면 기다리기의 <소드4>가 더 맞는 선택이 됩니다.'}
  ], context:{}
});

test('a concise answer-first comparison passes without the former 650-character summary floor',()=>{
  const response=concise();
  const length=response.summary.reduce((sum,s)=>sum+s.body.length,0);
  assert.ok(length>=240&&length<650);
  const result=parseResponse(JSON.stringify(response),input);
  assert.deepEqual(result.summary,response.summary);
  assert.equal(result.cardReadings.length,2);
  assert.equal(result.sections[1].title,'A · 먼저 연락하기의 <마법사>');
  assert.match(result.text,/대화를 다시 시작하는 것이 목적이라면 A/);
});

test('a complete short card explanation is accepted without padding to the old body minimum',()=>{
  const response=concise();
  response.cardReadings[0].body='먼저 연락하기는 지금 가진 방법을 직접 사용하는 선택입니다. <마법사>의 탁자에는 도구들이 이미 놓여 있고, 정방향은 이를 현실의 시작으로 옮기는 힘을 읽어요.\n\n대화 재개라는 목표에는 이 방향이 맞습니다. 첫 말을 직접 꺼내는 만큼 상대의 반응도 받아들여야 한다는 부담이 함께 있습니다.';
  assert.ok(response.cardReadings[0].body.length>=120&&response.cardReadings[0].body.length<180);
  assert.doesNotThrow(()=>parseResponse(JSON.stringify(response),input));
});

test('older longer response shape remains compatible and preserves its full text',()=>{
  const response=concise();
  response.cardReadings[0].body += '\n\n'+bodyB;
  response.summary=response.summary.map(s=>({...s,body:s.body+'\n\n'+bodyA}));
  response.summary.push({title:'함께 기억할 점',body:'두 카드의 역할과 사용자가 말한 목표를 구별해 읽습니다.'});
  const result=parseResponse(JSON.stringify(response),input);
  assert.equal(result.cardReadings[0].body,response.cardReadings[0].body);
  assert.equal(result.summary.length,4);
  assert.equal(result.summary[0].body,response.summary[0].body);
});

test('shorter style retains missing-content and trusted-grounding validation',()=>{
  const mutations=[
    d=>{d.cardReadings[0].body='짧은 말';},
    d=>{d.summary.forEach(s=>s.body='너무 짧은 결론입니다.');},
    d=>{d.summary[1].body='   ';},
    d=>{d.summary[1].title='   ';},
    d=>{d.cardReadings[0].grounding.meaningQuote=input.cards[0].guide.reversed.slice(0,35);},
    d=>{d.cardReadings[0].grounding.userQuote='상대방이 저에게 먼저 연락했어요.';}
  ];
  for(const mutate of mutations){const d=concise();mutate(d);assert.throws(()=>parseResponse(JSON.stringify(d),input));}
});

test('a follow-up reads only the newly drawn card and can synthesize earlier cards',()=>{
  const followed=validateTarot({action:'reading',question:input.question,messages:[],context:{},rounds:[
    {spread:'two_choice',options:['먼저 연락하기','기다리기'],cards:[{id:'ar01',reversed:false},{id:'sw04',reversed:false}],reading:'목표가 대화 재개라면 먼저 연락하기 쪽입니다.'},
    {spread:'advice',question:'어떤 말부터 하면 좋을까요?',cards:[{id:'cu02',reversed:false}]}
  ]});
  const response=concise(),card=followed.cards.at(-1);
  response.cardReadings=[{id:card.id,lead:'처음부터 결론을 요구하기보다 서로 답할 수 있는 안부를 건네세요.',body:'<컵2>에서는 두 사람이 각각 잔을 들고 서로 마주 봅니다. 한쪽만 계속 쏟아내는 장면이 아니라, 상대도 자기 잔을 들고 응답할 자리가 있는 모습이에요. 정방향의 중심은 이렇게 주고받는 말입니다.\n\n앞선 <마법사>가 먼저 시작하는 방향을 짚었다면, 이 카드는 첫 말의 크기를 정해줍니다. 긴 해명보다 상대가 편하게 답할 수 있는 짧은 안부로 시작해보세요.',grounding:{pictureQuote:card.guide.picture.slice(0,35),meaningQuote:card.guide.upright.slice(0,35),userQuote:'어떤 말부터 하면 좋을까요?'}}];
  response.summary[0]={title:'지금 질문에 대한 답',body:'먼저 연락한다는 앞선 방향은 유지하되, 새 <컵2>는 첫 말을 주고받기 쉬운 크기로 좁힙니다. <마법사>가 말한 시작에 상호적인 대화의 기준이 더해졌습니다. 긴 해명보다 짧은 안부로 상대도 답할 자리를 남겨보세요.'};
  const result=parseResponse(JSON.stringify(response),followed);
  assert.deepEqual(result.cardReadings.map(c=>c.id),['cu02']);
  assert.match(result.summary[0].body,/<마법사>/);
});
