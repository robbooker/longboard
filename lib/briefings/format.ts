// Display formatters for briefing data. The DB stores raw numbers; everything
// here is presentation-only.

export function humanizeNumber(
  n: number | null | undefined,
  opts: { currency?: boolean } = {},
): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const prefix = opts.currency ? `${sign}$` : sign;

  const fmt = (value: number, unit: string) => {
    const decimals = value < 100 ? 1 : 0;
    return `${prefix}${value.toFixed(decimals)}${unit}`;
  };

  if (abs < 1_000) return `${prefix}${abs}`;
  if (abs < 1_000_000) return fmt(abs / 1_000, "K");
  if (abs < 1_000_000_000) return fmt(abs / 1_000_000, "M");
  if (abs < 1_000_000_000_000) return fmt(abs / 1_000_000_000, "B");
  return fmt(abs / 1_000_000_000_000, "T");
}

export function formatPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
}

export function formatPctChange(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

export function formatVolume(n: number | null | undefined): string {
  return humanizeNumber(n);
}

// Briefing-date strings come in as YYYY-MM-DD already anchored to ET. Render
// without re-passing through Date in case the local TZ shifts the displayed day.
export function formatBriefingDate(yyyymmdd: string): string {
  const [y, m, d] = yyyymmdd.split("-");
  if (!y || !m || !d) return yyyymmdd;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function formatGeneratedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}
