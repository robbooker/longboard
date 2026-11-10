"use client";
// #420: the Look section of Profile settings: the four themes, then the colour combinations for
// the standard look. Loaded only when the dialog opens. The choice is one app-wide setting
// (room/useChatTheme.ts), so the single chat, Quad, Six and every dialog change at once.
import { CHAT_PALETTES, type ChatLook, type ChatTheme } from "@/lib/chatTheme";
import { CHAT_THEMES, useChatTheme } from "./room/useChatTheme";
import publicStyles from "./PublicChat.module.css";
import styles from "./ChatLookPicker.module.css";

/** One choice: a small preview drawn in that look's own colours, and its name. */
function Choice(props: { value: ChatLook; label: string; theme: ChatTheme; palette?: string }) {
  const { look, setTheme } = useChatTheme();
  return (
    <button
      type="button"
      className={styles.choice}
      aria-pressed={look === props.value}
      data-look={props.value}
      onClick={() => setTheme(props.value)}
    >
      <span
        className={`${publicStyles.themeScope} ${styles.swatch}`}
        data-theme={props.theme}
        data-palette={props.palette}
        aria-hidden="true"
      >
        <span className={styles.panel}>
          <span className={styles.sample} />
          <span className={styles.accent} />
        </span>
      </span>
      <span className={styles.name}>{props.label}</span>
    </button>
  );
}

/** signedIn words the note under the swatches (a visitor's choice stays on their device). */
export default function ChatLookPicker(props: { signedIn?: boolean }) {
  return (
    <div className={styles.look}>
      <div className={styles.themes} role="group" aria-label="Chat theme">
        {CHAT_THEMES.map((theme) => (
          <Choice key={theme.value} value={theme.value} label={theme.label} theme={theme.value} />
        ))}
      </div>
      <p className={styles.label}>Colours for the standard look</p>
      <div className={styles.palettes} role="group" aria-label="Colour combination">
        {CHAT_PALETTES.map((palette) => (
          <Choice
            key={palette.id}
            value={palette.id}
            label={palette.label}
            theme={palette.base}
            palette={palette.id}
          />
        ))}
      </div>
      <p className={styles.note}>
        {props.signedIn
          ? "Your choice is saved to your account and follows you to your other devices."
          : "Your choice is saved on this device."}
      </p>
    </div>
  );
}
