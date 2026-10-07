import {generateReading,evidencePayload,CONVERSATION_SYSTEM,ENGINE_VERSION} from './tarotEngine.js';
import {completeTarot} from './tarotCompletion.js';
import {parseResponse} from './tarotResponse.js';

// Server-owned selection; clients cannot select models, strategies, or paid retries.
export const READING_STRATEGY='single';
export const READING_MODEL='gpt-6.1-sol';
export async function generateTarot(input,rag,{complete=completeTarot,now=Date.now}={}){
 const deadline=now()+78000,failures=[];
 // Only a model that passed the editorial gate may serve the reading.
 for(const provider of ['openai']){
  try{
   const completeWithinBudget=async args=>{
    const remaining=deadline-now();if(remaining<1500)throw Error('GENERATION_DEADLINE');
    return complete({...args,modelOverride:process.env.TAROT_MODEL||READING_MODEL,reasoningEffort:'low',timeoutMs:Math.min(remaining,75000)});
   };
   let result;
   if(input.action==='reading')result=await generateReading(input,rag,{strategy:READING_STRATEGY,provider,complete:completeWithinBudget});
   else{
    const r=await completeWithinBudget({provider,system:CONVERSATION_SYSTEM,payload:JSON.stringify({action:input.action,...evidencePayload(input,rag)})});
    const parsed=parseResponse(r.text,input);
    if(!parsed.message)throw Error('EMPTY_RESPONSE');
    result={...parsed,context:structuredClone(input.context),provider,telemetry:{version:ENGINE_VERSION,strategy:'conversation',calls:[r.metrics]}};
   }
   return {...result,telemetry:{...result.telemetry,failures}};
  }catch(e){failures.push({provider,code:String(e.message).slice(0,80)});console.warn('tarot_generation_retry',failures.at(-1));}
 }
 throw Error(failures.at(-1)?.code||'MODEL_NOT_CONFIGURED');
}
