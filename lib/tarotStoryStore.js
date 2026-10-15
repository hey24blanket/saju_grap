import crypto from 'node:crypto';
import {readPrivate,writePrivate,conflict} from './tarotRuntimeStore.js';
import {cards} from './tarotCards.js';
const known=new Set(cards.map(c=>c.id));
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const string=(x,max)=>{if(typeof x!=='string'||x.length>max)throw fail('기록 형식을 확인해 주세요.');return x;};
const list=(x,max)=>{if(!Array.isArray(x)||x.length>max)throw fail('기록 수가 저장 한도를 넘었어요. 기록을 내보내 주세요.');return x;};
const stamp=x=>{if(!Number.isFinite(x)||x<=0||x>8640000000000000)throw fail('기록 날짜를 확인해 주세요.');return x;};
const ident=x=>{string(x,100);if(!/^[a-zA-Z0-9_.:~-]{1,100}$/.test(x))throw fail('기록 ID를 확인해 주세요.');return x;};
const unique=rows=>{if(new Set(rows.map(x=>x.id)).size!==rows.length)throw fail('중복된 기록이 있어요.');return rows;};
function cardList(value){return unique(list(value,78).map(c=>{if(!known.has(c?.id)||typeof c.reversed!=='boolean')throw fail('카드 정보를 확인해 주세요.');return{id:c.id,reversed:c.reversed};}));}
function reading(r){
  if(r==null)return null;
  const s=(k,max)=>string(r[k]||'',max);
  return{answer:s('answer',2000),message:s('message',16000),reason:s('reason',5000),nextStep:s('nextStep',2000),text:s('text',30000),legacy:r.legacy===true,
    cardReadings:list(r.cardReadings||[],10).map(c=>({id:string(c.id,30),lead:string(c.lead||'',650),body:string(c.body||'',16000)})),
    summary:list(r.summary||[],30).map(x=>({title:string(x.title,200),body:string(x.body,16000)})),
    comparison:list(r.comparison||[],2).map(x=>({id:string(x.id,30),label:string(x.label,200),benefit:string(x.benefit,1000),cost:string(x.cost,1000)})),
    followupSuggestions:list(r.followupSuggestions||[],2).map(x=>string(x,100))};
}
export function normalizeThreads(value){
  return unique(list(value,500).map(t=>({id:ident(t.id),title:string(t.title,150),createdAt:stamp(t.createdAt),updatedAt:stamp(t.updatedAt),status:t.status==='done'?'done':'active',
    memory:{enabled:t.memory?.enabled===true,text:string(t.memory?.text||'',300)},
    entries:unique(list(t.entries,1000).map(e=>({id:ident(e.id),kind:e.kind==='choice'?'choice':'outcome',text:string(e.text,500),createdAt:stamp(e.createdAt)}))),
    sessions:unique(list(t.sessions,500).map(s=>({id:ident(s.id),question:string(s.question,1500),mode:['short','deep','compare'].includes(s.mode)?s.mode:'deep',spread:string(s.spread||'three',30),
      options:list(s.options||[],2).map(x=>string(x,100)),roles:list(s.roles,10).map(x=>string(x,150)),cards:cardList(s.cards),pool:cardList(s.pool||[]),goal:string(s.goal||'',100),createdAt:stamp(s.createdAt),
      messages:list(s.messages,500).map(m=>{if(!['user','assistant'].includes(m.role))throw fail('대화 역할을 확인해 주세요.');return{role:m.role,text:string(m.text,12000),correction:m.correction===true};}),
      result:reading(s.result),phase:s.result?'result':'ready',...(s.feedback?{feedback:s.feedback==='yes'?'yes':'no'}:{})})))
  })));
}
export const emptyCloud=()=>({schema:1,revision:0,epoch:0,threads:[],deleted:[]});
export function userStoryPath(uid){return'tarot/users/'+crypto.createHash('sha256').update(uid).digest('hex')+'/stories-v1.json';}
export function createStoryRepository({read=readPrivate,write=writePrivate}={}){
  async function get(uid){return(await read(userStoryPath(uid)))?.value||emptyCloud();}
  async function update(uid,payload,{clear=false}={}){
    if(!Number.isSafeInteger(payload?.revision)||payload.revision<0||!Number.isSafeInteger(payload.epoch)||payload.epoch<0)throw fail('저장 버전을 확인해 주세요.');
    const path=userStoryPath(uid),existing=await read(path),old=existing?.value||emptyCloud();
    if(payload.revision!==old.revision||payload.epoch!==old.epoch)throw Object.assign(fail('다른 기기의 변경을 먼저 불러올게요.',409),{latest:old});
    let next;
    if(clear)next={...emptyCloud(),revision:old.revision+1,epoch:old.epoch+1,updatedAt:Date.now()};
    else{
      const deleted=[...new Set([...old.deleted,...list(payload.deleted||[],10000).map(ident)])];
      if(deleted.length>10000)throw fail('삭제 기록 한도에 도달했어요. 기록을 내보낸 후 계정 기록을 비워주세요.');
      const threads=normalizeThreads(payload.threads).filter(t=>!deleted.includes(t.id)),ids=new Set(threads.map(t=>t.id));
      if(old.threads.some(t=>!ids.has(t.id)&&!deleted.includes(t.id)))throw fail('일부 기록이 빠졌어요. 새로고침 후 다시 저장해 주세요.',409);
      next={schema:1,revision:old.revision+1,epoch:old.epoch,threads,deleted,updatedAt:Date.now()};
      if(Buffer.byteLength(JSON.stringify(next))>2000000)throw fail('계정 기록의 저장 용량을 넘었어요. 기록을 내보내고 오래된 이야기를 정리해 주세요.',413);
    }
    try{await write(path,next,existing?.etag);}catch(e){if(conflict(e))throw Object.assign(fail('다른 기기에서 먼저 저장했어요.',409),{latest:await get(uid)});throw e;}
    return next;
  }
  return{get,update};
}
