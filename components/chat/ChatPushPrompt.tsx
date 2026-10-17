"use client";

import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { chatPushPlatform } from "@/lib/chatPushBrowser";
import type { PushPromptState } from "@/lib/chatPushPrompt";
import ChatIcon from "./ChatIcon";
import { CHAT_OPEN_PUSH_PROMPT, openPushPrompt, snoozeChatPushPrompt } from "./usePushPrompt";
import styles from "./ChatPushPrompt.module.css";

/** PHONE-NOTIFY-PROMPT: the bell-with-a-slash in a phone header while notifications are off here. */
export function ChatPushPromptButton({
  state,
  className,
  size = 22,
}: {
  state: PushPromptState;
  className: string;
  size?: number;
}) {
  if (state === "hidden") return null;
  const label = state === "denied" ? "Phone notifications are blocked" : "Phone notifications are off";
  return (
    <button
      type="button"
      className={className}
      data-push-prompt={state}
      aria-label={label}
      title={label}
      aria-haspopup="dialog"
      onClick={(event) => openPushPrompt(state, event.currentTarget)}
    >
      <ChatIcon name="bellOff" size={size} />
    </button>
  );
}

// The sheet opens in the top layer, outside the room's themed page: it borrows the page's colors.
const THEME_VARS = [
  "--chat-text",
  "--chat-muted",
  "--chat-panel",
  "--chat-panel-raised",
  "--chat-line",
  "--chat-palm",
  "--chat-palm-soft",
  "--chat-scrim",
  "--chat-shadow",
  "--chat-font-ui",
];
function themeFrom(element: Element | null): CSSProperties {
  const page = element?.closest("[data-theme]");
  if (!page) return {};
  const computed = getComputedStyle(page);
  const style: Record<string, string> = {};
  for (const name of THEME_VARS) {
    const value = computed.getPropertyValue(name).trim();
    if (value) style[name] = value;
  }
  return style as CSSProperties;
}

/** The short steps the icon opens when the site cannot turn notifications on by itself. */
export default function ChatPushPromptSheet() {
  const [kind, setKind] = useState<"install" | "denied" | null>(null);
  const [ios, setIos] = useState(false);
  const [theme, setTheme] = useState<CSSProperties>({});
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const heading = useId();

  useEffect(() => {
    const show = (event: Event) => {
      const detail = (event as CustomEvent<{ kind?: string; from?: HTMLElement }>).detail;
      const next = detail?.kind;
      if (next !== "install" && next !== "denied") return;
      trigger.current =
        detail.from ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
      setTheme(themeFrom(trigger.current));
      setIos(chatPushPlatform(navigator.userAgent, navigator.platform, navigator.maxTouchPoints, false).ios);
      setKind(next);
    };
    window.addEventListener(CHAT_OPEN_PUSH_PROMPT, show);
    return () => window.removeEventListener(CHAT_OPEN_PUSH_PROMPT, show);
  }, []);
  useEffect(() => {
    if (!kind) return;
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, [kind]);

  function close(focus = true) {
    dialog.current?.close();
    setKind(null);
    if (focus && trigger.current?.isConnected) trigger.current.focus();
  }

  if (!kind) return null;
  return (
    <dialog
      ref={dialog}
      className={styles.sheet}
      style={theme}
      aria-labelledby={heading}
      data-push-prompt-sheet={kind}
      onKeyDown={(event) => event.stopPropagation()}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className={styles.grab} aria-hidden="true" />
      <header className={styles.head}>
        <h2 id={heading}>
          {kind === "install" ? "Add Chat to your Home Screen" : "Notifications are blocked"}
        </h2>
        <button type="button" className={styles.close} aria-label="Close" onClick={() => close()}>
          <ChatIcon name="close" />
        </button>
      </header>
      <div className={styles.body}>
        {kind === "install" ? (
          <>
            <p>On iPhone, notifications work from the Home Screen app, not a Safari tab.</p>
            <ol>
              <li>
                Tap <strong>Share</strong> in Safari’s toolbar.
              </li>
              <li>
                Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>.
              </li>
              <li>
                Open <strong>Rob Booker Chat</strong> from your Home Screen and tap this icon again.
              </li>
            </ol>
            <p className={styles.note}>Needs iOS 16.4 or later.</p>
          </>
        ) : (
          <>
            <p>Chat can’t ask again, so turn notifications back on in your phone’s settings.</p>
            {ios ? (
              <ol>
                <li>
                  Open <strong>Settings → Notifications</strong>.
                </li>
                <li>
                  Choose <strong>Rob Booker Chat</strong> and turn on <strong>Allow Notifications</strong>.
                </li>
                <li>Come back to chat.</li>
              </ol>
            ) : (
              <ol>
                <li>
                  Tap the <strong>lock</strong> or <strong>⋮</strong> by the address bar, then{" "}
                  <strong>Site settings</strong> (installed app: hold its icon → <strong>App info</strong>).
                </li>
                <li>
                  Set <strong>Notifications</strong> to <strong>Allow</strong>.
                </li>
                <li>Come back to chat.</li>
              </ol>
            )}
          </>
        )}
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          onClick={() => {
            snoozeChatPushPrompt();
            close(false);
          }}
        >
          Not now
        </button>
        {kind === "denied" ? (
          <button
            type="button"
            data-primary="true"
            onClick={() => {
              close(false);
              openPushPrompt("settings", trigger.current);
            }}
          >
            Notification settings
          </button>
        ) : (
          <button type="button" data-primary="true" onClick={() => close()}>
            Got it
          </button>
        )}
      </div>
    </dialog>
  );
}
