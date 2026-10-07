// One paid live request per fixture. No retries, rerolls or automatic style scoring.
// Usage: node scripts/evalTarotPlainLanguage.mjs https://saju-grap.vercel.app/api/tarot [id ...]
import fs from 'node:fs/promises';
import {validateTarot} from '../lib/tarotValidation.js';
import {READING_VERSION} from '../lib/tarotReadingMaterial.js';

const [endpoint,...ids]=process.argv.slice(2);
if (!endpoint || new URL(endpoint).protocol!=='https:') throw Error('Supply the authorized HTTPS tarot endpoint');
const fixtures=JSON.parse(await fs.readFile(new URL('../eval/tarot-plain-language/fixtures.json',import.meta.url)));
const selected=fixtures.filter(f=>!ids.length||ids.includes(f.id));
if (!selected.length || ids.some(id=>!fixtures.some(f=>f.id===id))) throw Error('Unknown fixture');
const out=new URL('../eval/tarot-plain-language/results/',import.meta.url);
await fs.mkdir(out,{recursive:true});
let failed=false;
for (const f of selected) {
  const input={action:'reading',visualMode:'callout-v2',question:f.question,rounds:f.rounds,messages:[],context:{}};
  const expected=validateTarot(input).rounds.at(-1).cards.map(c=>c.id);
  const start=Date.now();
  try {
    const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://tarot-with-you.vercel.app'},body:JSON.stringify(input),signal:AbortSignal.timeout(115000)});
    const data=await response.json();
    const actual=data.cardReadings?.map(c=>c.id);
    const passed=response.ok&&JSON.stringify(actual)===JSON.stringify(expected)&&data.summary?.length===3&&data.cardReadings.every(c=>c.callouts?.length>=2&&c.callouts?.length<=4);
    await fs.writeFile(new URL(f.id+'.json',out),JSON.stringify({id:f.id,createdAt:new Date().toISOString(),expectedReadingVersion:READING_VERSION,endpoint,input,status:response.status,elapsedMs:Date.now()-start,contractPassed:passed,data},null,2)+'\n');
    console.log(JSON.stringify({id:f.id,status:response.status,elapsedMs:Date.now()-start,contractPassed:passed,message:data.message,error:data.error}));
    if (!passed) {failed=true;break;}
  } catch (error) {console.error(JSON.stringify({id:f.id,error:error.message}));failed=true;break;}
}
if(failed)process.exitCode=1;
