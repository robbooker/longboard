"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Command2EmbeddedStockChart } from "@/components/command2/Command2StockChart";
import {
  waitForOneSignalPushSubscription,
  type OneSignalBrowserClient,
} from "@/lib/notifications/oneSignalBrowser";

type RvolScannerHit = {
  ticker: string;
  name: string | null;
  resolution: SignalResolution;
  changePct: number;
  priceNow: number;
  dayVolume: number;
  dollarVolume: number;
  signalTimeEt: string;
  signalUnixSeconds: number;
  signalPrice: number;
  signalRvol: number;
  breakoutLevel?: number;
  breakoutMode?: "premarketHigh" | "twoWeekHigh" | "monthToDateHigh";
  barsScanned: number;
  monthlyPivotTarget?: MonthlyPivotTarget | null;
  monthlyPivotCount?: number;
  monthlyPivotError?: string | null;
};

type RvolScannerPayload = {
  etDate: string;
  fetchedAt: string;
  scanned: number;
  mode?: ScannerMode;
  resolution: SignalResolutionFilter;
  hits: RvolScannerHit[];
  universe: {
    snapshotPool: number;
    candidateLimit: number;
    candidateOffset?: number;
    rawCandidateCount?: number;
    minPrice: number;
    minMovePct: number;
    maxPrice?: number | null;
    primaryExchanges?: string[] | null;
  };
};

type AskEdgarSummary = {
  ticker: string;
  fetchedAt: string;
  marketCap: number | null;
  floatOutstanding: number | null;
  estimatedCash: number | null;
  cashRemainingMonths: number | null;
  dilutionRisk: string | null;
  dilutionRiskDesc: string | null;
  cashNeed: string | null;
  cashNeedDesc: string | null;
  overallOfferingRisk: string | null;
  offeringAbility: string | null;
  offeringAbilityDesc: string | null;
  offeringFrequency: string | null;
  offeringFrequencyDesc: string | null;
  nasdaqCompliance: string | null;
  nasdaqComplianceDesc: string | null;
  cashBurn: number | null;
  regsho: boolean | null;
  notes: string | null;
  errors: string[];
};

type ScannerNewsItem = {
  id: string;
  ticker: string;
  published_utc?: string;
  title: string;
  source?: string;
  url?: string;
};

type SignalDetails = {
  fundamentals: AskEdgarSummary | null;
  news: ScannerNewsItem | null;
  errors: string[];
};

type LoadState =
  | { status: "loading"; data: RvolScannerPayload | null; error: null }
  | { status: "ready"; data: RvolScannerPayload; error: null }
  | { status: "error"; data: RvolScannerPayload | null; error: string };

type DetailState =
  | { status: "loading"; data: null; error: null }
  | { status: "ready"; data: SignalDetails; error: null }
  | { status: "error"; data: null; error: string };

type DetailTone = "good" | "watch" | "risk" | "neutral";
type BrowserAlertPermission = NotificationPermission | "unsupported";
type SortDirection = "asc" | "desc";
type SignalResolution = "1m" | "5m" | "1h" | "4h";
type SignalResolutionFilter = SignalResolution | "all";
type ScannerMode = "intraday" | "longTerm";
type ScannerVariant = "classic" | "monthlyPivots" | "scanner2";
type ScannerLayout = "workbench" | "table";
type MonthlyPivotTarget = {
  price: number;
  sourceMonth: string;
  sourceMonthLabel: string;
  activeMonth: string;
  activeMonthLabel: string;
  activeFromDate: string;
  lastCheckedDate: string;
};
type SortKey =
  | "ticker"
  | "resolution"
  | "signalUnixSeconds"
  | "signalPrice"
  | "priceNow"
  | "monthlyPivotPrice"
  | "changePct"
  | "signalRvol"
  | "dollarVolume";
type RvolPopupAlert = {
  id: string;
  ticker: string;
  body: string;
  rvol: string;
};

type SortState = {
  key: SortKey;
  direction: SortDirection;
} | null;

type SortColumn = {
  key: SortKey;
  label: string;
  defaultDirection: SortDirection;
  width?: string;
};

const REFRESH_MS = 60_000;
const UNAVAILABLE = "Unavailable";
const ALERT_PREF_KEY = "longboard:rvol-browser-alerts-enabled";
const SCANNER_LAYOUT_PREF_KEY = "longboard:rvol-scanner-layout";
const ALERT_TOAST_TTL_MS = 18_000;
const MAX_POPUP_ALERTS = 5;
const ONE_SIGNAL_APP_ID = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
const SCANNER_MODES: Array<{ value: ScannerMode; label: string }> = [
  { value: "intraday", label: "Intraday" },
  { value: "longTerm", label: "Long-Term" },
];
const SCANNER_LAYOUTS: Array<{ value: ScannerLayout; label: string }> = [
  { value: "workbench", label: "Signal Workbench" },
  { value: "table", label: "Tape Table" },
];
const SIGNAL_FILTERS: Record<ScannerMode, Array<{ value: SignalResolutionFilter; label: string }>> = {
  intraday: [
    { value: "all", label: "Both" },
    { value: "1m", label: "1m" },
    { value: "5m", label: "5m" },
  ],
  longTerm: [
    { value: "all", label: "Both" },
    { value: "1h", label: "1h" },
    { value: "4h", label: "4h" },
  ],
};
const SORT_COLUMNS: SortColumn[] = [
  { key: "ticker", label: "Ticker", defaultDirection: "asc", width: "20%" },
  { key: "resolution", label: "Signal", defaultDirection: "asc" },
  { key: "signalUnixSeconds", label: "Signal ET", defaultDirection: "desc" },
  { key: "signalPrice", label: "Signal Price", defaultDirection: "desc" },
  { key: "priceNow", label: "Price Now", defaultDirection: "desc" },
  { key: "changePct", label: "Move", defaultDirection: "desc" },
  { key: "signalRvol", label: "RVOL", defaultDirection: "desc" },
  { key: "dollarVolume", label: "Dollar Vol", defaultDirection: "desc" },
];
const MONTHLY_PIVOT_COLUMN: SortColumn = {
  key: "monthlyPivotPrice",
  label: "Missed Pivot",
  defaultDirection: "asc",
};

function withOneSignal<T>(callback: (OneSignal: OneSignalBrowserClient) => Promise<T> | T): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const win = window as Window & {
      OneSignalDeferred?: Array<(OneSignal: OneSignalBrowserClient) => void | Promise<void>>;
    };
    win.OneSignalDeferred = win.OneSignalDeferred || [];
    win.OneSignalDeferred.push(async (OneSignal) => {
      try {
        resolve(await callback(OneSignal));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function money(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value >= 10 ? 2 : 4,
    maximumFractionDigits: value >= 10 ? 2 : 4,
  }).format(value);
}

function distanceMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value >= 1 ? 2 : 4,
    maximumFractionDigits: value >= 1 ? 2 : 4,
  }).format(value);
}

