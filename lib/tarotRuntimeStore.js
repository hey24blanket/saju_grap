import {get,put,list,BlobPreconditionFailedError} from '@vercel/blob';
const options=()=>({storeId:process.env.TAROT_BLOB_STORE_ID,access:'private',abortSignal:AbortSignal.timeout(5000)});
export async function readPrivate(path){
  if(!process.env.TAROT_BLOB_STORE_ID)throw Error('TAROT_STORE_NOT_CONFIGURED');
  const r=await get(path,{...options(),useCache:false});
  if(!r)return null;
  if(r.statusCode!==200)throw Error('TAROT_STORE_READ_FAILED');
  return {value:await new Response(r.stream).json(),etag:r.blob.etag};
}
export async function writePrivate(path,value,etag){
  return put(path,JSON.stringify(value),{...options(),addRandomSuffix:false,contentType:'application/json',...(etag?{ifMatch:etag}:{allowOverwrite:false})});
}
export const conflict=e=>e instanceof BlobPreconditionFailedError||/already exists|precondition/i.test(String(e.message));
// Every successful mutation is a compare-and-swap, including first creation.
export async function mutatePrivate(path,change,{read=readPrivate,write=writePrivate,attempts=8}={}){
  for(let i=0;i<attempts;i++){
    const old=await read(path),next=change(old?.value);
    if(next===undefined)return false;
    try{await write(path,next,old?.etag);return true}catch(e){if(!conflict(e))throw e;if(i===attempts-1)throw Error('TAROT_STORE_BUSY')}
    await new Promise(r=>setTimeout(r,20+Math.random()*60));
  }
}
export async function recentAudits(){
  const r=await list({...options(),prefix:'tarot/audits/',limit:30});
  return (await Promise.all(r.blobs.map(b=>readPrivate(b.pathname)))).filter(Boolean).map(r=>r.value).filter(r=>r.expiresAt>Date.now()).sort((a,b)=>b.createdAt-a.createdAt);
}
