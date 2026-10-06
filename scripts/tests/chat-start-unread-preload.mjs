// Redirect only the existing fixed membership destination to the local synthetic source.
const original=globalThis.fetch;
globalThis.fetch=(input,init)=>original(input==='https://xejuximbbpnzqylukrsn.supabase.co/functions/v1/chat-membership-export'?'http://127.0.0.1:54573/test/membership-export':input,init);
