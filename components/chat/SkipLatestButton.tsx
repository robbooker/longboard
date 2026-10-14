"use client";
import styles from "./SkipLatestButton.module.css";
export default function SkipLatestButton({
  onClick,
  disabled = false,
  className,
  label,
}: {
  onClick: () => void;
  disabled?: boolean;
  /** Replaces the default small square style, e.g. to match neighbouring header buttons. */
  className?: string;
  /** Visible text after the arrow; the caller's styles decide when it shows. */
  label?: string;
}) {
  return (
    <button
      type="button"
      className={className ?? styles.button}
      title="Skip to Most Recent Message"
      aria-label="Skip to Most Recent Message"
      disabled={disabled}
      onClick={onClick}
    >
      {label ? (
        <>
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 4v15M6 13l6 6 6-6" />
          </svg>
          <span aria-hidden="true">{label}</span>
        </>
      ) : (
        <span aria-hidden="true">↓</span>
      )}
    </button>
  );
}
