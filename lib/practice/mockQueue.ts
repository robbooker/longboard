import type { PracticeBar, PracticeLevel, PracticeSetup } from "@/lib/practice/types";

type SourceSpec = {
  ticker: string;
  company: string;
  sourceDate: string;
  seed: number;
  signalMinute: number;
  drift: number;
  volatility: number;
  breakoutBias: number;
};

const SOURCES: SourceSpec[] = [
  { ticker: "OBAI", company: "OmniBio Analytics", sourceDate: "2026-06-10", seed: 11, signalMinute: 585, drift: 0.015, volatility: 0.032, breakoutBias: 0.11 },
  { ticker: "CDT", company: "Conduit Pharma", sourceDate: "2026-06-11", seed: 23, signalMinute: 610, drift: -0.003, volatility: 0.041, breakoutBias: 0.08 },
  { ticker: "CRVO", company: "CervoMed", sourceDate: "2026-06-12", seed: 37, signalMinute: 635, drift: 0.011, volatility: 0.028, breakoutBias: 0.15 },
  { ticker: "NIVF", company: "NewGenIvf Group", sourceDate: "2026-06-13", seed: 41, signalMinute: 570, drift: 0.018, volatility: 0.046, breakoutBias: 0.18 },
  { ticker: "HOUR", company: "Hour Loop", sourceDate: "2026-06-14", seed: 53, signalMinute: 650, drift: -0.006, volatility: 0.034, breakoutBias: 0.05 },
  { ticker: "AIMD", company: "Ainos", sourceDate: "2026-06-15", seed: 67, signalMinute: 600, drift: 0.006, volatility: 0.038, breakoutBias: 0.09 },
  { ticker: "WKEY", company: "WISeKey", sourceDate: "2026-06-16", seed: 79, signalMinute: 625, drift: 0.012, volatility: 0.035, breakoutBias: 0.13 },
  { ticker: "SOBR", company: "SOBR Safe", sourceDate: "2026-06-17", seed: 83, signalMinute: 545, drift: 0.002, volatility: 0.043, breakoutBias: 0.07 },
  { ticker: "KAVL", company: "Kaival Brands", sourceDate: "2026-06-18", seed: 97, signalMinute: 595, drift: 0.02, volatility: 0.03, breakoutBias: 0.17 },
  { ticker: "CYN", company: "Cyngn", sourceDate: "2026-06-19", seed: 109, signalMinute: 615, drift: -0.001, volatility: 0.039, breakoutBias: 0.1 },
  { ticker: "BIAF", company: "bioAffinity Technologies", sourceDate: "2026-06-20", seed: 127, signalMinute: 640, drift: 0.014, volatility: 0.036, breakoutBias: 0.12 },
  { ticker: "XLO", company: "Xilio Therapeutics", sourceDate: "2026-06-21", seed: 139, signalMinute: 580, drift: 0.004, volatility: 0.044, breakoutBias: 0.06 },
];

