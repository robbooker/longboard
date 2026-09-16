import { expect, it } from 'vitest';
import { NotificationSoundTracker } from '../notificationSound';
const item = (id: string, time: number, read = false) => ({ id, created_at: new Date(time * 1000).toISOString(), read_at: read ? 'read' : null });
it('silences the initial unread inbox and repeated polling', () => {
 const tracker = new NotificationSoundTracker();
 expect(tracker.observe([item('old', 1)])).toBe(false);
 expect(tracker.observe([item('old', 1)])).toBe(false);
 expect(tracker.observe([item('new', 2), item('old', 1)])).toBe(true);
 expect(tracker.observe([item('new', 2), item('old', 1)])).toBe(false);
});
it('does not replay read, removed, or older items returning to the list', () => {
 const tracker = new NotificationSoundTracker();
 tracker.observe([item('old', 3)]);
 expect(tracker.observe([item('read', 4, true)])).toBe(false);
 expect(tracker.observe([])).toBe(false);
 expect(tracker.observe([item('read', 4), item('older', 2)])).toBe(false);
});
it('handles empty initial inbox, multiple arrivals and timestamp ties', () => {
 const tracker = new NotificationSoundTracker();
 expect(tracker.observe([])).toBe(false);
 expect(tracker.observe([item('a', 1), item('b', 1)])).toBe(true);
 expect(tracker.observe([item('b', 1), item('a', 1)])).toBe(false);
 expect(tracker.observe([item('c', 1), item('a', 1)])).toBe(true);
 expect(tracker.observe([item('b', 1), item('c', 1)])).toBe(false);
});
it('advances while sounds are disabled so enabling cannot replay alerts', () => {
 const tracker = new NotificationSoundTracker();
 tracker.observe([]);
 tracker.observe([item('while-muted', 2)]);
 expect(tracker.observe([item('while-muted', 2)])).toBe(false);
 expect(tracker.observe([item('later', 3)])).toBe(true);
});
