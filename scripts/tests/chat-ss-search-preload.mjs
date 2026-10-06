// Local-only membership and deterministic synthetic vector provider. No external calls.
const original=globalThis.fetch;
globalThis.fetch=(input,init)=>{
 if(input==='https://xejuximbbpnzqylukrsn.supabase.co/functions/v1/chat-membership-export')return original('http://127.0.0.1:54574/test/membership-export',init);
 if(input==='https://api.openai.com/v1/embeddings'){
  const {input:texts}=JSON.parse(init.body);return Promise.resolve(new Response(JSON.stringify({data:texts.map((_,index)=>({index,embedding:[1,...Array(1535).fill(0)]})),usage:{total_tokens:texts.length}}),{status:200,headers:{'content-type':'application/json'}}));
 }
 return original(input,init);
};
