// Redirect only the fixed membership source to this task's local synthetic fixture.
import './chat-attachments-scanner-fixture.cjs';
const original=globalThis.fetch;
globalThis.fetch=(input,init)=>original(input==='https://xejuximbbpnzqylukrsn.supabase.co/functions/v1/chat-membership-export'?'http://127.0.0.1:54571/test/membership-export':input,init);
