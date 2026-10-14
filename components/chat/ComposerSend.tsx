import styles from "./ChatComposer.module.css";

/** Round send arrow for the chat composers; "Sending" shows on the message itself. */
export default function ComposerSend({
  label,
  name,
  disabled,
  state,
  title,
  hidden,
}: {
  /** Visually hidden button text (defaults to label); tests and find-in-page match it. */
  label: string;
  /** Accessible name when it should say more than the text, e.g. "Send reply". */
  name?: string;
  disabled?: boolean;
  state?: string;
  title?: string;
  hidden?: boolean;
}) {
  return (
    <button
      type="submit"
      className={styles.send}
      aria-label={name}
      title={title ?? name ?? label}
      disabled={disabled}
      data-state={state}
      hidden={hidden}
    >
      <svg
        aria-hidden="true"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" />
      </svg>
      <span className={styles.srOnly}>{label}</span>
    </button>
  );
}
