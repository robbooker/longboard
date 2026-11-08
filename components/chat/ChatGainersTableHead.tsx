import type { ReactNode } from "react";
import styles from "./ChatGainersTable.module.css";

// #372: the Gainers Table's column headers. On a computer each shows its name; on a phone a small
// icon takes its place so more columns fit, and a one-line key under the intro says which is which.
// The name is always the header's accessible name and its tooltip. Icons are 16px line drawings
// in currentColor, so they follow the chat theme.
// #376: a phone shows only Symbol, Price, % today, Volume and Borrow at TZ; the other columns'
// icons stay here so every column has one, though only a computer shows those columns.

const svg = (children: ReactNode) => (
  <svg
    className={styles.headIcon}
    viewBox="0 0 16 16"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {children}
  </svg>
);

export const GAINERS_ICONS = {
  // A price tag with a hole.
  price: svg(
    <>
      <path d="M8.6 1.75H14.25V7.4L7.4 14.25 1.75 8.6Z" />
      <circle cx="11.25" cy="4.75" r="0.9" />
    </>,
  ),
  // A rising trend arrow.
  change: svg(
    <>
      <path d="M1.75 12 6 7.75 8.75 10.5 14.25 5" />
      <path d="M10.25 5H14.25V9" />
    </>,
  ),
  // Volume bars.
  volume: svg(
    <>
      <path d="M2.5 14.25V9.5M6.17 14.25V5.5M9.83 14.25V8M13.5 14.25V2" />
    </>,
  ),
  // #373 Borrow at TZ: a key (what it costs to borrow the shares).
  borrow: svg(
    <>
      <circle cx="4.75" cy="8" r="3" />
      <path d="M7.75 8H14.25M11.5 8V10.75M14 8V10.25" />
    </>,
  ),
  // #376 IB overnight fee: a moon over a percent sign (the yearly rate charged overnight).
  ibFee: svg(
    <>
      <path d="M7.5 1.75A3.25 3.25 0 1 0 10.75 6.6 2.6 2.6 0 0 1 7.5 1.75Z" />
      <path d="M14.25 9.25 9.25 14.25" />
      <circle cx="9.9" cy="9.9" r="0.75" />
      <circle cx="13.6" cy="13.6" r="0.75" />
    </>,
  ),
  // #376 IB avail: a stack of shares.
  ibAvail: svg(
    <>
      <path d="M8 1.75 14.25 4.75 8 7.75 1.75 4.75Z" />
      <path d="M1.75 8 8 11 14.25 8M1.75 11.25 8 14.25 14.25 11.25" />
    </>,
  ),
  // A clock.
  minutes: svg(
    <>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 4.5V8L10.5 9.5" />
    </>,
  ),
  // A globe.
  country: svg(
    <>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M1.75 8H14.25M8 1.75C6.2 3.6 5.4 5.7 5.4 8S6.2 12.4 8 14.25M8 1.75C9.8 3.6 10.6 5.7 10.6 8S9.8 12.4 8 14.25" />
    </>,
  ),
  // A banknote.
  cash: svg(
    <>
      <rect x="1.5" y="4" width="13" height="8" rx="1.25" />
      <circle cx="8" cy="8" r="1.75" />
      <path d="M4 6.25V9.75M12 6.25V9.75" />
    </>,
  ),
  // A columned institution.
  instOwn: svg(
    <>
      <path d="M1.75 6 8 2l6.25 4Z" />
      <path d="M3.5 6.5V12M6.5 6.5V12M9.5 6.5V12M12.5 6.5V12M1.75 14.25H14.25" />
    </>,
  ),
} satisfies Record<string, ReactNode>;

export type GainersIcon = keyof typeof GAINERS_ICONS;

/**
 * A column header: the name on a computer, the icon on a phone; named and titled either way.
 * #376: a desktopOnly column isn't shown on a phone at all (its value is in the row's details).
 */
export function GainersHead({ icon, name, title, number, desktopOnly }: { icon: GainersIcon; name: string; title?: string; number?: boolean; desktopOnly?: boolean }) {
  const className = [number ? styles.number : "", desktopOnly ? styles.desktopOnly : ""].filter(Boolean).join(" ");
  return (
    <th scope="col" className={className || undefined} aria-label={name} title={title ?? name} data-head={icon}>
      <span className={styles.headName}>{name}</span>
      {GAINERS_ICONS[icon]}
    </th>
  );
}

/** Phones only: which icon is which, in one line under the intro. */
export function GainersIconKey({ columns }: { columns: [GainersIcon, string][] }) {
  return (
    <p className={styles.iconKey} data-gainers-icon-key aria-hidden="true">
      {columns.map(([icon, name]) => (
        <span key={icon}>
          {GAINERS_ICONS[icon]} {name}
        </span>
      ))}
    </p>
  );
}
