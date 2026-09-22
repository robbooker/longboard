// Test-only transport redirect. Production code retains its fixed HTTPS destination.
const original=globalThis.fetch;
globalThis.fetch=(input,init)=>original(input==='https://xejuximbbpnzqylukrsn.supabase.co/functions/v1/chat-membership-export'?'http://127.0.0.1:54535/test/membership-export':input,init);
