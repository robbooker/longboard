import {afterEach,describe,it,expect,vi} from 'vitest';
import {transcribeVoice} from '@/lib/chatTranscription';
afterEach(()=>vi.unstubAllEnvs());
describe('bounded transcription provider',()=>{
 it('sends a fixed model and private WAV with a timeout; returns text as data',async()=>{
  vi.stubEnv('OPENAI_API_KEY','synthetic-only');const request=vi.fn(async()=>new Response(JSON.stringify({text:' <script>not markup</script> '})));
  expect(await transcribeVoice(new Uint8Array([1,2]),request)).toBe('<script>not markup</script>');
  const [url,init]=request.mock.calls[0] as unknown as [string,RequestInit];expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');expect(init).toMatchObject({cache:'no-store',redirect:'error',method:'POST'});expect(init.signal).toBeInstanceOf(AbortSignal);
  const form=init.body as FormData;expect(form.get('model')).toBe('gpt-4o-mini-transcribe');expect((form.get('file') as File).type).toBe('audio/wav');
 });
 it.each(['oversized','invalid','error','empty'])('handles %s provider responses',async mode=>{
  vi.stubEnv('OPENAI_API_KEY','synthetic-only');const request=vi.fn(async()=>new Response(mode==='oversized'?'x'.repeat(100001):JSON.stringify({text:mode==='invalid'?{}:''}),{status:mode==='error'?503:200}));
  if(mode==='empty')expect(await transcribeVoice(new Uint8Array(),request)).toBe('No speech could be recognized.');else await expect(transcribeVoice(new Uint8Array(),request)).rejects.toThrow();
 });
 it('makes no provider request without configured credentials',async()=>{vi.stubEnv('OPENAI_API_KEY','');const request=vi.fn();await expect(transcribeVoice(new Uint8Array(),request)).rejects.toThrow();expect(request).not.toHaveBeenCalled();});
});
