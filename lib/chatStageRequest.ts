// #522: how the stage's API routes read a request, more strictly than the rest of the app does.
// Used only by the routes under app/api/chat/stage/. No LiveKit and no database in here.

/** The few things read from a request (a NextRequest fits). */
type StageRequest = { headers: { get(name: string): string | null }; json(): Promise<unknown> };

/**
 * Whether a POST to a browser-only stage route came from this site's own pages.
 * requestOriginAllowed() (lib/chatAdmin.ts) lets a request with NO Origin header through, which is
 * right for the rest of the app and too easy here (the stage routes hand out video tokens and
 * reset stream keys). So one of these must hold:
 *  - an Origin header whose host is this site's;
 *  - no Origin, but `Sec-Fetch-Site: same-origin` (the browser's own word, which a page cannot set);
 *  - no Origin and no Sec-Fetch-Site, but a Referer on this site's host.
 * Every browser the chat runs in sends Origin on a same-origin POST made with fetch(): Chrome and
 * the installed app on Android, Firefox, Safari and the installed app on iOS. Chrome, Firefox and
 * Safari 16.4+ also send Sec-Fetch-Site, and all send a Referer unless a privacy setting strips it.
 * An "Origin: null" (a sandboxed frame) is refused, as is a request with none of the three.
 */
export function stageOriginAllowed(request: Pick<StageRequest, "headers">): boolean {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return false;
  const sameHost = (address: string) => {
    try {
      return new URL(address).host === host;
    } catch {
      return false;
    }
  };
  const origin = request.headers.get("origin");
  if (origin) return sameHost(origin);
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const referer = request.headers.get("referer");
  return !!referer && sameHost(referer);
}

/**
 * A POST's JSON body, only when it is a plain object: null for a body that is missing, not JSON,
 * or any other JSON (null, a number, text, a list). The route answers 400 before reading a field.
 */
export async function stageBody(request: Pick<StageRequest, "json">): Promise<Record<string, unknown> | null> {
  const body = await request.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}
