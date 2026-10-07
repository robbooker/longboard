/** Collects step durations for a `Server-Timing` response header (visible in browser DevTools). */
export class ChatServerTiming {
  private entries: Array<[string, number]> = [];
  async time<T>(name: string, step: () => PromiseLike<T> | T): Promise<T> {
    const started = performance.now();
    try {
      return await step();
    } finally {
      this.entries.push([name.replace(/[^a-z0-9_]/gi, "_"), performance.now() - started]);
    }
  }
  record(name: string, ms: number): void {
    this.entries.push([name.replace(/[^a-z0-9_]/gi, "_"), ms]);
  }
  header(): string {
    return this.entries.map(([name, ms]) => `${name};dur=${ms.toFixed(1)}`).join(", ");
  }
}
