// Synthetic local test only. The production client retains its fixed signed HTTPS endpoint.
const original=globalThis.fetch;
globalThis.fetch=(input,init)=>original(input==='https://xejuximbbpnzqylukrsn.supabase.co/functions/v1/chat-membership-export'?'http://127.0.0.1:54555/test/membership-export':input,init);