function compact(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function compactNullable(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return UNAVAILABLE;
  return compact(value);
}

function compactMoney(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return UNAVAILABLE;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function pct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function unsignedPct(value: number): string {
  return `${Math.abs(value).toFixed(1)}%`;
}

function formatNewsAge(publishedUtc?: string): string {
  if (!publishedUtc) return UNAVAILABLE;
  const publishedAt = new Date(publishedUtc).getTime();
  if (!Number.isFinite(publishedAt)) return UNAVAILABLE;
  const minutes = Math.max(0, Math.round((Date.now() - publishedAt) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 24 * 60) return `${(minutes / 60).toFixed(1)} hr`;
  return `${Math.round(minutes / (24 * 60))} d`;
}

function premarketHighDistance(row: RvolScannerHit): { high: number; amount: number; percent: number; relation: "below" | "above" } | null {
  const high = row.breakoutMode === "premarketHigh" ? row.breakoutLevel : null;
  if (typeof high !== "number" || !Number.isFinite(high) || high <= 0) return null;
  const amount = row.priceNow - high;
  return {
    high,
    amount: Math.abs(amount),
    percent: Math.abs(amount / high) * 100,
    relation: amount >= 0 ? "above" : "below",
  };
}

function scannerUniverseLabel(data: RvolScannerPayload, mode: ScannerMode): string {
  if (mode === "longTerm") {
    const offset = data.universe.candidateOffset ?? 0;
    const rawCount = data.universe.rawCandidateCount;
    const sliceLabel = rawCount ? ` / SLICE ${offset + 1}-${Math.min(offset + data.scanned, rawCount)}` : "";
    return `NASDAQ > $${data.universe.minPrice}${sliceLabel} / ${data.scanned} SCANNED`;
  }
  return `TOP ${data.universe.candidateLimit} AFTER FILTERS`;
}

function formatFetchedAt(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function rvolAlertKey(row: RvolScannerHit): string {
  return `${row.resolution}:${row.ticker}:${row.signalUnixSeconds}`;
}

function formatRvolAlert(row: RvolScannerHit): RvolPopupAlert {
  const rvol = `${row.resolution} / ${row.signalRvol.toFixed(1)}x RVOL`;
  const price = money(row.signalPrice);
  return {
    id: rvolAlertKey(row),
    ticker: row.ticker,
    body: `${price} at ${row.signalTimeEt} ET / ${pct(row.changePct)} on the day`,
    rvol,
  };
}

function sortValue(row: RvolScannerHit, key: SortKey): string | number | null {
  if (key === "ticker") return row.ticker;
  if (key === "monthlyPivotPrice") return row.monthlyPivotTarget?.price ?? null;
  return row[key];
}

function compareRows(a: RvolScannerHit, b: RvolScannerHit, sort: SortState): number {
  if (!sort) return 0;
  const aValue = sortValue(a, sort.key);
  const bValue = sortValue(b, sort.key);
  const direction = sort.direction === "asc" ? 1 : -1;

  if (aValue === null && bValue === null) return 0;
  if (aValue === null) return 1;
  if (bValue === null) return -1;

  if (typeof aValue === "string" && typeof bValue === "string") {
    return aValue.localeCompare(bValue) * direction;
  }

  return (Number(aValue) - Number(bValue)) * direction;
}

async function fetchScanner(
  mode: ScannerMode,
  resolution: SignalResolutionFilter,
  signal?: AbortSignal,
): Promise<RvolScannerPayload> {
  const params = new URLSearchParams({ mode, resolution });
  const response = await fetch(`/api/command2/rvol-scanner?${params.toString()}`, {
    signal,
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(typeof json?.error === "string" ? json.error : "Unable to load scanner.");
  }
  return json as RvolScannerPayload;
}

async function fetchAskEdgarSummary(ticker: string, signal?: AbortSignal): Promise<AskEdgarSummary> {
  const params = new URLSearchParams({ ticker });
  const response = await fetch(`/api/command2/askedgar-summary?${params.toString()}`, {
    signal,
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(typeof json?.error === "string" ? json.error : "Unable to load AskEdgar details.");
  }
  return json as AskEdgarSummary;
}

async function fetchLatestNews(ticker: string, signal?: AbortSignal): Promise<ScannerNewsItem | null> {
  const params = new URLSearchParams({ tickers: ticker, limit: "1" });
  const response = await fetch(`/api/command/news?${params.toString()}`, {
    signal,
  });
  const json = await response.json().catch(() => null) as { items?: ScannerNewsItem[] } | null;
  if (!response.ok) {
    throw new Error(typeof (json as { error?: unknown } | null)?.error === "string" ? String((json as { error: string }).error) : "Unable to load catalyst.");
  }
  return Array.isArray(json?.items) ? json.items[0] ?? null : null;
}

async function fetchSignalDetails(ticker: string, signal?: AbortSignal): Promise<SignalDetails> {
  const [fundamentalsResult, newsResult] = await Promise.allSettled([
    fetchAskEdgarSummary(ticker, signal),
    fetchLatestNews(ticker, signal),
  ]);
  const fundamentals = fundamentalsResult.status === "fulfilled" ? fundamentalsResult.value : null;
  const news = newsResult.status === "fulfilled" ? newsResult.value : null;
  const errors = [
    fundamentalsResult.status === "rejected" ? fundamentalsResult.reason : null,
    newsResult.status === "rejected" ? newsResult.reason : null,
  ]
    .filter((error): error is Error => error instanceof Error)
    .map((error) => error.message);

  return { fundamentals, news, errors };
}

function rating(value: string | null): string {
  return value?.trim() ? value.trim().toUpperCase() : UNAVAILABLE;
}

function riskTone(value: string | null): DetailTone {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (normalized.includes("high") || normalized === "yes") return "risk";
  if (normalized.includes("medium") || normalized.includes("moderate")) return "watch";
  if (normalized.includes("low") || normalized === "no") return "good";
  return "neutral";
}

function runwayTone(months: number | null): DetailTone {
  if (months === null || !Number.isFinite(months)) return "neutral";
  if (months < 6) return "risk";
  if (months < 12) return "watch";
  return "good";
}

function detailRows(data: AskEdgarSummary): Array<[string, string, DetailTone]> {
  return [
    ["Float", compactNullable(data.floatOutstanding), "neutral"],
    ["Market cap", compactMoney(data.marketCap), "neutral"],
    ["Cash on hand", compactMoney(data.estimatedCash), "neutral"],
    [
      "Runway",
      data.cashRemainingMonths === null || !Number.isFinite(data.cashRemainingMonths)
        ? UNAVAILABLE
        : `${data.cashRemainingMonths.toFixed(1)} mo`,
      runwayTone(data.cashRemainingMonths),
    ],
    ["Overall risk", rating(data.overallOfferingRisk), riskTone(data.overallOfferingRisk)],
    ["Dilution", rating(data.dilutionRisk), riskTone(data.dilutionRisk)],
    ["Cash need", rating(data.cashNeed), riskTone(data.cashNeed)],
    ["Offer ability", rating(data.offeringAbility), riskTone(data.offeringAbility)],
    ["Offer frequency", rating(data.offeringFrequency), riskTone(data.offeringFrequency)],
    ["Listing risk", rating(data.nasdaqCompliance), riskTone(data.nasdaqCompliance)],
    ["Cash burn", compactMoney(data.cashBurn), "neutral"],
    ["Reg SHO", data.regsho === null ? UNAVAILABLE : data.regsho ? "YES" : "NO", riskTone(data.regsho === null ? null : data.regsho ? "high" : "low")],
  ];
}

function hasUsableAskEdgarData(data: AskEdgarSummary): boolean {
  return detailRows(data).some(([, value]) => value !== UNAVAILABLE) || !!data.notes;
}

function detailDrivers(data: AskEdgarSummary): Array<[string, string]> {
  return [
    ["Dilution", data.dilutionRiskDesc],
    ["Cash need", data.cashNeedDesc],
    ["Offering ability", data.offeringAbilityDesc],
    ["Offering frequency", data.offeringFrequencyDesc],
    ["Listing risk", data.nasdaqComplianceDesc],
  ].filter((row): row is [string, string] => typeof row[1] === "string" && row[1].trim().length > 0);
}

export default function RvolScannerClient({
  currentUserId,
  variant = "monthlyPivots",
}: {
  currentUserId: string | null;
  variant?: ScannerVariant;
}) {
  const [state, setState] = useState<LoadState>({
    status: "loading",
    data: null,
    error: null,
  });
  const [expandedRowKey, setExpandedRowKey] = useState<string | null>(null);
  const [detailsByTicker, setDetailsByTicker] = useState<Record<string, DetailState>>({});
  const [popupAlerts, setPopupAlerts] = useState<RvolPopupAlert[]>([]);
  const [browserAlertsEnabled, setBrowserAlertsEnabled] = useState(false);
  const [alertPreferenceLoaded, setAlertPreferenceLoaded] = useState(false);
  const [alertStatusMessage, setAlertStatusMessage] = useState<string | null>(null);
  const [browserAlertPermission, setBrowserAlertPermission] =
    useState<BrowserAlertPermission>("default");
  const [sort, setSort] = useState<SortState>(null);
  const [scannerMode, setScannerMode] = useState<ScannerMode>("intraday");
  const [signalFilter, setSignalFilter] = useState<SignalResolutionFilter>("all");
  const [scannerLayout, setScannerLayout] = useState<ScannerLayout>("workbench");
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null);
  const seenAlertKeysRef = useRef<Set<string>>(new Set());
  const scannerDateRef = useRef<string | null>(null);
  const scannerResolutionRef = useRef<SignalResolutionFilter | null>(null);
  const scannerModeRef = useRef<ScannerMode | null>(null);
  const browserAlertsEnabledRef = useRef(false);

  useEffect(() => {
    browserAlertsEnabledRef.current = browserAlertsEnabled;
  }, [browserAlertsEnabled]);

  useEffect(() => {
    const savedLayout = window.localStorage.getItem(SCANNER_LAYOUT_PREF_KEY);
    if (savedLayout === "workbench" || savedLayout === "table") {
      setScannerLayout(savedLayout);
    }
  }, []);

  useEffect(() => {
    if (!ONE_SIGNAL_APP_ID || !("Notification" in window)) {
      setBrowserAlertPermission("unsupported");
      setAlertPreferenceLoaded(true);
      return;
    }

    setBrowserAlertPermission(window.Notification.permission);

    let cancelled = false;
    fetch("/api/notifications/rvol/preference", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return null;
        return response.json();
      })
      .then((preference) => {
        if (cancelled) return;
        const enabled =
          preference?.browserPushEnabled === true &&
          preference?.oneSignalConfigured === true &&
          window.Notification.permission === "granted";
        setBrowserAlertsEnabled(enabled);
        window.localStorage.setItem(ALERT_PREF_KEY, enabled ? "true" : "false");
      })
      .catch(() => {
        if (cancelled) return;
        const savedPreference = window.localStorage.getItem(ALERT_PREF_KEY) === "true";
        setBrowserAlertsEnabled(savedPreference && window.Notification.permission === "granted");
      })
      .finally(() => {
        if (!cancelled) setAlertPreferenceLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const emitRvolAlerts = useCallback((hits: RvolScannerHit[]) => {
    if (hits.length === 0) return;

    const alerts = hits
      .slice()
      .sort((a, b) => b.signalUnixSeconds - a.signalUnixSeconds)
      .map(formatRvolAlert);
    const alertIds = new Set(alerts.map((alert) => alert.id));

    setPopupAlerts((existing) => [
      ...alerts,
      ...existing.filter((alert) => !alertIds.has(alert.id)),
    ].slice(0, MAX_POPUP_ALERTS));

    window.setTimeout(() => {
      setPopupAlerts((existing) => existing.filter((alert) => !alertIds.has(alert.id)));
    }, ALERT_TOAST_TTL_MS);
  }, []);

  const trackRvolAlerts = useCallback((data: RvolScannerPayload) => {
    const currentKeys = new Set(data.hits.map(rvolAlertKey));

    if (
      scannerDateRef.current !== data.etDate ||
      scannerModeRef.current !== scannerMode ||
      scannerResolutionRef.current !== data.resolution
    ) {
      scannerDateRef.current = data.etDate;
      scannerModeRef.current = scannerMode;
      scannerResolutionRef.current = data.resolution;
      seenAlertKeysRef.current = currentKeys;
      return;
    }

    const freshHits = data.hits.filter((hit) => !seenAlertKeysRef.current.has(rvolAlertKey(hit)));
    for (const key of currentKeys) {
      seenAlertKeysRef.current.add(key);
    }

    if (browserAlertsEnabledRef.current) emitRvolAlerts(freshHits);
  }, [emitRvolAlerts, scannerMode]);

  useEffect(() => {
    let cancelled = false;
    let controller: AbortController | null = null;

    const load = async (showLoading: boolean) => {
      if (controller) {
        if (!showLoading) return;
        controller.abort();
      }
      const current = new AbortController();
      controller = current;
      if (showLoading) {
        setState((existing) => ({ status: "loading", data: existing.data, error: null }));
      }
      try {
        const data = await fetchScanner(scannerMode, signalFilter, current.signal);
        if (!cancelled) {
          trackRvolAlerts(data);
          setState({ status: "ready", data, error: null });
        }
      } catch (error) {
        if (cancelled || current.signal.aborted) return;
        setState((existing) => ({
          status: "error",
          data: existing.data,
          error: error instanceof Error ? error.message : "Unable to load scanner.",
        }));
      } finally {
        if (controller === current) controller = null;
      }
    };

    void load(true);
    const id = window.setInterval(() => void load(false), REFRESH_MS);

    return () => {
      cancelled = true;
      controller?.abort();
      window.clearInterval(id);
    };
  }, [scannerMode, signalFilter, trackRvolAlerts]);

  const data = state.data;
  const rows = data?.hits ?? [];
  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    return [...rows].sort((a, b) => {
      const compared = compareRows(a, b, sort);
      if (compared !== 0) return compared;
      return b.signalUnixSeconds - a.signalUnixSeconds || a.ticker.localeCompare(b.ticker);
    });
  }, [rows, sort]);
  const latestSignal = useMemo(() => {
    if (rows.length === 0) return null;
    return rows.reduce((latest, row) =>
      row.signalUnixSeconds > latest.signalUnixSeconds ? row : latest,
    );
  }, [rows]);
  const selectedRow = useMemo(() => {
    if (sortedRows.length === 0) return null;
    return sortedRows.find((row) => rvolAlertKey(row) === selectedRowKey) ?? sortedRows[0];
  }, [selectedRowKey, sortedRows]);
  const sortColumns = useMemo(() => {
    if (variant === "classic") return SORT_COLUMNS;
    return [
      ...SORT_COLUMNS.slice(0, 5),
      MONTHLY_PIVOT_COLUMN,
      ...SORT_COLUMNS.slice(5),
    ];
  }, [variant]);
  const columnCount = variant === "classic" ? 8 : 9;
  const isScanner2 = variant === "scanner2";
  const hasMonthlyPivots = variant !== "classic";

  useEffect(() => {
    if (sortedRows.length === 0) {
      setSelectedRowKey(null);
      return;
    }

    if (!selectedRowKey || !sortedRows.some((row) => rvolAlertKey(row) === selectedRowKey)) {
      setSelectedRowKey(rvolAlertKey(sortedRows[0]));
    }
  }, [selectedRowKey, sortedRows]);

  useEffect(() => {
    if (scannerLayout !== "workbench" || !selectedRow) return;
    loadSignalDetails(selectedRow.ticker);
  }, [scannerLayout, selectedRow]);

  function loadSignalDetails(ticker: string) {
    if (detailsByTicker[ticker]) return;

    setDetailsByTicker((existing) => ({
      ...existing,
      [ticker]: { status: "loading", data: null, error: null },
    }));

    fetchSignalDetails(ticker)
      .then((data) => {
        setDetailsByTicker((existing) => ({
          ...existing,
          [ticker]: { status: "ready", data, error: null },
        }));
      })
      .catch((error) => {
        setDetailsByTicker((existing) => ({
          ...existing,
          [ticker]: {
            status: "error",
            data: null,
            error: error instanceof Error ? error.message : "Unable to load AskEdgar details.",
          },
        }));
      });
  }

  function toggleExpanded(row: RvolScannerHit) {
    const key = rvolAlertKey(row);
    const opening = expandedRowKey !== key;
    setExpandedRowKey(opening ? key : null);
    if (opening) loadSignalDetails(row.ticker);
  }

  function toggleSort(column: SortColumn) {
    setSort((current) => {
      if (current?.key !== column.key) {
        return { key: column.key, direction: column.defaultDirection };
      }
      return {
        key: column.key,
        direction: current.direction === "asc" ? "desc" : "asc",
      };
    });
  }

  function selectScannerMode(mode: ScannerMode) {
    if (mode === scannerMode) return;
    setScannerMode(mode);
    setSignalFilter("all");
    setExpandedRowKey(null);
    setSelectedRowKey(null);
  }

  function selectScannerLayout(layout: ScannerLayout) {
    setScannerLayout(layout);
    window.localStorage.setItem(SCANNER_LAYOUT_PREF_KEY, layout);
  }

  async function toggleBrowserAlerts() {
    setAlertStatusMessage(null);

    if (!currentUserId) {
      setAlertStatusMessage("Sign in to enable momentum alerts.");
      return;
    }

    if (!ONE_SIGNAL_APP_ID || !("Notification" in window)) {
      setBrowserAlertPermission("unsupported");
      setAlertStatusMessage("Browser push is not configured for this environment.");
      return;
    }

    if (browserAlertsEnabled) {
      await withOneSignal(async (OneSignal) => {
        await OneSignal.User.PushSubscription.optOut();
        await OneSignal.logout();
        OneSignal.setConsentGiven(false);
      }).catch(() => undefined);
      await saveBrowserAlertPreference(false);
      setBrowserAlertsEnabled(false);
      window.localStorage.setItem(ALERT_PREF_KEY, "false");
      setAlertStatusMessage("Momentum alerts are off.");
      return;
    }

    try {
      await withOneSignal(async (OneSignal) => {
        OneSignal.setConsentGiven(true);
        if (!OneSignal.Notifications.isPushSupported()) {
          setBrowserAlertPermission("unsupported");
          throw new Error("This browser does not support web push.");
        }

        await OneSignal.login(currentUserId);
        await OneSignal.Notifications.requestPermission();
        await OneSignal.User.PushSubscription.optIn();
        await waitForOneSignalPushSubscription(OneSignal);
        const permission = window.Notification.permission;
        setBrowserAlertPermission(permission);

        if (permission !== "granted" || !OneSignal.Notifications.permission) {
          throw new Error("Notification permission was not granted.");
        }
      });

      await saveBrowserAlertPreference(true);
      setBrowserAlertsEnabled(true);
      window.localStorage.setItem(ALERT_PREF_KEY, "true");
      setAlertStatusMessage("Momentum alerts are on.");
    } catch (error) {
      setBrowserAlertsEnabled(false);
      window.localStorage.setItem(ALERT_PREF_KEY, "false");
      setAlertStatusMessage(error instanceof Error ? error.message : "Unable to enable momentum alerts.");
    }
  }

  async function saveBrowserAlertPreference(enabled: boolean) {
    const response = await fetch("/api/notifications/rvol/preference", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ browserPushEnabled: enabled }),
    });

    if (!response.ok) {
      const json = await response.json().catch(() => null);
      throw new Error(typeof json?.error === "string" ? json.error : "Unable to save alert preference.");
    }
  }

  function renderAskEdgarDetails(ticker: string) {
    const detailState = detailsByTicker[ticker];

    if (detailState?.status === "ready") {
      const detail = detailState.data.fundamentals;
      const news = detailState.data.news;
      const rows = detail ? detailRows(detail) : [];
      const hasData = detail ? hasUsableAskEdgarData(detail) : false;

      if (!hasData && !news && detailState.data.errors.length > 0) {
        return (
          <div className="detail-message" role="status">
            <strong>Details unavailable</strong>
            <span>
              The request did not return usable fundamentals or catalyst data for this ticker.
            </span>
          </div>
        );
      }

      return (
        <>
          {rows.length > 0 && (
            <>
              <div className="detail-topline">
                {rows.slice(0, 4).map(([label, value, tone]) => (
                  <div className={`detail-stat detail-stat--${tone}`} key={label}>
                    <span className="mono">{label}</span>
                    <b>{value}</b>
                  </div>
                ))}
              </div>

              <div className="detail-grid">
                {rows.slice(4).map(([label, value, tone]) => (
                  <div className={`detail-item detail-item--${tone}`} key={label}>
                    <span className="mono">{label}</span>
                    <b>{value}</b>
                  </div>
                ))}
              </div>
            </>
          )}

          {news && (
            <div className="detail-catalyst">
              <span className="mono">Catalyst</span>
              {news.url ? (
                <a href={news.url} target="_blank" rel="noreferrer">
                  {news.title}
                </a>
              ) : (
                <p>{news.title}</p>
              )}
              <em className="mono">
                {news.source ?? "News"} / {formatNewsAge(news.published_utc)}
              </em>
            </div>
          )}

          {detail && detailDrivers(detail).length > 0 && (
            <div className="detail-drivers">
              {detailDrivers(detail).map(([label, description]) => (
                <div className="detail-driver" key={label}>
                  <span className="mono">{label}</span>
                  <p>{description}</p>
                </div>
              ))}
            </div>
          )}

          {detail?.notes && <div className="detail-notes">{detail.notes}</div>}

          {(detail?.errors.length ?? 0) > 0 || detailState.data.errors.length > 0 ? (
            <div className="detail-warning">
              Some detail fields did not return for this ticker.
            </div>
          ) : null}
        </>
      );
    }

    if (detailState?.status === "error") {
      return (
        <div className="detail-message" role="status">
          <strong>Details unavailable</strong>
          <span>{detailState.error}</span>
        </div>
      );
    }

    return (
      <div className="detail-message" role="status">
        <strong>Loading dilution data</strong>
        <span>Market cap, cash, and dilution risk are loading.</span>
      </div>
    );
  }

  function renderMonthlyPivot(row: RvolScannerHit) {
    if (row.monthlyPivotError) {
      return (
        <div className="pivot-cell pivot-cell--error">
          <div className="pivot-answer mono">CHECK FAILED</div>
          <div className="small mono">Retry on refresh</div>
        </div>
      );
    }

    const target = row.monthlyPivotTarget;
    if (!target) {
      return (
        <div className="pivot-cell pivot-cell--empty">
          <div className="pivot-answer mono">NO</div>
          <div className="small mono">None above price</div>
        </div>
      );
    }

    return (
      <div className="pivot-cell pivot-cell--hit">
        <div className="pivot-answer mono">YES</div>
        <div className="big gold">{money(target.price)}</div>
        <div className="small mono">{target.sourceMonthLabel} -&gt; {target.activeMonthLabel}</div>
        {(row.monthlyPivotCount ?? 0) > 1 && (
          <div className="small mono">+{(row.monthlyPivotCount ?? 1) - 1} more</div>
        )}
      </div>
    );
  }

  function renderPivotFeature(row: RvolScannerHit) {
    if (row.monthlyPivotError) {
      return (
        <div className="workbench-card workbench-card--pivot">
          <h3 className="mono">Nearest missed monthly pivot</h3>
          <div className="pivot-answer mono">CHECK FAILED</div>
          <div className="small mono">Retry on refresh</div>
        </div>
      );
    }

    const target = row.monthlyPivotTarget;
    if (!target) {
      return (
        <div className="workbench-card workbench-card--pivot">
          <h3 className="mono">Nearest missed monthly pivot</h3>
          <div className="pivot-answer mono">NO</div>
          <div className="small mono">None above price</div>
        </div>
      );
    }

    return (
      <div className="workbench-card workbench-card--pivot">
        <h3 className="mono">Nearest missed monthly pivot</h3>
        <div className="pivot-answer mono">YES</div>
        <div className="workbench-hero-number gold">{money(target.price)}</div>
        <div className="small mono">{target.sourceMonthLabel} -&gt; {target.activeMonthLabel}</div>
        {(row.monthlyPivotCount ?? 0) > 1 && (
          <div className="small mono">+{(row.monthlyPivotCount ?? 1) - 1} more pivots above price</div>
        )}
      </div>
    );
  }

  function renderPremarketHighCard(row: RvolScannerHit) {
    const distance = premarketHighDistance(row);

    return (
      <div className="workbench-card">
        <h3 className="mono">Premarket high distance</h3>
        {distance ? (
          <>
            <div className="workbench-hero-number">{money(distance.high)}</div>
            <div className="small mono">Premarket high</div>
            <div className="distance-row">
              <div className="distance-chip">
                <span className="mono">{distance.relation === "below" ? "Below high" : "Above high"}</span>
                <b className="gold">{distanceMoney(distance.amount)}</b>
              </div>
              <div className="distance-chip">
                <span className="mono">Distance</span>
                <b className="gold">{unsignedPct(distance.percent)}</b>
              </div>
            </div>
          </>
        ) : (
          <div className="detail-message detail-message--compact" role="status">
            <strong>No PM high level</strong>
            <span>This signal is not using a premarket-high breakout level.</span>
          </div>
        )}
      </div>
    );
  }

  function renderCatalystCard(detailState: DetailState | undefined) {
    if (detailState?.status === "ready" && detailState.data.news) {
      const news = detailState.data.news;
      return (
        <div className="workbench-card">
          <h3 className="mono">Catalyst</h3>
          {news.url ? (
            <a className="workbench-catalyst-link" href={news.url} target="_blank" rel="noreferrer">
              {news.title}
            </a>
          ) : (
            <p className="workbench-copy">{news.title}</p>
          )}
          <div className="small mono">{news.source ?? "News"} / {formatNewsAge(news.published_utc)}</div>
        </div>
      );
    }

    if (detailState?.status === "loading") {
      return (
        <div className="workbench-card">
          <h3 className="mono">Catalyst</h3>
          <div className="detail-message detail-message--compact" role="status">
            <strong>Loading catalyst</strong>
            <span>Checking latest source-backed headline.</span>
          </div>
        </div>
      );
    }

    return (
      <div className="workbench-card">
        <h3 className="mono">Catalyst</h3>
        <div className="detail-message detail-message--compact" role="status">
          <strong>No fresh headline</strong>
          <span>No source-backed catalyst returned for this ticker.</span>
        </div>
      </div>
    );
  }

  function renderFundamentalsGrid(detailState: DetailState | undefined) {
    const detail = detailState?.status === "ready" ? detailState.data.fundamentals : null;
    const rows: Array<[string, string, DetailTone, string]> = detail
      ? [
          ["Float", compactNullable(detail.floatOutstanding), "neutral", "Public float / outstanding snapshot."],
          ["Market cap", compactMoney(detail.marketCap), "neutral", "AskEdgar float/outstanding source."],
          ["Cash on hand", compactMoney(detail.estimatedCash), "neutral", "Latest dilution-rating cash estimate."],
          [
            "Runway",
            detail.cashRemainingMonths === null || !Number.isFinite(detail.cashRemainingMonths)
              ? UNAVAILABLE
              : `${detail.cashRemainingMonths.toFixed(1)} mo`,
            runwayTone(detail.cashRemainingMonths),
            "Months of cash remaining.",
          ],
          ["Offering risk", rating(detail.overallOfferingRisk), riskTone(detail.overallOfferingRisk), "Overall dilution or offering risk."],
          ["Reg SHO", detail.regsho === null ? UNAVAILABLE : detail.regsho ? "YES" : "NO", riskTone(detail.regsho === null ? null : detail.regsho ? "high" : "low"), "Short-sale restriction signal."],
        ]
      : [];

    if (rows.length === 0) {
      return (
        <div className="fundamentals-grid">
          <div className="detail-message detail-message--compact" role="status">
            <strong>{detailState?.status === "loading" ? "Loading fundamentals" : "Fundamentals unavailable"}</strong>
            <span>Float, cash on hand, and offering-risk data will appear here when returned.</span>
          </div>
        </div>
      );
    }

    return (
      <div className="fundamentals-grid">
        {rows.map(([label, value, tone, description]) => (
          <div className={`fundamental-card detail-item--${tone}`} key={label}>
            <span className="mono">{label}</span>
            <b>{value}</b>
            <p>{description}</p>
          </div>
        ))}
      </div>
    );
  }

  function renderWorkbench() {
    if (sortedRows.length === 0 || !selectedRow) {
      return (
        <section className="workbench-panel">
          <div className="empty">
            {state.status === "loading"
              ? "Scanning..."
              : scannerMode === "longTerm"
                ? "No long-term momentum entries in the filtered mover list yet."
                : "No momentum entries in the filtered mover list yet."}
          </div>
        </section>
      );
    }

    const detailState = detailsByTicker[selectedRow.ticker];

    return (
      <section className="workbench-panel">
        <aside className="workbench-rail" aria-label="Live signal list">
          <div className="workbench-rail-title mono">Live Tape</div>
          <div className="workbench-rail-list">
            {sortedRows.map((row) => {
              const rowKey = rvolAlertKey(row);
              const isSelected = rowKey === rvolAlertKey(selectedRow);
              return (
                <button
                  type="button"
                  className={`workbench-rail-row${isSelected ? " is-active" : ""}`}
                  key={rowKey}
                  onClick={() => {
                    setSelectedRowKey(rowKey);
                    loadSignalDetails(row.ticker);
                  }}
                >
                  <span>
                    <b>{row.ticker}</b>
                    <em className="mono">{row.signalTimeEt} / {row.signalRvol.toFixed(1)}x</em>
                  </span>
                  <strong>{pct(row.changePct)}</strong>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="workbench-detail" aria-label={`${selectedRow.ticker} selected signal details`}>
          <div className="workbench-detail-head">
            <span className="mono">Selected Signal</span>
            <span className="mono">{scannerUniverseLabel(data!, scannerMode)}</span>
          </div>
          <div className="workbench-detail-body">
            <div className="workbench-main">
              <div className="workbench-symbol">
                <strong>{selectedRow.ticker}</strong>
                <em>{selectedRow.name ?? "Common stock"}</em>
              </div>
              <div className="metric-strip metric-strip--workbench">
                <div className="metric"><span className="mono">Signal</span><b>{selectedRow.resolution}</b></div>
                <div className="metric"><span className="mono">Signal ET</span><b>{selectedRow.signalTimeEt}</b><small className="mono">{selectedRow.barsScanned} bars</small></div>
                <div className="metric"><span className="mono">Price now</span><b>{money(selectedRow.priceNow)}</b></div>
                <div className="metric"><span className="mono">RVOL</span><b>{selectedRow.signalRvol.toFixed(1)}x</b></div>
              </div>
              {renderFundamentalsGrid(detailState)}
            </div>
            <aside className="workbench-side">
              {renderPivotFeature(selectedRow)}
              {renderPremarketHighCard(selectedRow)}
              {renderCatalystCard(detailState)}
            </aside>
          </div>
        </section>
      </section>
    );
  }

  return (
    <main className="scanner">
      <style>{`
        .scanner{
          --ink:#15120B;
          --paper:#F6F2E9;
          --card:#FFFCF4;
          --line:rgba(21,18,11,0.18);
          --muted:rgba(21,18,11,0.62);
          --amber:#F5A524;
          --gold:#B8860B;
          min-height:calc(100vh - 104px);
          background:var(--paper);
          color:var(--ink);
          font-family:Helvetica,Arial,sans-serif;
          padding:34px 28px 72px;
        }
        .scanner *{box-sizing:border-box}
        .scanner .wrap{max-width:1480px;margin:0 auto}
        .scanner .mono{font-family:'Courier New',Courier,monospace;letter-spacing:1.5px;text-transform:uppercase;font-weight:700}
        .scanner .crumb{font-size:11px;color:var(--gold)}
        .scanner .summary-line{
          min-width:0;
          color:var(--muted);
          font-size:11px;
          text-align:right;
        }
        .scanner .scanner-top{
          display:flex;
          justify-content:space-between;
          gap:16px;
          align-items:center;
          border-bottom:2px solid var(--amber);
          padding-bottom:12px;
        }
        .scanner .meta{
          display:grid;
          grid-template-columns:repeat(3,minmax(120px,1fr));
          border:1px solid var(--line);
          background:var(--card);
          min-width:430px;
        }
        .scanner .meta div{padding:14px 16px;border-left:1px solid var(--line)}
        .scanner .meta div:first-child{border-left:0}
        .scanner .meta span{display:block;font-size:10px;color:var(--gold);margin-bottom:6px}
        .scanner .meta b{font-size:24px;letter-spacing:0}
        .scanner .status{
          margin-top:22px;
          display:flex;
          justify-content:space-between;
          gap:16px;
          align-items:center;
          color:var(--muted);
          font-size:11px;
        }
        .scanner .status-left{
          display:flex;
          align-items:center;
          gap:14px;
          flex-wrap:wrap;
          min-width:0;
        }
        .scanner .status strong{color:var(--ink)}
        .scanner .status .error{color:#C8283D}
        .scanner .scanner-controls{
          display:inline-flex;
          align-items:center;
          gap:10px;
          flex:0 0 auto;
          flex-wrap:nowrap;
        }
        .scanner .signal-filter{
          display:inline-flex;
          align-items:center;
          gap:6px;
          flex:0 0 auto;
          flex-wrap:nowrap;
          color:var(--gold);
        }
        .scanner .scanner-mode-tabs{
          display:inline-flex;
          flex:0 0 auto;
          border:1px solid rgba(21,18,11,0.2);
          background:rgba(255,252,244,0.72);
        }
        .scanner .scanner-layout-tabs{
          display:inline-flex;
          flex:0 0 auto;
          border:1px solid rgba(21,18,11,0.2);
          background:rgba(255,252,244,0.72);
        }
        .scanner .scanner-mode-tabs button{
          min-width:94px;
          min-height:32px;
          border:0;
          border-left:1px solid rgba(21,18,11,0.14);
          background:transparent;
          color:var(--muted);
          cursor:pointer;
          font:inherit;
          letter-spacing:inherit;
          text-transform:inherit;
        }
        .scanner .scanner-layout-tabs button{
          min-width:126px;
          min-height:32px;
          border:0;
          border-left:1px solid rgba(21,18,11,0.14);
          background:transparent;
          color:var(--muted);
          cursor:pointer;
          font:inherit;
          letter-spacing:inherit;
          text-transform:inherit;
        }
        .scanner .scanner-mode-tabs button:first-child{border-left:0}
        .scanner .scanner-layout-tabs button:first-child{border-left:0}
        .scanner .scanner-mode-tabs button:hover,
        .scanner .scanner-mode-tabs button:focus-visible,
        .scanner .scanner-layout-tabs button:hover,
        .scanner .scanner-layout-tabs button:focus-visible{
          color:var(--ink);
          outline:none;
        }
        .scanner .scanner-mode-tabs button.is-active,
        .scanner .scanner-layout-tabs button.is-active{
          background:var(--ink);
          color:var(--card);
        }
        .scanner .signal-filter-label{
          font-size:10px;
        }
        .scanner .signal-filter-options{
          display:inline-flex;
          flex:0 0 auto;
          border:1px solid rgba(21,18,11,0.18);
          background:rgba(255,252,244,0.72);
        }
        .scanner .signal-filter-options button{
          min-width:54px;
          min-height:30px;
          border:0;
          border-left:1px solid rgba(21,18,11,0.14);
          background:transparent;
          color:var(--muted);
          cursor:pointer;
          font:inherit;
          letter-spacing:inherit;
          text-transform:inherit;
        }
        .scanner .signal-filter-options button:first-child{border-left:0}
        .scanner .signal-filter-options button:hover,
        .scanner .signal-filter-options button:focus-visible{
          color:var(--ink);
          outline:none;
        }
        .scanner .signal-filter-options button.is-active{
          background:var(--ink);
          color:var(--card);
        }
        .scanner .scanner-links{
          display:inline-flex;
          align-items:center;
          gap:8px;
          flex:0 0 auto;
          flex-wrap:nowrap;
        }
        .scanner .history-link{
          display:inline-flex;
          align-items:center;
          flex:0 0 auto;
          min-height:30px;
          padding:0 10px;
          border:1px solid rgba(21,18,11,0.22);
          background:rgba(255,252,244,0.72);
          color:var(--ink);
          text-decoration:none;
          white-space:nowrap;
        }
        .scanner .history-link:hover,
        .scanner .history-link:focus-visible{
          border-color:var(--gold);
          color:var(--gold);
          outline:none;
        }
        .scanner .alert-actions{
          display:flex;
          gap:10px;
          align-items:center;
          justify-content:flex-end;
          flex-wrap:wrap;
        }
        .scanner .alert-toggle{
          border:1px solid rgba(21,18,11,0.2);
          background:var(--card);
          color:var(--ink);
          min-height:32px;
          padding:0 11px;
          display:inline-flex;
          align-items:center;
          gap:8px;
          cursor:pointer;
          font:inherit;
        }
        .scanner .alert-toggle:hover,
        .scanner .alert-toggle:focus-visible{
          border-color:var(--amber);
          outline:none;
        }
        .scanner .alert-toggle.is-on{
          border-color:rgba(13,79,60,0.35);
          background:rgba(13,79,60,0.08);
          color:#0D4F3C;
        }
        .scanner .alert-toggle.is-denied{
          border-color:rgba(200,40,61,0.28);
          color:#A52A2A;
        }
        .scanner .alert-toggle-dot{
          width:8px;
          height:8px;
          border-radius:999px;
          background:rgba(21,18,11,0.3);
          flex:0 0 auto;
        }
        .scanner .alert-toggle.is-on .alert-toggle-dot{background:#0D4F3C}
        .scanner .alert-toggle.is-denied .alert-toggle-dot{background:#A52A2A}
        .scanner .alert-status{
          color:var(--muted);
          font-size:10px;
        }
        .scanner .rvol-alert-stack{
          position:fixed;
          top:118px;
          right:18px;
          z-index:60;
          display:grid;
          gap:10px;
          width:min(380px,calc(100vw - 32px));
          pointer-events:none;
        }
        .scanner .rvol-alert{
          position:relative;
          pointer-events:auto;
          padding:16px 44px 16px 16px;
          border:1px solid rgba(21,18,11,0.2);
          border-left:5px solid var(--amber);
          background:var(--card);
          box-shadow:0 18px 42px rgba(21,18,11,0.18);
        }
        .scanner .rvol-alert span{
          display:block;
          margin-bottom:6px;
          color:var(--gold);
          font-size:10px;
        }
        .scanner .rvol-alert strong{
          display:block;
          font-size:24px;
          line-height:1;
          letter-spacing:0;
        }
        .scanner .rvol-alert p{
          margin:9px 0 0;
          color:var(--muted);
          font-size:13px;
          line-height:1.35;
        }
        .scanner .rvol-alert button{
          position:absolute;
          top:9px;
          right:9px;
          width:28px;
          height:28px;
          border:1px solid rgba(21,18,11,0.16);
          background:transparent;
          color:var(--muted);
          cursor:pointer;
          font-size:18px;
          line-height:1;
        }
        .scanner .rvol-alert button:hover,
        .scanner .rvol-alert button:focus-visible{
          color:var(--ink);
          border-color:var(--amber);
          outline:none;
        }
        .scanner .panel{
          margin-top:18px;
          background:var(--card);
          border:1px solid var(--line);
          overflow:hidden;
        }
        .scanner table{
          width:100%;
          border-collapse:collapse;
          table-layout:fixed;
        }
        .scanner th{
          text-align:left;
          padding:12px 16px;
          border-bottom:1px solid var(--line);
          color:var(--gold);
          font-size:10px;
        }
        .scanner th[aria-sort="ascending"],
        .scanner th[aria-sort="descending"]{
          color:var(--ink);
        }
        .scanner .sort-button{
          width:100%;
          border:0;
          background:transparent;
          padding:0;
          color:inherit;
          cursor:pointer;
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:8px;
          font:inherit;
          text-align:left;
          text-transform:inherit;
          letter-spacing:inherit;
        }
        .scanner .sort-button:hover,
        .scanner .sort-button:focus-visible{
          color:var(--ink);
          outline:none;
        }
        .scanner .sort-indicator{
          display:inline-grid;
          place-items:center;
          width:14px;
          height:14px;
          color:rgba(21,18,11,0.38);
          font-size:10px;
          line-height:1;
          flex:0 0 auto;
        }
        .scanner th[aria-sort="ascending"] .sort-indicator,
        .scanner th[aria-sort="descending"] .sort-indicator{
          color:var(--gold);
        }
        .scanner td{
          padding:17px 16px;
          border-top:1px solid rgba(21,18,11,0.11);
          vertical-align:middle;
        }
        .scanner .scan-row{
          cursor:pointer;
        }
        .scanner .scan-row:hover td,
        .scanner .scan-row.is-open td{
          background:rgba(245,165,36,0.09);
        }
        .scanner tbody tr:first-child td{border-top:0}
        .scanner .ticker{
          display:flex;
          flex-direction:column;
          gap:5px;
          min-width:0;
        }
        .scanner .ticker button{
          width:max-content;
          max-width:100%;
          border:0;
          background:transparent;
          padding:0;
          color:var(--ink);
          cursor:pointer;
          text-align:left;
          font-weight:900;
          font-size:30px;
          line-height:1;
          letter-spacing:0;
          border-bottom:2px solid transparent;
        }
        .scanner .ticker button:hover,
        .scanner .ticker button:focus-visible{border-color:var(--amber);outline:none}
        .scanner .ticker b{
          display:inline-block;
          color:var(--gold);
          font-family:'Courier New',Courier,monospace;
          font-size:18px;
          transform:translateY(-2px);
          width:20px;
        }
        .scanner .ticker span{
          color:var(--muted);
          font-family:Georgia,'Times New Roman',serif;
          font-style:italic;
          font-size:13px;
          overflow:hidden;
          text-overflow:ellipsis;
          white-space:nowrap;
        }
        .scanner .big{
          font-size:26px;
          line-height:1;
          letter-spacing:0;
          font-weight:900;
        }
        .scanner .signal-badge{
          display:inline-grid;
          place-items:center;
          min-width:48px;
          height:32px;
          padding:0 10px;
          border:1px solid rgba(184,134,11,0.3);
          background:rgba(245,165,36,0.08);
          color:var(--gold);
          font-size:13px;
        }
        .scanner .gold{color:var(--gold)}
        .scanner .small{font-size:11px;color:var(--muted)}
        .scanner .pivot-cell{
          min-height:72px;
          display:grid;
          align-content:center;
          gap:5px;
        }
        .scanner .pivot-answer{
          width:max-content;
          max-width:100%;
          padding:4px 7px;
          border:1px solid rgba(21,18,11,0.16);
          color:var(--muted);
          font-size:9px;
        }
        .scanner .pivot-cell--hit .pivot-answer{
          border-color:rgba(13,79,60,0.26);
          background:rgba(13,79,60,0.06);
          color:#0D4F3C;
        }
        .scanner .pivot-cell--error .pivot-answer{
          border-color:rgba(200,40,61,0.26);
          background:rgba(200,40,61,0.055);
          color:#A52A2A;
        }
        .scanner .detail-cell{
          padding:0;
          background:#FBF8F0;
        }
        .scanner .detail-box{
          display:grid;
          grid-template-columns:minmax(0,2fr) minmax(280px,1fr);
          gap:0;
          align-items:start;
          border-top:1px solid rgba(21,18,11,0.18);
        }
        .scanner .detail-chart{
          min-width:0;
          border-right:1px solid rgba(21,18,11,0.16);
        }
        .scanner .detail-chart .cc2-embedded-chart{
          border-top:0;
          background:transparent;
        }
        .scanner .detail-research{
          height:470px;
          max-height:470px;
          min-height:0;
          overflow:auto;
          padding:20px 20px 18px;
          display:flex;
          flex-direction:column;
          gap:14px;
        }
        .scanner .detail-topline{
          display:grid;
          grid-template-columns:repeat(2,minmax(0,1fr));
          gap:10px;
        }
        .scanner .detail-stat{
          min-height:96px;
          padding:14px;
          border:1px solid rgba(21,18,11,0.14);
          background:rgba(255,252,244,0.72);
        }
        .scanner .detail-stat span,
        .scanner .detail-item span,
        .scanner .detail-driver span{
          color:var(--gold);
          font-size:9px;
        }
        .scanner .detail-stat b{
          display:block;
          margin-top:12px;
          font-size:30px;
          line-height:0.95;
          letter-spacing:0;
        }
        .scanner .detail-stat--risk,
        .scanner .detail-item--risk{
          border-color:rgba(200,40,61,0.28);
          background:rgba(200,40,61,0.055);
        }
        .scanner .detail-stat--risk b,
        .scanner .detail-item--risk b{
          color:#A52A2A;
        }
        .scanner .detail-stat--watch,
        .scanner .detail-item--watch{
          border-color:rgba(184,134,11,0.28);
          background:rgba(245,165,36,0.075);
        }
        .scanner .detail-stat--watch b,
        .scanner .detail-item--watch b{
          color:var(--gold);
        }
        .scanner .detail-stat--good,
        .scanner .detail-item--good{
          border-color:rgba(13,79,60,0.22);
          background:rgba(13,79,60,0.055);
        }
        .scanner .detail-stat--good b,
        .scanner .detail-item--good b{
          color:#0D4F3C;
        }
        .scanner .detail-grid{
          display:grid;
          grid-template-columns:repeat(2,minmax(0,1fr));
          gap:8px;
        }
        .scanner .detail-item{
          display:grid;
          grid-template-columns:1fr;
          gap:4px;
          padding:10px 12px;
          border:1px solid rgba(21,18,11,0.12);
          background:rgba(255,252,244,0.48);
        }
        .scanner .detail-item b{
          font-size:18px;
          line-height:1.12;
          letter-spacing:0;
        }
        .scanner .detail-drivers{
          display:grid;
          gap:10px;
          margin-top:2px;
          padding-top:12px;
          border-top:1px solid rgba(21,18,11,0.16);
        }
        .scanner .detail-driver{
          display:grid;
          gap:4px;
        }
        .scanner .detail-driver p{
          margin:0;
          color:var(--muted);
          font-family:Georgia,'Times New Roman',serif;
          font-style:italic;
          font-size:13px;
          line-height:1.34;
        }
        .scanner .detail-catalyst{
          display:grid;
          gap:8px;
          padding:14px;
          border:1px solid rgba(21,18,11,0.14);
          background:rgba(255,252,244,0.72);
        }
        .scanner .detail-catalyst span{
          color:var(--gold);
          font-size:9px;
        }
        .scanner .detail-catalyst a,
        .scanner .detail-catalyst p{
          margin:0;
          color:var(--ink);
          font-family:Georgia,'Times New Roman',serif;
          font-size:14px;
          line-height:1.38;
        }
        .scanner .detail-catalyst a:hover,
        .scanner .detail-catalyst a:focus-visible{
          color:var(--gold);
          outline:none;
        }
        .scanner .detail-catalyst em{
          color:var(--muted);
          font-size:10px;
          font-style:normal;
        }
        .scanner .detail-notes{
          color:var(--muted);
          font-family:Georgia,'Times New Roman',serif;
          font-size:14px;
          line-height:1.45;
          font-style:italic;
        }
        .scanner .detail-message{
          flex:1;
          display:grid;
          align-content:center;
          place-items:center;
          gap:8px;
          min-height:220px;
          text-align:center;
          border:1px dashed rgba(21,18,11,0.18);
          color:var(--muted);
          padding:22px;
          font-size:13px;
        }
        .scanner .detail-message strong{
          color:var(--ink);
          font-size:18px;
          line-height:1;
          letter-spacing:0;
        }
        .scanner .detail-message span{
          max-width:320px;
          font-family:Georgia,'Times New Roman',serif;
          font-style:italic;
          line-height:1.42;
        }
        .scanner .detail-message--compact{
          min-height:108px;
          padding:16px;
          place-items:start;
          align-content:center;
          text-align:left;
        }
        .scanner .detail-message--compact strong{
          font-size:16px;
        }
        .scanner .detail-warning{
          color:#9A5C00;
          font-size:11px;
          line-height:1.35;
        }
        .scanner .workbench-panel{
          margin-top:18px;
          display:grid;
          grid-template-columns:minmax(220px,300px) minmax(0,1fr);
          min-height:590px;
          background:var(--card);
          border:1px solid var(--line);
        }
        .scanner .workbench-rail{
          min-width:0;
          border-right:1px solid rgba(21,18,11,0.16);
          background:rgba(21,18,11,0.035);
        }
        .scanner .workbench-rail-title,
        .scanner .workbench-detail-head{
          min-height:42px;
          padding:12px 16px;
          border-bottom:1px solid rgba(21,18,11,0.16);
          color:var(--gold);
          font-size:10px;
        }
        .scanner .workbench-rail-list{
          display:grid;
        }
        .scanner .workbench-rail-row{
          display:grid;
          grid-template-columns:minmax(0,1fr) auto;
          gap:12px;
          width:100%;
          border:0;
          border-bottom:1px solid rgba(21,18,11,0.12);
          background:transparent;
          color:var(--ink);
          cursor:pointer;
          padding:14px 16px;
          text-align:left;
          font:inherit;
        }
        .scanner .workbench-rail-row:hover,
        .scanner .workbench-rail-row:focus-visible,
        .scanner .workbench-rail-row.is-active{
          background:rgba(245,165,36,0.09);
          outline:none;
        }
        .scanner .workbench-rail-row.is-active{
          box-shadow:inset 3px 0 0 var(--amber);
        }
        .scanner .workbench-rail-row b{
          display:block;
          font-size:20px;
          line-height:1;
          letter-spacing:0;
        }
        .scanner .workbench-rail-row em{
          display:block;
          margin-top:7px;
          color:var(--muted);
          font-size:10px;
          font-style:normal;
        }
        .scanner .workbench-rail-row strong{
          color:var(--gold);
          font-size:11px;
          line-height:1;
        }
        .scanner .workbench-detail{
          min-width:0;
        }
        .scanner .workbench-detail-head{
          display:flex;
          justify-content:space-between;
          gap:16px;
          align-items:center;
        }
        .scanner .workbench-detail-body{
          display:grid;
          grid-template-columns:minmax(0,1.1fr) minmax(300px,0.72fr);
          gap:20px;
          padding:20px;
        }
        .scanner .workbench-main,
        .scanner .workbench-side{
          min-width:0;
          display:grid;
          align-content:start;
          gap:16px;
        }
        .scanner .workbench-symbol strong{
          display:block;
          font-size:clamp(48px,7vw,86px);
          line-height:0.92;
          letter-spacing:0;
        }
        .scanner .workbench-symbol em{
          display:block;
          margin-top:8px;
          color:var(--muted);
          font-family:Georgia,'Times New Roman',serif;
          font-size:18px;
          line-height:1.25;
        }
        .scanner .metric-strip{
          display:grid;
          grid-template-columns:repeat(4,minmax(0,1fr));
          border:1px solid rgba(21,18,11,0.14);
        }
        .scanner .metric{
          min-width:0;
          padding:14px;
          border-left:1px solid rgba(21,18,11,0.12);
        }
        .scanner .metric:first-child{border-left:0}
        .scanner .metric span,
        .scanner .fundamental-card span,
        .scanner .distance-chip span,
        .scanner .workbench-card h3{
          color:var(--gold);
          font-size:9px;
        }
        .scanner .metric b{
          display:block;
          margin-top:10px;
          font-size:30px;
          line-height:0.96;
          letter-spacing:0;
        }
        .scanner .metric small{
          display:block;
          margin-top:6px;
          color:var(--muted);
          font-size:10px;
        }
        .scanner .fundamentals-grid{
          display:grid;
          grid-template-columns:repeat(3,minmax(0,1fr));
          border:1px solid rgba(21,18,11,0.14);
          background:rgba(21,18,11,0.025);
        }
        .scanner .fundamental-card{
          min-width:0;
          padding:14px;
          border-left:1px solid rgba(21,18,11,0.12);
        }
        .scanner .fundamental-card:nth-child(3n + 1){border-left:0}
        .scanner .fundamental-card:nth-child(n + 4){border-top:1px solid rgba(21,18,11,0.12)}
        .scanner .fundamental-card b{
          display:block;
          margin-top:10px;
          font-size:28px;
          line-height:0.98;
          letter-spacing:0;
        }
        .scanner .fundamental-card p,
        .scanner .workbench-copy{
          margin:8px 0 0;
          color:var(--muted);
          font-family:Georgia,'Times New Roman',serif;
          font-size:13px;
          line-height:1.34;
        }
        .scanner .workbench-card{
          min-width:0;
          padding:20px;
          border:1px solid rgba(21,18,11,0.14);
          background:rgba(255,252,244,0.72);
        }
        .scanner .workbench-card--pivot{
          border-color:rgba(184,134,11,0.34);
          background:rgba(245,165,36,0.12);
        }
        .scanner .workbench-card h3{
          margin:0 0 16px;
        }
        .scanner .workbench-hero-number{
          margin-top:10px;
          font-size:clamp(42px,6vw,72px);
          line-height:0.95;
          font-weight:900;
          letter-spacing:0;
        }
        .scanner .distance-row{
          display:grid;
          grid-template-columns:repeat(2,minmax(0,1fr));
          gap:10px;
          margin-top:14px;
        }
        .scanner .distance-chip{
          min-width:0;
          padding:12px;
          border:1px solid rgba(21,18,11,0.12);
          background:rgba(21,18,11,0.035);
        }
        .scanner .distance-chip b{
          display:block;
          margin-top:8px;
          font-size:30px;
          line-height:0.95;
          letter-spacing:0;
        }
        .scanner .workbench-catalyst-link{
          display:block;
          color:var(--ink);
          font-family:Georgia,'Times New Roman',serif;
          font-size:15px;
          line-height:1.38;
        }
        .scanner .workbench-catalyst-link:hover,
        .scanner .workbench-catalyst-link:focus-visible{
          color:var(--gold);
          outline:none;
        }
        .scanner .empty{
          min-height:260px;
          display:grid;
          place-items:center;
          text-align:center;
          padding:36px;
          color:var(--muted);
          font-family:Georgia,'Times New Roman',serif;
          font-style:italic;
          font-size:18px;
        }
        @media (max-width:980px){
          .scanner{padding:26px 16px 56px}
          .scanner .scanner-top{grid-template-columns:1fr}
          .scanner .scanner-controls{display:flex;width:100%;flex-wrap:wrap}
          .scanner .scanner-links{flex-wrap:wrap}
          .scanner .meta{min-width:0}
          .scanner .panel{overflow-x:auto}
          .scanner table{min-width:860px}
          .scanner .detail-box{grid-template-columns:1fr}
          .scanner .detail-chart{border-right:0;border-bottom:1px solid rgba(21,18,11,0.16)}
          .scanner .detail-research{height:auto;max-height:none}
          .scanner .workbench-panel{grid-template-columns:1fr}
          .scanner .workbench-rail{border-right:0;border-bottom:1px solid rgba(21,18,11,0.16)}
          .scanner .workbench-rail-list{grid-template-columns:repeat(3,minmax(160px,1fr));overflow-x:auto}
          .scanner .workbench-rail-row{border-right:1px solid rgba(21,18,11,0.12);border-bottom:0}
          .scanner .workbench-detail-body{grid-template-columns:1fr}
        }
        @media (orientation:landscape) and (min-width:760px) and (max-width:980px){
          .scanner .workbench-panel{grid-template-columns:minmax(190px,260px) minmax(0,1fr)}
          .scanner .workbench-rail{border-right:1px solid rgba(21,18,11,0.16);border-bottom:0}
          .scanner .workbench-rail-list{grid-template-columns:1fr;overflow-x:visible}
          .scanner .workbench-rail-row{border-right:0;border-bottom:1px solid rgba(21,18,11,0.12)}
        }
        @media (max-width:640px){
          .scanner .meta{grid-template-columns:1fr}
          .scanner .meta div{border-left:0;border-top:1px solid var(--line)}
          .scanner .meta div:first-child{border-top:0}
          .scanner .status{align-items:flex-start;flex-direction:column}
          .scanner .scanner-controls{
            display:flex;
            flex-direction:column;
            align-items:stretch;
            justify-content:flex-start;
            width:100%;
          }
          .scanner .signal-filter{width:100%;display:flex;flex-wrap:wrap}
          .scanner .signal-filter-label{width:100%}
          .scanner .alert-actions{justify-content:flex-start}
          .scanner .rvol-alert-stack{top:auto;right:16px;bottom:16px}
          .scanner .scanner-layout-tabs,
          .scanner .scanner-mode-tabs,
          .scanner .signal-filter-options{width:100%}
          .scanner .scanner-layout-tabs button,
          .scanner .scanner-mode-tabs button,
          .scanner .signal-filter-options button{min-width:0;flex:1 1 auto}
          .scanner .metric-strip,
          .scanner .fundamentals-grid,
          .scanner .distance-row{grid-template-columns:1fr}
          .scanner .metric,
          .scanner .fundamental-card,
          .scanner .fundamental-card:nth-child(3n + 1){border-left:0}
          .scanner .metric:nth-child(n + 2),
          .scanner .fundamental-card:nth-child(n + 2){border-top:1px solid rgba(21,18,11,0.12)}
          .scanner .workbench-detail-head{align-items:flex-start;flex-direction:column}
          .scanner .workbench-rail-list{grid-template-columns:1fr;overflow-x:visible}
          .scanner .workbench-rail-row{border-right:0;border-bottom:1px solid rgba(21,18,11,0.12)}
        }
      `}</style>

      <div className="rvol-alert-stack" aria-live="assertive" aria-atomic="false">
        {popupAlerts.map((alert) => (
          <article className="rvol-alert" key={alert.id} role="status">
            <button
              type="button"
              aria-label={`Dismiss ${alert.ticker} momentum alert`}
              onClick={() =>
                setPopupAlerts((existing) => existing.filter((item) => item.id !== alert.id))
              }
            >
              x
            </button>
            <span className="mono">Momentum Print</span>
            <strong>{alert.ticker} / {alert.rvol}</strong>
            <p>{alert.body}</p>
          </article>
        ))}
      </div>

      <div className="wrap">
        <div className="crumb mono">
          COMMAND CENTER / {isScanner2 ? "MOMENTUM SCANNER 2" : "MOMENTUM SCANNER"}
        </div>
        <section className="scanner-top">
          <div className="crumb mono">
            {scannerMode === "longTerm" ? "LONG-TERM SIGNALS" : "INTRADAY SIGNALS"}
          </div>
          <div className="summary-line mono">
            {rows.length} SIGNALS / {data?.scanned ?? "..."} SCANNED / LATEST {latestSignal?.signalTimeEt ?? "--:--"}
          </div>
        </section>

        <div className="status mono">
          <div className="status-left">
            <span>
              {state.status === "loading"
                ? "LOADING"
                : data
                  ? `${data.etDate} ET / UPDATED ${formatFetchedAt(data.fetchedAt)} ET / ${scannerUniverseLabel(data, scannerMode)}`
                  : "WAITING"}
            </span>
            <div className="scanner-controls">
              <div className="scanner-mode-tabs" aria-label="Scanner mode">
                {SCANNER_MODES.map((mode) => (
                  <button
                    key={mode.value}
                    type="button"
                    className={scannerMode === mode.value ? "is-active" : ""}
                    aria-pressed={scannerMode === mode.value}
                    onClick={() => selectScannerMode(mode.value)}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
              <div className="signal-filter" aria-label="Signal resolution">
                <span className="signal-filter-label">Signal</span>
                <div className="signal-filter-options">
                  {SIGNAL_FILTERS[scannerMode].map((filter) => (
                    <button
                      key={filter.value}
                      type="button"
                      className={signalFilter === filter.value ? "is-active" : ""}
                      aria-pressed={signalFilter === filter.value}
                      onClick={() => setSignalFilter(filter.value)}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="scanner-layout-tabs" aria-label="Scanner layout">
                {SCANNER_LAYOUTS.map((layout) => (
                  <button
                    key={layout.value}
                    type="button"
                    className={scannerLayout === layout.value ? "is-active" : ""}
                    aria-pressed={scannerLayout === layout.value}
                    onClick={() => selectScannerLayout(layout.value)}
                  >
                    {layout.label}
                  </button>
                ))}
              </div>
              <nav className="scanner-links" aria-label="Scanner links">
                {!isScanner2 && <a className="history-link" href="/scanner2">Scanner 2</a>}
                {isScanner2 && <a className="history-link" href="/scanner">Live Scanner</a>}
                <a className="history-link" href="/scanner/history">History</a>
              </nav>
            </div>
          </div>
          <div className="alert-actions">
            {state.status === "error" ? <span className="error">{state.error}</span> : <strong>60S POLYGON REFRESH</strong>}
            <button
              type="button"
              className={`alert-toggle${browserAlertsEnabled ? " is-on" : ""}${
                browserAlertPermission === "denied" || browserAlertPermission === "unsupported"
                  ? " is-denied"
                  : ""
              }`}
              onClick={toggleBrowserAlerts}
              disabled={!alertPreferenceLoaded || browserAlertPermission === "unsupported"}
              title={
                browserAlertPermission === "denied"
                  ? "Browser notifications are blocked for this site."
                  : browserAlertPermission === "unsupported"
                    ? "Browser notifications are not supported here."
                    : "Toggle browser notifications for new momentum prints."
              }
            >
              <span className="alert-toggle-dot" aria-hidden="true" />
              {browserAlertsEnabled ? "Momentum Alerts On" : "Enable Momentum Alerts"}
            </button>
            {alertStatusMessage && <span className="alert-status">{alertStatusMessage}</span>}
          </div>
        </div>

        {scannerLayout === "workbench" ? renderWorkbench() : (
        <section className="panel">
          {rows.length > 0 ? (
            <table>
              <thead>
                <tr className="mono">
                  {sortColumns.map((column) => {
                    const isActive = sort?.key === column.key;
                    const sortLabel = isActive
                      ? sort.direction === "asc" ? "ascending" : "descending"
                      : "none";
                    return (
                      <th
                        key={column.key}
                        aria-sort={sortLabel}
                        style={column.width ? { width: column.width } : undefined}
                      >
                        <button
                          type="button"
                          className="sort-button"
                          onClick={() => toggleSort(column)}
                        >
                          <span>{column.label}</span>
                          <span className="sort-indicator" aria-hidden="true">
                            {isActive ? sort.direction === "asc" ? "▲" : "▼" : "↕"}
                          </span>
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row, index) => {
                  const rowKey = rvolAlertKey(row);
                  const isExpanded = expandedRowKey === rowKey;
                  return (
                    <Fragment key={rowKey}>
                      <tr
                        className={`scan-row${isExpanded ? " is-open" : ""}`}
                        onClick={(event) => {
                          if ((event.target as HTMLElement).closest("a,button")) return;
                          toggleExpanded(row);
                        }}
                      >
                        <td>
                          <div className="ticker">
                            <button
                              type="button"
                              aria-expanded={isExpanded}
                              aria-controls={`rvol-detail-${row.resolution}-${row.ticker}`}
                              onClick={() => toggleExpanded(row)}
                            >
                              <b aria-hidden="true">{isExpanded ? "-" : "+"}</b>
                              {row.ticker}
                            </button>
                            <span>{row.name ?? "Common stock"}</span>
                          </div>
                        </td>
                        <td>
                          <span className="signal-badge mono">{row.resolution}</span>
                        </td>
                        <td>
                          <div className="big">{row.signalTimeEt}</div>
                          <div className="small mono">{row.barsScanned} bars</div>
                        </td>
                        <td className="big">{money(row.signalPrice)}</td>
                        <td className="big">{money(row.priceNow)}</td>
                        {hasMonthlyPivots && <td>{renderMonthlyPivot(row)}</td>}
                        <td className="big gold">{pct(row.changePct)}</td>
                        <td>
                          <div className="big">{row.signalRvol.toFixed(1)}x</div>
                        </td>
                        <td>
                          <div className="big">{compact(row.dollarVolume)}</div>
                          <div className="small mono">{compact(row.dayVolume)} sh</div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={columnCount} className="detail-cell">
                            <div id={`rvol-detail-${row.resolution}-${row.ticker}`} className="detail-box">
                              <div className="detail-chart">
                                <Command2EmbeddedStockChart ticker={row.ticker} rankLabel={`RVOL ${row.resolution} ${index + 1}`} initialResolution={row.resolution} />
                              </div>
                              <aside className="detail-research" aria-label={`${row.ticker} AskEdgar details`}>
                                {renderAskEdgarDetails(row.ticker)}
                              </aside>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="empty">
              {state.status === "loading"
                ? "Scanning..."
                : scannerMode === "longTerm"
                  ? "No long-term momentum entries in the filtered mover list yet."
                  : "No momentum entries in the filtered mover list yet."}
            </div>
          )}
        </section>
        )}
      </div>
    </main>
  );
}
