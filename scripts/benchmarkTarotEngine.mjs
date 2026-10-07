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
const variants=config.phase==='compare'?[{id:'single-openai',strategy:'single',provider:'openai'},{id:'staged-openai',strategy:'staged',provider:'openai'},{id:'staged-gemini',strategy:'staged',provider:'gemini'}]:[config.selected];
const selected=cases.filter(x=>config.phase==='compare'?x.split==='reference':x.split==='holdout'||x.split==='development');
if(selected.length>15||variants.length>3)throw Error('BENCHMARK_BUDGET_EXCEEDED');
const dir=new URL('../tarot-benchmark/',import.meta.url);await fs.mkdir(dir,{recursive:true});
const results=[];
// Sequential, no automatic retry, no output cherry-picking, no application quota overrides.
for(const c of selected) for(const variant of variants){
 const input=validateTarot({action:'reading',visualMode:'callout-v2',question:c.question,rounds:c.rounds,messages:[],context:{}}),start=Date.now();
 const row={id:c.id,variant:variant.id,version:ENGINE_VERSION,createdAt:new Date().toISOString()};
 try{
  row.response=await generateReading(input,{results:[]},{...variant,complete:completeTarot});row.contractPassed=true;
 }catch(e){row.error=String(e.message).slice(0,100);row.contractPassed=false;}
 row.elapsedMs=Date.now()-start;
 await fs.writeFile(new URL(`${c.id}--${variant.id}.json`,dir),JSON.stringify(row,null,2));
 results.push({id:row.id,variant:row.variant,contractPassed:row.contractPassed,error:row.error,elapsedMs:row.elapsedMs,telemetry:row.response?.telemetry});
 console.log(JSON.stringify(results.at(-1)));
}
await fs.writeFile(new URL('index.json',dir),JSON.stringify({config,results},null,2));
