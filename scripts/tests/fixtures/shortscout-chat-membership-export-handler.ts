// Vendored test copy of shortscout supabase/functions/chat-membership-export/handler.ts (robbooker/shortscout
// f56fb7c), so the chat fixtures can sign membership answers without the sibling repo. Takes its key as an
// argument; contains no secret. Point CHAT_AUTH_SOURCE_HANDLER at the live file to test against the source.
/** Server-to-server membership export. No user JWT or browser CORS access. */
export type MembershipRecord =
  | { subject: string; state: 'update'; level: 'monthly' | 'annual' | 'lifetime' | 'mastermind' }
  | { subject: string; state: 'revoke'; level: 'free' }
  | { subject: string; state: 'delete'; level: null };
export type AuthorizationRecord =
  | { subject: string; state: 'allow'; level: 'monthly' | 'annual' | 'lifetime' | 'mastermind' }
  | { subject: string; state: 'deny'; level: null };
export type ExportDependencies = {
  key: string;
  lookup: (subjects: string[]) => Promise<MembershipRecord[]>;
  authorize?: (subjects: string[]) => Promise<AuthorizationRecord[]>;
  now?: () => number;
};
const encoder = new TextEncoder();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
const response = (error: string, status: number) => new Response(JSON.stringify({ error }), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
async function boundedBody(req: Request): Promise<Uint8Array> {
  if (Number(req.headers.get('content-length')) > 32768) throw Error('too_large');
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 32768) { await reader.cancel(); throw Error('too_large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  return body;
}
export function membershipExportHandler(deps: ExportDependencies) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') return response('method_not_allowed', 405);
    if (encoder.encode(deps.key).length < 32) return response('export_unavailable', 503);
    const timestamp = req.headers.get('x-chat-membership-timestamp') ?? '';
    const nonce = req.headers.get('x-chat-membership-nonce') ?? '';
    const signature = req.headers.get('x-chat-membership-signature') ?? '';
    const now = () => Math.floor((deps.now?.() ?? Date.now()) / 1000);
    if (!/^[1-9][0-9]{9,11}$/.test(timestamp) || Math.abs(now() - Number(timestamp)) > 60
      || !/^[0-9a-f]{32}$/.test(nonce) || !/^[0-9a-f]{64}$/.test(signature)) return response('unauthorized', 401);
    let body: Uint8Array;
    try { body = await boundedBody(req); }
    catch (error) { return response(error instanceof Error && error.message === 'too_large' ? 'body_too_large' : 'invalid_body', error instanceof Error && error.message === 'too_large' ? 413 : 400); }
    let raw: string;
    try { raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body); }
    catch { return response('invalid_body', 400); }
    const key = await crypto.subtle.importKey('raw', encoder.encode(deps.key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    const bytes = Uint8Array.from(signature.match(/../g)!, h => parseInt(h, 16));
    // WebCrypto verifies HMAC without a secret-dependent JavaScript string comparison.
    if (Math.abs(now() - Number(timestamp)) > 60 || !await crypto.subtle.verify('HMAC', key, bytes, encoder.encode(`request\n${timestamp}\n${nonce}\n${raw}`))) return response('unauthorized', 401);
    let subjects: string[], authorization = false;
    try {
      const data = JSON.parse(raw);
      authorization = data?.version === 2 && data?.purpose === 'chat-authorization';
      if (!data || typeof data !== 'object' || Array.isArray(data)
        || Object.keys(data).sort().join(',') !== (authorization ? 'purpose,subjects,version' : 'subjects,version')
        || (!authorization && data.version !== 1) || !Array.isArray(data.subjects) || data.subjects.length < 1 || data.subjects.length > 200
        || data.subjects.some((s: unknown) => typeof s !== 'string' || !uuid.test(s))
        || new Set(data.subjects).size !== data.subjects.length) return response('invalid_request', 400);
      subjects = data.subjects;
    } catch { return response('invalid_request', 400); }
    try {
      if (authorization && !deps.authorize) throw Error('authorization_unavailable');
      const records = authorization ? await deps.authorize!(subjects) : await deps.lookup(subjects);
      if (!Array.isArray(records) || records.length !== subjects.length) throw Error('invalid_lookup');
      const bySubject = new Map(records.map(record => [record.subject, record]));
      if (bySubject.size !== subjects.length) throw Error('invalid_lookup');
      const ordered = subjects.map(subject => {
        const record = bySubject.get(subject);
        if (!record || Object.keys(record).sort().join(',') !== 'level,state,subject'
          || !(authorization
            ? record.state === 'allow' && ['monthly', 'annual', 'lifetime', 'mastermind'].includes(record.level)
              || record.state === 'deny' && record.level === null
            : record.state === 'update' && ['monthly', 'annual', 'lifetime', 'mastermind'].includes(record.level)
            || record.state === 'revoke' && record.level === 'free'
            || record.state === 'delete' && record.level === null)) throw Error('invalid_lookup');
        return record;
      });
      const requestDigest = hex(await crypto.subtle.digest('SHA-256', new Uint8Array(body)));
      // Version 1 keeps its original byte envelope and display-only semantics.
      const output = JSON.stringify(authorization
        ? { version: 2, purpose: 'chat-authorization', nonce, requestDigest, records: ordered }
        : { version: 1, nonce, requestDigest, records: ordered });
      if (encoder.encode(output).length > 65536) throw Error('response_too_large');
      const responseTimestamp = String(now());
      const signed = hex(await crypto.subtle.sign('HMAC', key, encoder.encode(`response\n${responseTimestamp}\n${nonce}\n${output}`)));
      return new Response(output, { status: 200, headers: {
        'Content-Type': 'application/json', 'Cache-Control': 'no-store',
        'x-chat-membership-timestamp': responseTimestamp,
        'x-chat-membership-signature': signed,
      } });
    } catch { return response('membership_lookup_unavailable', 503); }
  };
}
