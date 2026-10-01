import {cards} from './tarotCards.js';
import {rolesFor,spreads,followups} from './tarotSpreads.js';
const string=(v,max)=>typeof v==='string'&&v.length<=max;
export function validateTarot(b){
 if(!b||!['clarify','reading','followup'].includes(b.action))throw Error('INVALID_ACTION');
 if(!string(b.question,1500)||!b.question.trim())throw Error('INVALID_QUESTION');
 if(!Array.isArray(b.messages)||b.messages.length>20||b.messages.some(m=>!['user','assistant'].includes(m.role)||!string(m.text,12000)))throw Error('INVALID_MESSAGES');
 // Accept old clients during the coordinated deployment and migrate on the client.
 const rounds=b.rounds??(b.cards?.length?[{spread:b.cards.length===1?'one':'three',cards:b.cards,question:b.question}]:[]);
 if(!Array.isArray(rounds)||rounds.length>3)throw Error('INVALID_ROUNDS');
 const seen=new Set();const normalized=rounds.map((r,ri)=>{
  const spread=r.spread;if(!(ri===0?spreads[spread]:followups[spread]))throw Error('INVALID_SPREAD');
  const roles=rolesFor(spread,r.roles,r.options);if(!Array.isArray(r.cards)||r.cards.length!==roles.length)throw Error('INCOMPLETE_SPREAD');
  if(!string(r.question??b.question,1500)||!string(r.reading??'',16000))throw Error('INVALID_ROUND');
  return{spread,roles,question:r.question??b.question,reading:r.reading||'',cards:r.cards.map((c,i)=>{
   const canon=cards.find(x=>x.id===c.id);if(!canon||seen.has(c.id)||typeof c.reversed!=='boolean')throw Error('INVALID_CARD');seen.add(c.id);
   return{...canon,reversed:c.reversed,position:roles[i],round:ri};
  })};
 });
 if(b.action!=='clarify'&&!normalized.length)throw Error('MISSING_CARDS');
 const context={};for(const k of['facts','feelings','values','efforts','hypotheses','corrections']){const v=b.context?.[k]??[];if(!Array.isArray(v)||v.length>8||v.some(s=>!string(s,300)))throw Error('INVALID_CONTEXT');context[k]=v}
 return{action:b.action,visualMode:b.visualMode==='callout-v1'?'callout-v1':undefined,question:b.question,messages:b.messages.map(({role,text})=>({role,text})),rounds:normalized,cards:normalized.flatMap(r=>r.cards),context};
}
