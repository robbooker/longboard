// Local synthetic signed membership source only; never enable in deployments.
const original=globalThis.fetch;
globalThis.fetch=(input,init)=>original(input==='https://xejuximbbpnzqylukrsn.supabase.co/functions/v1/chat-membership-export'?'http://127.0.0.1:54568/test/membership-export':input,init);
