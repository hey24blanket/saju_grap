import {waitUntil} from '@vercel/functions';
import {readPrivate,writePrivate,mutatePrivate} from './tarotRuntimeStore.js';
const SNAPSHOT='tarot/knowledge/approved-v1.json',STATE='tarot/knowledge/sync-v1.json';
const HOUR=3600000;
export function usableSnapshot(s,now=Date.now()){
  return s?.schema===1&&Number.isFinite(s.createdAt)&&s.createdAt<=now&&now-s.createdAt<24*HOUR&&Array.isArray(s.rows)&&s.rows.every(r=>typeof r.text==='string'&&['tarot','common'].includes(r.kind))&&!!s.summary;
}
export async function snapshotInventory(){
  const s=(await readPrivate(SNAPSHOT))?.value;
  return usableSnapshot(s)?{rows:s.rows,summary:{...s.summary,snapshotAt:s.createdAt,storage:'private-snapshot'}}:{rows:[],summary:{source:'카드 기본 원고 · Firebase 지식 동기화 대기',tarot:0,common:0,pendingTarot:0,checkedAt:null,storage:'guide-only-temporary'}};
}
export async function refreshSnapshot(loadInventory,{force=false}={}){
  const now=Date.now();
  const claimed=await mutatePrivate(STATE,old=>{
    if(old?.leaseUntil>now||(!force&&old?.nextAttemptAt>now))return undefined;
    return {...old,leaseUntil:now+90000,nextAttemptAt:now+HOUR,lastAttemptAt:now};
  });
  if(!claimed)return {skipped:true};
  try{
    const inv=await loadInventory();
    const snapshot={schema:1,createdAt:Date.now(),rows:inv.rows,summary:inv.summary};
    await mutatePrivate(SNAPSHOT,()=>snapshot);
    await mutatePrivate(STATE,old=>({...old,leaseUntil:0,lastSuccessAt:Date.now(),status:'ready'}));
    console.info('tarot_snapshot_ready',{tarot:inv.summary.tarot,common:inv.summary.common});
    return inv.summary;
  }catch(e){
    await mutatePrivate(STATE,old=>({...old,leaseUntil:0,status:'source-unavailable'})).catch(()=>{});
    console.warn('tarot_snapshot_unavailable',{code:/quota/i.test(e.message)?'FIREBASE_QUOTA':String(e.message).slice(0,50)});
    throw e;
  }
}
export function scheduleSnapshot(loadInventory){waitUntil(refreshSnapshot(loadInventory).catch(()=>{}));}
export async function saveAudit(id,value){
  // Reverse chronological filenames let the admin read the latest 30 without a full scan.
  const key=String(9999999999999-value.createdAt).padStart(13,'0');
  await writePrivate(`tarot/audits/${key}-${id}.json`,{id,...value,expiresAt:Date.now()+30*86400000});
}
