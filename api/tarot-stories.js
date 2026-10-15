import {requireTarotUser} from '../lib/tarotUserAuth.js';
import {createStoryRepository} from '../lib/tarotStoryStore.js';
const repository=createStoryRepository();
const origins=new Set(['https://tarot-with-you.vercel.app','https://saju-grap.vercel.app']);
export function createHandler({authenticate=requireTarotUser,repo=repository}={}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Vary','Origin');
  const origin=req.headers?.origin;
  // Always override the old project's wildcard API header on this private route.
  res.setHeader('Access-Control-Allow-Origin',origins.has(origin)?origin:'https://tarot-with-you.vercel.app');
  if(origin&&!origins.has(origin))return res.status(403).json({error:'허용되지 않은 요청이에요.'});
  if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','GET,PUT,DELETE,OPTIONS');res.setHeader('Access-Control-Allow-Headers','Authorization,Content-Type');return res.status(204).end();}
  if(!['GET','PUT','DELETE'].includes(req.method))return res.status(405).json({error:'지원하지 않는 요청이에요.'});
  try{
   const user=await authenticate(req);
   if(req.method==='GET')return res.status(200).json(await repo.get(user.uid));
   let payload;try{payload=typeof req.body==='string'?JSON.parse(req.body):req.body;}catch{throw Object.assign(Error('기록 형식을 확인해 주세요.'),{status:400});}
   if(Buffer.byteLength(JSON.stringify(payload||{}))>2100000)throw Object.assign(Error('기록이 너무 커요. 내보낸 뒤 정리해 주세요.'),{status:413});
   if(req.method==='DELETE'&&(!user.auth_time||Date.now()/1000-user.auth_time>300))return res.status(401).json({error:'기록을 비우기 전에 비밀번호를 다시 확인해 주세요.',reauth:true});
   const result=await repo.update(user.uid,payload,{clear:req.method==='DELETE'});
   return res.status(200).json(result);
  }catch(e){console.warn('tarot_story_request_failed',{status:e.status||503});return res.status(e.status||503).json({error:e.status?e.message:'계정 저장에 연결하지 못했어요. 기기의 기록은 유지돼요.',...(e.latest?{latest:e.latest}:{})});}
 };
}
export default createHandler();
