// Developer benchmark: fixed synthetic questions only. No public generation endpoint.
// Runs once during the explicitly named protected preview build, never in production.
import fs from 'node:fs/promises';
import {validateTarot} from '../lib/tarotValidation.js';
import {generateReading,ENGINE_VERSION} from '../lib/tarotEngine.js';
import {completeTarot} from '../lib/tarotCompletion.js';
const enabled=process.env.VERCEL_ENV==='preview'&&process.env.VERCEL_GIT_COMMIT_REF==='improve/tarot-engine-v13';
if(!enabled){console.log('Tarot benchmark skipped (not the experiment preview).');process.exit(0);}
const cases=JSON.parse(await fs.readFile(new URL('../eval/tarot-engine/cases.json',import.meta.url)));
const config=JSON.parse(await fs.readFile(new URL('../eval/tarot-engine/experiment.json',import.meta.url)));
const variants=config.variants|| (config.phase==='compare'?[{id:'single-openai',strategy:'single',provider:'openai'},{id:'staged-openai',strategy:'staged',provider:'openai'},{id:'staged-gemini',strategy:'staged',provider:'gemini'}]:[config.selected]);
const selected=cases.filter(x=>['compare','capability'].includes(config.phase)?x.split==='reference':x.split==='holdout'||x.split==='development'||x.id==='art');
if(config.phase==='holdout')selected.push({id:'large-spread',question:'새로운 일을 준비하면서 현재 직장도 계속 다니고 있어요. 준비할 시간이 부족한데 지금 어떤 점부터 바꾸면 좋을까요?',rounds:[{spread:'celtic',cards:['ar01','wa10','pe08','sw04','ar09','pe02','wa07','pe03','ar18','cu09'].map((id,i)=>({id,reversed:i%3===0}))}]});
if(selected.length>20||variants.length>3)throw Error('BENCHMARK_BUDGET_EXCEEDED');
const dir=new URL('../public/tarot-benchmark/',import.meta.url);await fs.mkdir(dir,{recursive:true});
const results=[];
// At most two independent holdout requests. Comparisons remain sequential. No retries.
const jobs=selected.flatMap(c=>variants.map(variant=>({c,variant})));let next=0;
async function worker(){while(next<jobs.length){const {c,variant}=jobs[next++];
 const input=validateTarot({action:'reading',visualMode:'callout-v2',question:c.question,rounds:c.rounds,messages:[],context:{}}),start=Date.now();
 const row={id:c.id,variant:variant.id,version:ENGINE_VERSION,createdAt:new Date().toISOString()};
 try{
  row.response=await generateReading(input,{results:[]},{...variant,complete:args=>completeTarot({...args,modelOverride:args.stage==='writing'?(variant.writerModel||variant.model):variant.model,reasoningEffort:variant.reasoningEffort,timeoutMs:Math.max(1,Math.min(75000,78000-(Date.now()-start)))})});row.contractPassed=true;
 }catch(e){row.error=String(e.message).slice(0,100);row.contractPassed=false;}
 row.elapsedMs=Date.now()-start;
 await fs.writeFile(new URL(`${c.id}--${variant.id}.json`,dir),JSON.stringify(row,null,2));
 results.push({id:row.id,variant:row.variant,contractPassed:row.contractPassed,error:row.error,elapsedMs:row.elapsedMs,telemetry:row.response?.telemetry});
 console.log(JSON.stringify(results.at(-1)));
}}
await Promise.all(Array.from({length:config.concurrency|| (config.phase==='holdout'?2:1)},()=>worker()));
await fs.writeFile(new URL('index.json',dir),JSON.stringify({config,results},null,2));
