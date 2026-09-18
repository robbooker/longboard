export async function transcribeVoice(bytes:Uint8Array,request:typeof fetch=fetch):Promise<string>{
 const key=process.env.OPENAI_API_KEY;if(!key)throw Error('unavailable');
 const form=new FormData();form.set('model','gpt-4o-mini-transcribe');form.set('response_format','json');form.set('file',new Blob([new Uint8Array(bytes)],{type:'audio/wav'}),'voice.wav');
 const response=await request('https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{Authorization:`Bearer ${key}`},body:form,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(45000)});
 if(!response.ok||!response.body)throw Error('unavailable');
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>100000){await reader.cancel();throw Error('too_large');}chunks.push(part.value);}}finally{reader.releaseLock();}
 const joined=new Uint8Array(size);let offset=0;for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.length;}
 const result=JSON.parse(new TextDecoder().decode(joined));if(typeof result.text!=='string'||result.text.length>16000)throw Error('invalid_response');
 return result.text.trim()||'No speech could be recognized.';
}
