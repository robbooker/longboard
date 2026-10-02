// Synthetic local source only; never enable this preload in a deployment.
const original=globalThis.fetch;
globalThis.fetch=(input,init)=>original(input==='https://xejuximbbpnzqylukrsn.supabase.co/functions/v1/chat-membership-export'?'http://127.0.0.1:54564/test/membership-export':input,init);
