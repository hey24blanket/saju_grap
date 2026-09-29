import crypto from 'node:crypto';
import {getFirestoreClient,isRagDocumentRetrievable,DEFAULT_RAG_COLLECTION,DEFAULT_VECTOR_FIELD,DEFAULT_EMBEDDING_MODEL,DEFAULT_EMBEDDING_DIMENSIONS} from './ragRetriever.js';
import {getActiveRagVersion} from './ragManagerCore.js';
import {embedQuery} from './embeddingProvider.js';
const ISSUER='https://app-idea-git-build-daily-pitch-blanket2.vercel.app';
const TRUSTED_KEY = {"crv":"Ed25519","x":"9Z3g-PnRR-TWxb9l8Kzxf6c1MAtEDeO4Yvv8hw_Tkyw","kty":"OKP"}; // Pinned during deployment; public key only.
let inventory=null;
export async function authorize(req){
 const token=String(req.headers.authorization||'').replace(/^Bearer /,'');
 if(token.length>4000)throw new Error('UNAUTHORIZED');
 const [payload,signature,extra]=token.split('.');if(!payload||!signature||extra)throw new Error('UNAUTHORIZED');
 const claims=JSON.parse(Buffer.from(payload,'base64url').toString());const now=Math.floor(Date.now()/1000);
 if(claims.iss!==ISSUER||claims.aud!=='sajugrap-rag'||claims.scope!=='rag:read'||typeof claims.sub!=='string'||!claims.sub||!Number.isInteger(claims.iat)||!Number.isInteger(claims.exp)||claims.iat>now+5||claims.exp<=now||claims.exp-claims.iat>65||claims.iat<now-65)throw new Error('UNAUTHORIZED');
 if(!TRUSTED_KEY||!crypto.verify(null,Buffer.from(payload),crypto.createPublicKey({key:TRUSTED_KEY,format:'jwk'}),Buffer.from(signature,'base64url')))throw new Error('UNAUTHORIZED');
 const body=typeof req.body==='string'?JSON.parse(req.body):req.body;
 if(claims.body!==crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex'))throw new Error('UNAUTHORIZED');return body;
}
const clean=x=>typeof x==='string'?x.trim().slice(0,180):'';
export function categories(d){
 const c=d.category||d.reviewedManifest?.category||d.metadata?.category;
 let paths=[];
 if(typeof c==='string')paths=c.split('/').map(x=>x.trim()).filter(Boolean).slice(0,5);
 else if(c&&typeof c==='object'){
  const root=clean(c.domainId)||clean(c.domain)||clean(c.primary)||clean(c.id)||clean(c.code);
  const leaf=clean(c.topicId)||clean(c.topic)||clean(c.secondary);
  if(root)paths=[root,leaf].filter(Boolean);
 }
 if(!paths.length&&Array.isArray(d.categoryIds))paths=d.categoryIds.filter(x=>typeof x==='string').slice(0,1);
 if(!paths.length)paths=['미분류'];
 return paths.map(clean).filter(Boolean);
}
function vector(d){const v=d[DEFAULT_VECTOR_FIELD];const a=Array.isArray(v)?v:typeof v?.toArray==='function'?v.toArray():null;return a?.length===DEFAULT_EMBEDDING_DIMENSIONS&&a.every(Number.isFinite)?a:null;}
export function eligible(d,version){return (version?d.ragVersion===version:!d.ragVersion)&&(!d.corpus||d.corpus==='production')&&isRagDocumentRetrievable(d);}
export function summarize(rows,version,checkedAt){
 const groups=new Map();const knowledge=new Set();let unidentified=0,searchable=0;
 for(const {id,data:d,vec} of rows){const kid=clean(d.knowledgeId)||clean(d.reviewedManifest?.knowledgeId);if(kid)knowledge.add(kid);else unidentified++;if(vec)searchable++;
  const path=categories(d);for(let i=0;i<path.length;i++){const parts=path.slice(0,i+1),key='cat:'+Buffer.from(JSON.stringify(parts)).toString('base64url');let g=groups.get(key);if(!g){g={id:key,name:parts.at(-1),path:parts,parentId:i?'cat:'+Buffer.from(JSON.stringify(parts.slice(0,-1))).toString('base64url'):null,chunks:0,searchable:0,keys:new Set()};groups.set(key,g);}g.chunks++;if(vec)g.searchable++;if(kid)g.keys.add(kid);}
 }
 return {status:'connected',source:'사주그랩 Firebase',version:version||'legacy',checkedAt,chunks:rows.length,searchable,knowledgeCount:knowledge.size,unidentifiedChunks:unidentified,categories:[...groups.values()].map(({keys,...g})=>({...g,knowledgeCount:keys.size})).sort((a,b)=>a.id.localeCompare(b.id))};
}
async function load(){
 if(inventory&&inventory.until>Date.now())return inventory;
 const {db}=await getFirestoreClient();const version=await getActiveRagVersion(db);
 let q=db.collection(DEFAULT_RAG_COLLECTION);if(version)q=q.where('ragVersion','==',version);
 const result=await q.limit(5001).get();if(result.size>5000)throw new Error('INVENTORY_LIMIT');
 const rows=result.docs.map(doc=>({id:doc.id,data:doc.data()})).filter(x=>eligible(x.data,version)).map(x=>({...x,vec:vector(x.data)}));
 const checkedAt=new Date().toISOString();inventory={rows,summary:summarize(rows,version,checkedAt),until:Date.now()+300000};return inventory;
}
export async function queryRag(input){
 const {rows,summary}=await load();if(input.action==='inventory')return summary;
 if(input.action!=='search'||typeof input.query!=='string'||!input.query.trim()||input.query.length>5000)throw new Error('INVALID_INPUT');
 const allowed=new Set(summary.categories.map(c=>c.id));const selected=Array.isArray(input.categoryIds)?input.categoryIds:[],excluded=Array.isArray(input.excludedIds)?input.excludedIds:[];
 if([...selected,...excluded].some(x=>!allowed.has(x))||selected.length+excluded.length>60)throw new Error('INVALID_CATEGORY');
 const keys=d=>categories(d).map((_,i)=>'cat:'+Buffer.from(JSON.stringify(categories(d).slice(0,i+1))).toString('base64url'));
 const candidates=rows.filter(x=>x.vec).filter(x=>{const k=keys(x.data);return !k.some(v=>excluded.includes(v))&&(!selected.length||k.some(v=>selected.includes(v)));});
 if(!candidates.length)return {...summary,results:[],searchVerified:false};
 const embedding=await embedQuery(input.query,{model:DEFAULT_EMBEDDING_MODEL,dimensions:DEFAULT_EMBEDDING_DIMENSIONS});const v=embedding.vector;const norm=Math.sqrt(v.reduce((n,x)=>n+x*x,0));
 const ranked=candidates.map(x=>({...x,score:x.vec.reduce((n,y,i)=>n+y*v[i],0)/(norm*Math.sqrt(x.vec.reduce((n,y)=>n+y*y,0))||1)})).sort((a,b)=>b.score-a.score);
 // Diversify sources while retaining semantic order; duplicate chunks never multiply evidence.
 const seen=new Set(),results=[];
 for(const x of ranked){const d=x.data,k=d.knowledgeId||d.reviewedManifest?.knowledgeId||x.id;if(seen.has(k))continue;seen.add(k);const text=(typeof d.content==='string'?d.content:JSON.stringify(d.content||'')).slice(0,7000);if(!text)continue;
  results.push({id:x.id,title:clean(d.title)||x.id,text,categoryIds:keys(d),score:Number(x.score.toFixed(4)),knowledgeId:clean(k),sources:[...(Array.isArray(d.sources)?d.sources:[]),...(d.source&&typeof d.source==='object'?[d.source]:[])].slice(0,5).map(s=>({title:clean(s.title)||clean(s.name)||clean(s.sourceId),url:typeof s.url==='string'&&/^https?:\/\//.test(s.url)?s.url.slice(0,2000):''})),revision:summary.version});if(results.length===6)break;
 }
 return {...summary,results,searchVerified:results.length>0};
}
