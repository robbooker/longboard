import { describe, expect, it } from "vitest";
import {
  chatPushOnForAccount,
  PUSH_PROMPT_SNOOZE_KEY,
  PUSH_PROMPT_SNOOZE_MS,
  pushPromptSnoozed,
  pushPromptState,
  snoozePushPrompt,
  type PushPromptInput,
} from "@/lib/chatPushPrompt";

const base: PushPromptInput = {
  phone: true,
  signedIn: true,
  supported: true,
  permission: "default",
  subscribed: false,
  ios: false,
  standalone: false,
  snoozed: false,
};
const state = (change: Partial<PushPromptInput>) => pushPromptState({ ...base, ...change });

describe("pushPromptState", () => {
  it("never shows on a computer or when signed out", () => {
    expect(state({ phone: false })).toBe("hidden");
    expect(state({ phone: false, ios: true })).toBe("hidden");
    expect(state({ phone: false, permission: "denied" })).toBe("hidden");
    expect(state({ signedIn: false })).toBe("hidden");
  });

  it("opens settings when notifications are not set up yet", () => {
    expect(state({})).toBe("settings");
    expect(state({ permission: "granted", subscribed: false })).toBe("settings");
    expect(state({ permission: "default", subscribed: true })).toBe("settings");
  });

  it("hides once permission is granted and the device is subscribed", () => {
    expect(state({ permission: "granted", subscribed: true })).toBe("hidden");
    expect(state({ permission: "granted", subscribed: true, ios: true, standalone: true })).toBe("hidden");
  });

  it("stays hidden while the subscription is still unknown", () => {
    expect(state({ subscribed: null })).toBe("hidden");
    expect(state({ permission: "granted", subscribed: null })).toBe("hidden");
  });

  it("explains how to re-enable when permission is denied", () => {
    expect(state({ permission: "denied" })).toBe("denied");
    expect(state({ permission: "denied", subscribed: true })).toBe("denied");
    expect(state({ permission: "denied", subscribed: null })).toBe("denied");
    expect(state({ permission: "denied", ios: true, standalone: true })).toBe("denied");
  });

  it("asks an iPhone in a Safari tab to add the Home Screen app first", () => {
    // A Safari tab has no PushManager or Notification at all.
    expect(state({ ios: true, standalone: false, supported: false, permission: "unsupported" })).toBe(
      "install",
    );
    expect(state({ ios: true, standalone: false })).toBe("install");
    expect(state({ ios: true, standalone: false, permission: "denied" })).toBe("install");
    expect(state({ ios: true, standalone: true })).toBe("settings");
  });

  it("hides when this browser cannot do push at all", () => {
    // An installed iPhone app before iOS 16.4, or an old Android browser.
    expect(state({ ios: true, standalone: true, supported: false, permission: "unsupported" })).toBe("hidden");
    expect(state({ supported: false })).toBe("hidden");
    expect(state({ permission: "unsupported" })).toBe("hidden");
  });

  it("hides for every case while snoozed", () => {
    for (const change of [
      {},
      { permission: "denied" as const },
      { ios: true },
      { ios: true, standalone: true },
      { subscribed: null },
    ])
      expect(state({ ...change, snoozed: true })).toBe("hidden");
  });

  it("covers permission × subscription × standalone × iOS × snoozed", () => {
    const permissions = ["default", "granted", "denied", "unsupported"] as const;
    for (const permission of permissions)
      for (const subscribed of [true, false, null])
        for (const standalone of [true, false])
          for (const ios of [true, false])
            for (const snoozed of [true, false]) {
              const supported = permission !== "unsupported";
              const got = state({ permission, subscribed, standalone, ios, snoozed, supported });
              const want = snoozed
                ? "hidden"
                : ios && !standalone
                  ? "install"
                  : !supported
                    ? "hidden"
                    : permission === "denied"
                      ? "denied"
                      : subscribed === null || (permission === "granted" && subscribed)
                        ? "hidden"
                        : "settings";
              expect(got, JSON.stringify({ permission, subscribed, standalone, ios, snoozed })).toBe(want);
            }
  });
});

describe("chatPushOnForAccount", () => {
  const owner = { accountId: "alice", endpoint: "https://push.example.test/a" };
  it("needs a subscription", () => {
    expect(chatPushOnForAccount(null, owner, "alice")).toBe(false);
    expect(chatPushOnForAccount(null, null, "alice")).toBe(false);
  });
  it("counts this account's subscription, or one with no owner record", () => {
    expect(chatPushOnForAccount(owner.endpoint, owner, "alice")).toBe(true);
    expect(chatPushOnForAccount("https://push.example.test/renewed", owner, "alice")).toBe(true);
    expect(chatPushOnForAccount(owner.endpoint, null, "alice")).toBe(true);
  });
  it("does not count another account's subscription on this device", () => {
    expect(chatPushOnForAccount(owner.endpoint, owner, "bob")).toBe(false);
    expect(chatPushOnForAccount(owner.endpoint, owner, "")).toBe(false);
  });
});

describe("snooze", () => {
  const memory = () => {
    const values = new Map<string, string>();
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    };
  };
  it("hides for 30 days", () => {
    const storage = memory();
    const now = 1_800_000_000_000;
    expect(pushPromptSnoozed(storage, now)).toBe(false);
    snoozePushPrompt(storage, now);
    expect(Number(storage.getItem(PUSH_PROMPT_SNOOZE_KEY))).toBe(now + PUSH_PROMPT_SNOOZE_MS);
    expect(pushPromptSnoozed(storage, now + PUSH_PROMPT_SNOOZE_MS - 1)).toBe(true);
    expect(pushPromptSnoozed(storage, now + PUSH_PROMPT_SNOOZE_MS)).toBe(false);
  });
  it("survives storage that throws or holds junk", () => {
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(pushPromptSnoozed(throwing, 0)).toBe(false);
    expect(() => snoozePushPrompt(throwing, 0)).not.toThrow();
    expect(pushPromptSnoozed(null, 0)).toBe(false);
    expect(pushPromptSnoozed({ getItem: () => "soon" }, 0)).toBe(false);
  });
});
