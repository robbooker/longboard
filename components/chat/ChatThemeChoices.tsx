"use client";
// The chat theme picker: the same buttons in the single chat's settings menu and in Quad and Six
// view's (#407). The choice is one app-wide setting (room/useChatTheme.ts).
import ChatIcon from "./ChatIcon";
import { CHAT_THEMES, useChatTheme } from "./room/useChatTheme";
import styles from "./PublicChat.module.css";

export default function ChatThemeChoices() {
  const { theme, setTheme } = useChatTheme();
  return (
    <div role="group" aria-label="Chat theme">
      {CHAT_THEMES.map((option) => (
        <button
          key={option.value}
          type="button"
          className={styles.menuItem}
          aria-pressed={theme === option.value}
          onClick={() => setTheme(option.value)}
        >
          <span className={styles.menuIconLabel}>
            <ChatIcon name={option.icon} /> {option.label}
          </span>
          <span aria-hidden="true">{theme === option.value ? "✓" : ""}</span>
        </button>
      ))}
    </div>
  );
}
