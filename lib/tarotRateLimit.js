import crypto from 'node:crypto';
import {mutatePrivate} from './tarotRuntimeStore.js';
export function consumeLimit(old,hash,now){
  const bucket=Math.floor(now/600000),day=Math.floor(now/86400000);
  if(old&&(!Number.isInteger(old.count)||old.count<0||old.day!==day||!old.ips||typeof old.ips!=='object'))throw Error('TAROT_LIMIT_CORRUPT');
  const count=old?.count||0,ips=Object.fromEntries(Object.entries(old?.ips||{}).filter(([,v])=>v.bucket===bucket));
  const ipCount=ips[hash]?.count||0;
  if(count>=300||ipCount>=15)throw Error('RATE_LIMIT');
  ips[hash]={bucket,count:ipCount+1};
  return{day,count:count+1,ips};
}
export async function limit(req){
  const now=Date.now(),ip=String(req.headers['x-vercel-forwarded-for']||req.headers['x-forwarded-for']||'unknown').split(',')[0].trim();
  const hash=crypto.createHash('sha256').update('tarot:'+ip).digest('hex').slice(0,32);
  return mutatePrivate(`tarot/limits/${Math.floor(now/86400000)}.json`,old=>consumeLimit(old,hash,now));
}
