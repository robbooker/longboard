// #460: the chat page's browser Supabase client, loaded after the first screen.
//
// The chat uses it only for subscriptions that start after the room is shown: the Postgres
// changes channel (ChatUpdates), the room's presence (useRoomPresence) and sign-in changes
// (PublicChat). Importing it statically put the whole Supabase browser library (auth, realtime,
// storage, PostgREST: about 45 kB gzipped) in every chat page's first load, ahead of the first
// message. One shared promise, so every caller gets the same client (createBrowserClient is a
// singleton in the browser anyway). A failed chunk load is forgotten so a later call retries;
// callers treat a failure as "no channel", which leaves the chat on its polling path.
type BrowserSupabase = ReturnType<typeof import("@/lib/supabase/client").createClient>;

let loading: Promise<BrowserSupabase> | undefined;

export function loadBrowserSupabase(): Promise<BrowserSupabase> {
  loading ??= import("@/lib/supabase/client")
    .then((module) => module.createClient())
    .catch((error: unknown) => {
      loading = undefined;
      throw error;
    });
  return loading;
}

/**
 * Runs `start` with the client once it has loaded, unless `stop` (the returned function) was
 * called first; `stop` also runs the cleanup `start` returned. For a React effect:
 *   useEffect(() => withBrowserSupabase((client) => { ...; return () => ... }), [...]);
 */
export function withBrowserSupabase(start: (client: BrowserSupabase) => void | (() => void)): () => void {
  let stopped = false;
  let cleanup: void | (() => void);
  void loadBrowserSupabase()
    .then((client) => {
      if (!stopped) cleanup = start(client);
    })
    .catch(() => undefined);
  return () => {
    stopped = true;
    cleanup?.();
  };
}
