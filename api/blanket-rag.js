import {authorize,queryRag} from '../lib/blanketRag.js';
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='POST')return res.status(405).json({error:'METHOD_NOT_ALLOWED'});
 if(Number(req.headers['content-length']||0)>16000)return res.status(413).json({error:'PAYLOAD_TOO_LARGE'});
 let input;try{input=await authorize(req);}catch{return res.status(401).json({error:'UNAUTHORIZED'});}
 try{return res.status(200).json(await queryRag(input));}catch(e){console.error('blanket_rag_failed',{code:e.message?.slice(0,100)});return res.status(503).json({error:'RAG_UNAVAILABLE'});}
}
