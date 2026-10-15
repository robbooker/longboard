const INTERRUPTED = "Chat updates interrupted. Reconnecting automatically…";
/**
 * Intentional disposal (our own abort: superseded, session or page change) is not a network
 * failure and must never become a warning. Its message is empty so callers that show
 * `error.message` show nothing.
 */
export class ChatReadCancelled extends Error {
  constructor() {
    super("");
    this.name = "ChatReadCancelled";
  }
}
/** A transport failure. Raw fetch errors ("signal is aborted without reason", "Failed to fetch") never reach the UI. */
export class ChatReadUnavailable extends Error {
  constructor() {
    super(INTERRUPTED);
    this.name = "ChatReadUnavailable";
  }
}
export class ChatReadTimeout extends Error {
  constructor() {
    super("Chat updates timed out. Reconnecting automatically…");
    this.name = "ChatReadTimeout";
  }
}

/** One instance per room/history watcher; never shares action errors or room state. */
export class ChatReadRecovery {
  private failed = false;
  constructor(private update: (message: string) => void) {}
  failure(error: unknown) {
    if (error instanceof ChatReadCancelled) return;
    if (this.failed) return;
    this.failed = true;
    // Do not log URLs, identifiers, content, server responses or raw exceptions.
    console.info("[chat-updates] history-unavailable");
    this.update(INTERRUPTED);
  }
  success() {
    if (!this.failed) return;
    this.failed = false;
    console.info("[chat-updates] history-recovered");
    this.update("");
  }
}
