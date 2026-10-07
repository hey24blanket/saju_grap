// Provider credentials stay on the server. Never return request headers or provider error bodies.
export async function completeTarot({provider,system,payload,timeoutMs=40000,maxOutputTokens=7000,modelOverride,reasoningEffort}){
 const start=Date.now();let url,headers,body,model;
 if(provider==='openai'){
  if(!process.env.OPENAI_API_KEY)throw Error('OPENAI_NOT_CONFIGURED');
  model=modelOverride||process.env.TAROT_MODEL||process.env.OPENAI_MODEL||'gpt-5.6-luna';
  url='https://api.openai.com/v1/responses';headers={Authorization:`Bearer ${process.env.OPENAI_API_KEY}`};
  body={model,instructions:system,input:payload,max_output_tokens:maxOutputTokens,store:false,...(reasoningEffort?{reasoning:{effort:reasoningEffort}}:{})};
 }else if(provider==='gemini'){
  if(!process.env.GEMINI_API_KEY)throw Error('GEMINI_NOT_CONFIGURED');
  model=process.env.GEMINI_MODEL||'gemini-3.7-flash';
  url=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  headers={'x-goog-api-key':process.env.GEMINI_API_KEY};
  body={systemInstruction:{parts:[{text:system}]},contents:[{role:'user',parts:[{text:payload}]}],generationConfig:{maxOutputTokens,responseMimeType:'application/json'}};
 }else throw Error('INVALID_PROVIDER');
 const response=await fetch(url,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(timeoutMs)});
 if(!response.ok)throw Error(`${provider}_${response.status}`);
 const d=await response.json();
 const text=provider==='openai'?(d.output??[]).flatMap(x=>x.content??[]).filter(x=>x.type==='output_text').map(x=>x.text).join('\n'):(d.candidates?.[0]?.content?.parts??[]).filter(x=>!x.thought).map(x=>x.text||'').join('');
 if(!text||d.status==='incomplete'||d.candidates?.[0]?.finishReason==='MAX_TOKENS')throw Error('INCOMPLETE_RESPONSE');
 const u=provider==='openai'?d.usage:d.usageMetadata;
 return {text,metrics:{provider,model,elapsedMs:Date.now()-start,inputTokens:u?.input_tokens??u?.promptTokenCount??null,outputTokens:u?.output_tokens??u?.candidatesTokenCount??null,totalTokens:u?.total_tokens??u?.totalTokenCount??null}};
}
