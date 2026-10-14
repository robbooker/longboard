/** One stroked icon set for chat controls (UI-ICONS-BUTTONS); emoji stay content only. */
const PATHS = {
  lock: "M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z",
  pin: "M12 17v5M8 3h8l-1 6 3 4H6l3-4z",
  star: "M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z",
  moon: "M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z",
  sun: "M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
  spark: "M12 2l2 7 7 3-7 3-2 7-2-7-7-3 7-3z",
  paperclip: "M21 11.5l-8.5 8.5a5 5 0 0 1-7-7L14 4.5a3.3 3.3 0 0 1 4.7 4.7L10.2 17.7a1.7 1.7 0 0 1-2.4-2.4L15.5 7.6",
  mic: "M9 3h6v11H9zM5 11a7 7 0 0 0 14 0M12 18v3",
  search: "M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM16 16l4.5 4.5",
} as const;
export type ChatIconName = keyof typeof PATHS;
export default function ChatIcon({ name, size = 16, filled = false }: { name: ChatIconName; size?: number; filled?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flex: "none", verticalAlign: "-0.15em" }}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
