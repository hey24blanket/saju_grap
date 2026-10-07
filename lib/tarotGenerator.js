import {generateReading,evidencePayload,CONVERSATION_SYSTEM,ENGINE_VERSION} from './tarotEngine.js';
import {completeTarot} from './tarotCompletion.js';
import {parseResponse} from './tarotResponse.js';

// Server-owned selection; clients cannot select models, strategies, or paid retries.
export const READING_STRATEGY='staged';
export const READING_MODEL='gpt-6.1-sol';
export const WRITING_MODEL='gpt-6-astra';
export async function generateTarot(input,rag,{complete=completeTarot,now=Date.now}={}){
 const deadline=now()+78000,provider='openai';
 // Only a model that passed the editorial gate may serve the reading.
 const completeWithinBudget=async args=>{
  const remaining=deadline-now();if(remaining<1500)throw Error('GENERATION_DEADLINE');
  const model=args.stage==='interpretation'?(process.env.TAROT_MODEL||READING_MODEL):(process.env.TAROT_WRITER_MODEL||WRITING_MODEL);
  return complete({...args,modelOverride:model,reasoningEffort:'low',timeoutMs:Math.min(remaining,75000)});
 };
 try{
  if(input.action==='reading')return await generateReading(input,rag,{strategy:READING_STRATEGY,provider,complete:completeWithinBudget});
  const r=await completeWithinBudget({provider,stage:'conversation',system:CONVERSATION_SYSTEM,payload:JSON.stringify({action:input.action,...evidencePayload(input,rag)})});
  const parsed=parseResponse(r.text,input);
  if(!parsed.message)throw Error('EMPTY_RESPONSE');
  return {...parsed,context:structuredClone(input.context),provider,telemetry:{version:ENGINE_VERSION,strategy:'conversation',calls:[r.metrics]}};
 }catch(e){console.warn('tarot_generation_failed',{provider,code:String(e.message).slice(0,80)});throw e;}
}
