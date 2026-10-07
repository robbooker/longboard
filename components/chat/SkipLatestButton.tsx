"use client";
import styles from "./SkipLatestButton.module.css";
export default function SkipLatestButton({
  onClick,
  disabled = false,
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={styles.button}
      title="Skip to Most Recent Message"
      aria-label="Skip to Most Recent Message"
      disabled={disabled}
      onClick={onClick}
    >
      <span aria-hidden="true">↓</span>
    </button>
  );
}
