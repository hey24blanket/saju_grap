"""Observable metrics only; semantic quality requires quoted review."""
import json, sys, statistics, collections
from pathlib import Path
rows=[]
for name in sys.argv[1:]:
 data=json.loads(Path(name).read_text())
 for scenario in data['results']:
  for t in scenario['turns']:
   d=t.get('diagnostic',{});u=d.get('usage') or {}
   rows.append({'file':Path(name).name,'profile':data['profileId'],'scenario':scenario['id'],'turn':t['turn'],'question':t['userMessage'],'reply':t['reply'],'elapsedMs':t['elapsedMs'],'provider':d.get('provider'),'model':d.get('model'),'promptVersion':d.get('promptVersion'),'fallback':d.get('fallbackUsed',False),'fallbackProviderStatus':d.get('fallbackProviderStatus'),'inputTokens':u.get('promptTokenCount',u.get('input_tokens',0)),'outputTokens':u.get('candidatesTokenCount',u.get('output_tokens',0)),'totalTokens':u.get('totalTokenCount',u.get('total_tokens',0)),'stateStatus':d.get('state',{}).get('status'),'stateReason':d.get('state',{}).get('reason'),'ragStatus':d.get('rag',{}).get('status'),'ragRetrieval':d.get('rag',{}).get('retrieval'),'responseMode':d.get('counselingOrchestrator',{}).get('interpretationBrief',{}).get('responseMode')})
lat=sorted(r['elapsedMs'] for r in rows)
summary={'responses':len(rows),'models':dict(collections.Counter(r['model'] for r in rows)),'promptVersions':dict(collections.Counter(r['promptVersion'] for r in rows)),'fallbacks':sum(r['fallback'] for r in rows),'meanChars':round(statistics.mean(len(r['reply']) for r in rows),1),'meanMs':round(statistics.mean(lat),1),'p95Ms':lat[max(0,int(len(lat)*.95)-1)],'stateStatuses':dict(collections.Counter(r['stateStatus'] for r in rows)),'ragStatuses':dict(collections.Counter(r['ragStatus'] for r in rows)),'tokensByModel':{m:{k:sum(r[k] for r in rows if r['model']==m) for k in ['inputTokens','outputTokens','totalTokens']} for m in set(r['model'] for r in rows)}}
print(json.dumps(summary,ensure_ascii=False,indent=2))
Path('/tmp/saju-eval-transcripts.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in rows))
