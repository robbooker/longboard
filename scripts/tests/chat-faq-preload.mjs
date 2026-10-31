// #338: the FAQ browser test's fake AI. Only OpenAI's address is answered here; no real service is
// called. A question containing "draft-fails" gets a failure, anything else a draft.
const real = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (!String(url?.url ?? url).startsWith('https://api.openai.com/')) return real(url, init);
  if (String(init?.body ?? '').includes('draft-fails')) return new Response('{"error":"down"}', { status: 500 });
  const content = JSON.stringify({ topic: 'Chat Hours', answer: 'Drafted by the fake AI.' });
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
};