function mulberry32(seed: number) {
  let value = seed;
  return () => {
    value |= 0;
    value = (value + 0x6d2b79f5) | 0;
    let mixed = Math.imul(value ^ (value >>> 15), 1 | value);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function etDateToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function hashDate(date: string) {
  return date.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function timeLabel(minuteOfDay: number) {
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function sessionFor(minuteOfDay: number) {
  if (minuteOfDay < 570) return "premarket" as const;
  if (minuteOfDay < 960) return "regular" as const;
  return "afterhours" as const;
}

function roundPrice(value: number) {
  return Number(value.toFixed(value < 3 ? 3 : 2));
}

function buildBars(spec: SourceSpec, slot: number, queueDate: string) {
  const rand = mulberry32(spec.seed + hashDate(queueDate) + slot * 101);
  const targetOpen = 2.2 + rand() * 10.8;
  const sourceStart = 18 + rand() * 70;
  const priceScale = targetOpen / sourceStart;
  const volumeScale = 0.28 + rand() * 1.8;
  const bars: PracticeBar[] = [];
  let rawClose = sourceStart;
  let cumulativePv = 0;
  let cumulativeVolume = 0;

  for (let index = 0; index < 192; index += 1) {
    const minute = 240 + index * 5;
    const session = sessionFor(minute);
    const distanceToSignal = Math.max(0, index - Math.round((spec.signalMinute - 240) / 5));
    const sessionLift = session === "regular" ? 1.8 : session === "afterhours" ? 0.7 : 1;
    const impulse = distanceToSignal > 0 ? spec.breakoutBias * Math.exp(-distanceToSignal / 34) : 0;
    const chop = (rand() - 0.48) * spec.volatility * sessionLift;
    const drift = spec.drift / 18 + impulse / 12;
    const open = rawClose;
    rawClose = Math.max(0.55, rawClose * (1 + drift + chop));
    const close = rawClose;
    const wick = Math.max(0.002, Math.abs(close - open) * (0.35 + rand()) + rawClose * spec.volatility * rand() * 0.45);
    const high = Math.max(open, close) + wick;
    const low = Math.max(0.2, Math.min(open, close) - wick * (0.5 + rand() * 0.7));
    const signalBoost = Math.abs(minute - spec.signalMinute) <= 20 ? 4.5 : 1;
    const volumeBase = session === "premarket" ? 75_000 : session === "regular" ? 420_000 : 130_000;
    const volume = Math.round(volumeBase * (0.4 + rand() * 1.6) * signalBoost * volumeScale);
    const scaledClose = roundPrice(close * priceScale);
    cumulativePv += scaledClose * volume;
    cumulativeVolume += volume;

    bars.push({
      index,
      minuteOfDay: minute,
      timeLabel: timeLabel(minute),
      session,
      open: roundPrice(open * priceScale),
      high: roundPrice(high * priceScale),
      low: roundPrice(low * priceScale),
      close: scaledClose,
      volume,
      vwap: roundPrice(cumulativePv / Math.max(1, cumulativeVolume)),
    });
  }

  return { bars, priceScale, volumeScale };
}

function aggregate4h(bars: PracticeBar[]) {
  const groups: PracticeBar[] = [];
  for (let i = 0; i < bars.length; i += 48) {
    const slice = bars.slice(i, i + 48);
    const first = slice[0];
    const last = slice[slice.length - 1];
    if (!first || !last) continue;
    groups.push({
      index: groups.length,
      minuteOfDay: first.minuteOfDay,
      timeLabel: `${first.timeLabel}-${last.timeLabel}`,
      session: first.session,
      open: first.open,
      high: Math.max(...slice.map((bar) => bar.high)),
      low: Math.min(...slice.map((bar) => bar.low)),
      close: last.close,
      volume: slice.reduce((sum, bar) => sum + bar.volume, 0),
      vwap: last.vwap,
    });
  }
  return groups;
}

function levelsFor(bars: PracticeBar[], signalIndex: number): PracticeLevel[] {
  const beforeSignal = bars.slice(0, signalIndex + 1);
  const pmBars = bars.filter((bar) => bar.session === "premarket");
  const signal = bars[signalIndex] ?? bars[0];
  const previousHigh = Math.max(...beforeSignal.slice(0, -1).map((bar) => bar.high));
  const premarketHigh = Math.max(...pmBars.map((bar) => bar.high));
  const premarketLow = Math.min(...pmBars.map((bar) => bar.low));
  const pivotOne = signal.close * 1.12;
  const pivotTwo = signal.close * 1.28;
  return [
    { id: "prev-high", label: "Previous high", price: roundPrice(previousHigh), tone: "high" },
    { id: "pm-high", label: "Premarket high", price: roundPrice(premarketHigh), tone: "premarket" },
    { id: "pm-low", label: "Premarket low", price: roundPrice(premarketLow), tone: "premarket" },
    { id: "missed-pivot-1", label: "Missed pivot", price: roundPrice(pivotOne), tone: "pivot" },
    { id: "missed-pivot-2", label: "Upper pivot", price: roundPrice(pivotTwo), tone: "pivot" },
  ];
}

export function getPracticeQueue(queueDate = etDateToday()): PracticeSetup[] {
  const dayOffset = hashDate(queueDate) % SOURCES.length;
  return Array.from({ length: 10 }, (_, index) => {
    const spec = SOURCES[(dayOffset + index) % SOURCES.length];
    const { bars, priceScale, volumeScale } = buildBars(spec, index + 1, queueDate);
    const signalIndex = Math.max(0, Math.min(bars.length - 1, Math.round((spec.signalMinute - 240) / 5)));
    return {
      key: `${queueDate}-${index + 1}-${spec.ticker}`,
      queueDate,
      slot: index + 1,
      anonymizedName: `Practice ${String(index + 1).padStart(2, "0")}`,
      sourceTicker: spec.ticker,
      sourceCompany: spec.company,
      sourceDate: spec.sourceDate,
      sourceSignalTime: timeLabel(spec.signalMinute),
      sourceSignalPrice: roundPrice((bars[signalIndex]?.close ?? 0) / priceScale),
      priceScale,
      volumeScale,
      bars5m: bars,
      bars4h: aggregate4h(bars),
      signalIndex,
      levels: levelsFor(bars, signalIndex),
    };
  });
}
