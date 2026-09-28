/** Intentional disposal is not a network failure and must never become a warning. */
export class ChatReadCancelled extends Error {
  constructor() { super('Chat session changed.'); this.name = 'ChatReadCancelled'; }
}
export class ChatReadTimeout extends Error {
  constructor() { super('Chat updates timed out. Reconnecting automatically…'); this.name = 'ChatReadTimeout'; }
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
    console.info('[chat-updates] history-unavailable');
    this.update('Chat updates interrupted. Reconnecting automatically…');
  }
  success() {
    if (!this.failed) return;
    this.failed = false;
    console.info('[chat-updates] history-recovered');
    this.update('');
  }
}
