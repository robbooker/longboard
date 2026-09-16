import type { FeatureNotification } from './chatFeatureNotifications';

/** Baseline the inbox silently; only newly arriving unread IDs may alert. */
export class NotificationSoundTracker {
  private initialized = false;
  private latest = '';
  private atLatest = new Set<string>();

  observe(items: Pick<FeatureNotification, 'id' | 'created_at' | 'read_at'>[]): boolean {
    let alert = false;
    let latest = this.latest;
    let ids = new Set(this.atLatest);
    for (const item of items) {
      const fresh = item.created_at > this.latest || (item.created_at === this.latest && !this.atLatest.has(item.id));
      if (this.initialized && fresh && !item.read_at) alert = true;
      if (item.created_at > latest) { latest = item.created_at; ids = new Set([item.id]); }
      else if (item.created_at === latest) ids.add(item.id);
    }
    this.latest = latest;
    this.atLatest = ids;
    this.initialized = true;
    return alert;
  }
}
