import { afterEach, describe, expect, it, vi } from "vitest";
import {
  publishUnreadDms,
  readUnreadDms,
  showUnreadDmsButton,
  subscribeUnreadDms,
  unreadDmsLabel,
  unreadDmsShort,
} from "../chatUnreadDms";

describe("unread DMs button (#453)", () => {
  afterEach(() => publishUnreadDms(0));

  it("is hidden with nothing unread", () => {
    expect(showUnreadDmsButton(0)).toBe(false);
    expect(unreadDmsLabel(0)).toBeNull();
    for (const odd of [-1, Number.NaN, Number.POSITIVE_INFINITY, 0.4]) {
      expect(showUnreadDmsButton(odd)).toBe(false);
      expect(unreadDmsLabel(odd)).toBeNull();
    }
  });

  it("says 1 unread DM for one and N unread DMs for more", () => {
    expect(showUnreadDmsButton(1)).toBe(true);
    expect(unreadDmsLabel(1)).toBe("1 unread DM");
    expect(unreadDmsLabel(2)).toBe("2 unread DMs");
    expect(unreadDmsLabel(37)).toBe("37 unread DMs");
    expect(unreadDmsLabel(2.9)).toBe("2 unread DMs");
  });

  it("keeps the phone's number short", () => {
    expect(unreadDmsShort(3)).toBe("3");
    expect(unreadDmsShort(99)).toBe("99");
    expect(unreadDmsShort(100)).toBe("99+");
  });

  it("tells listeners only when the count changes", () => {
    const listener = vi.fn();
    const stop = subscribeUnreadDms(listener);
    publishUnreadDms(2);
    publishUnreadDms(2);
    expect(readUnreadDms()).toBe(2);
    expect(listener).toHaveBeenCalledTimes(1);
    publishUnreadDms(-5);
    expect(readUnreadDms()).toBe(0);
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    publishUnreadDms(4);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
