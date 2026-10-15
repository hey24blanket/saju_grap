// Coalesce warm-instance reads; never retain a failed or indefinitely stale inventory.
export function memoizeFor(load,ttl=60000,now=Date.now){
 let value,until=0,inflight;
 return async()=>{
  if(value&&now()<until)return value;
  if(!inflight)inflight=Promise.resolve().then(load).then(v=>{value=v;until=now()+ttl;return v;}).finally(()=>{inflight=null;});
  return inflight;
 };
}
