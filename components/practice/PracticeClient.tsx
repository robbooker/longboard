"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  PracticeAttemptSummary,
  PracticeBar,
  PracticeExecution,
  PracticeMetrics,
  PracticeSetup,
} from "@/lib/practice/types";

type Phase = "lobby" | "briefing" | "replay" | "review";
type ChartMode = "5m" | "4h";
type OrderType = "market" | "limit";
type OrderSide = "buy" | "sell";
type PracticeTheme = "dark" | "light";
type TipKey = "buy" | "limit" | "chart" | "margin" | "book";

type PendingOrder = {
  id: string;
  side: "buy" | "sell";
  shares: number;
  limitPrice: number;
  createdAtIndex: number;
};

type Position = {
  shares: number;
  avgCost: number;
  realizedPnl: number;
};

const STARTING_BAR_INDEX = 0;
const INITIAL_BALANCE = "25000";
const PDT_MULTIPLIER = 4;
const MAINTENANCE_RATE = 0.25;

const TIPS: Record<TipKey, { title: string; body: string }> = {
  buy: {
    title: "Buying shares",
    body: "Enter the number of shares, choose market or limit, then press Buy. A market order fills at the visible candle price. A limit order waits until a later candle trades through your price.",
  },
  limit: {
    title: "Limit orders",
    body: "A buy limit fills at or below your limit. A sell limit fills at or above your limit. In Practice, fills are simple: if the next candle reaches the limit, the order fills at that limit price.",
  },
  chart: {
    title: "Chart markers",
    body: "The RVOL marker shows the historical signal candle. Horizontal levels mark missed pivots, premarket high and low, and the previous high. VWAP tracks average traded price through the replay.",
  },
  margin: {
    title: "Buying power",
    body: "Practice uses a simple pattern-day-trader style model: equity times four is buying power. If equity falls under the maintenance requirement, the terminal flags a margin call.",
  },
  book: {
    title: "Book It",
    body: "Book It ends the round. If you still hold shares, Practice auto-closes them at the current candle price, reveals the stock, and opens the review screen.",
  },
};

function money(value: number) {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  return `${sign}$${abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function wholeMoney(value: number) {
  const prefix = value < 0 ? "-$" : "$";
  return `${prefix}${Math.abs(Math.round(value)).toLocaleString("en-US")}`;
}

function signedMoney(value: number) {
  return `${value >= 0 ? "+$" : "-$"}${Math.abs(Math.round(value)).toLocaleString("en-US")}`;
}

function compact(value: number) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function pct(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function signedPrice(value: number) {
  return `${value >= 0 ? "+" : "-"}${Math.abs(value).toFixed(2)}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function id(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function fillPrice(bar: PracticeBar, side: "buy" | "sell", orderType: OrderType | "auto_close", limitPrice?: number) {
  if (orderType === "limit" && typeof limitPrice === "number") return limitPrice;
  if (orderType === "auto_close") return bar.close;
  return side === "buy" ? bar.close : bar.close;
}

function applyExecution(position: Position, execution: PracticeExecution): Position {
  if (execution.side === "buy") {
    const nextShares = position.shares + execution.shares;
    const nextCost = position.shares * position.avgCost + execution.shares * execution.fillPrice;
    return {
      ...position,
      shares: nextShares,
      avgCost: nextShares > 0 ? nextCost / nextShares : 0,
    };
  }

  const sellShares = Math.min(position.shares, execution.shares);
  const realized = (execution.fillPrice - position.avgCost) * sellShares;
  const remaining = Math.max(0, position.shares - sellShares);
  return {
    shares: remaining,
    avgCost: remaining > 0 ? position.avgCost : 0,
    realizedPnl: position.realizedPnl + realized,
  };
}

function computeMetrics(
  balance: number,
  setup: PracticeSetup,
  executions: PracticeExecution[],
  finalPosition: Position,
  finalIndex: number,
): PracticeMetrics {
  const realizedPnl = finalPosition.realizedPnl;
  const firstBuy = executions.find((execution) => execution.side === "buy");
  const lastExecution = executions[executions.length - 1];
  const reviewBars = firstBuy
    ? setup.bars5m.slice(firstBuy.barIndex, Math.min(setup.bars5m.length, finalIndex + 1))
    : [];
  const entry = firstBuy?.fillPrice ?? 0;
  const maxHigh = reviewBars.length ? Math.max(...reviewBars.map((bar) => bar.high)) : entry;
  const minLow = reviewBars.length ? Math.min(...reviewBars.map((bar) => bar.low)) : entry;
  const adds = Math.max(0, executions.filter((execution) => execution.side === "buy").length - 1);
  const reductions = executions.filter((execution) => execution.side === "sell").length;

  return {
    realizedPnl,
    returnPct: balance > 0 ? (realizedPnl / balance) * 100 : 0,
    maxFavorableExcursion: entry > 0 ? maxHigh - entry : 0,
    maxAdverseExcursion: entry > 0 ? minLow - entry : 0,
    holdBars: firstBuy && lastExecution ? Math.max(0, lastExecution.barIndex - firstBuy.barIndex) : 0,
    adds,
    reductions,
    endingEquity: balance + realizedPnl,
  };
}

function setupAttemptCount(attempts: PracticeAttemptSummary[], setupKey: string) {
  return attempts.filter((attempt) => attempt.setupKey === setupKey).length;
}

function rsiSeries(bars: PracticeBar[], period = 14) {
  return bars.map((bar, index) => {
    if (index === 0) return 50;
    const start = Math.max(1, index - period + 1);
    let gains = 0;
    let losses = 0;
    let count = 0;

    for (let cursor = start; cursor <= index; cursor += 1) {
      const change = bars[cursor].close - bars[cursor - 1].close;
      if (change >= 0) gains += change;
      else losses += Math.abs(change);
      count += 1;
    }

    if (count === 0) return 50;
    const averageGain = gains / count;
    const averageLoss = losses / count;
    if (averageLoss === 0) return 100;
    const relativeStrength = averageGain / averageLoss;
    return 100 - 100 / (1 + relativeStrength);
  });
}

function PracticeChart({
  setup,
  currentIndex,
  mode,
  executions,
}: {
  setup: PracticeSetup;
  currentIndex: number;
  mode: ChartMode;
  executions: PracticeExecution[];
}) {
  const sourceBars = mode === "5m" ? setup.bars5m : setup.bars4h;
  const lastVisibleIndex = mode === "5m" ? currentIndex : Math.floor(currentIndex / 48);
  const visibleCount = mode === "5m" ? 36 : 6;
  const maxWindowStart = Math.max(0, sourceBars.length - visibleCount);
  const windowStart = Math.min(maxWindowStart, Math.max(0, lastVisibleIndex - visibleCount + 1));
  const windowBars = sourceBars.slice(windowStart, windowStart + visibleCount);
  const visibleBars = windowBars.filter((bar) => bar.index <= lastVisibleIndex);
  const width = 760;
  const height = 560;
  const leftPad = 8;
  const rightPad = 64;
  const chartTop = 20;
  const chartHeight = 340;
  const rsiTop = 388;
  const rsiHeight = 72;
  const volumeTop = 490;
  const volumeHeight = 34;
  const highs = visibleBars.map((bar) => bar.high);
  const lows = visibleBars.map((bar) => bar.low);
  const levelPrices = setup.levels.map((level) => level.price);
  const minPrice = Math.min(...lows, ...levelPrices);
  const maxPrice = Math.max(...highs, ...levelPrices);
  const pad = Math.max(0.08, (maxPrice - minPrice) * 0.12);
  const domainMin = minPrice - pad;
  const domainMax = maxPrice + pad;
  const maxVolume = Math.max(...visibleBars.map((bar) => bar.volume), 1);
  const innerWidth = width - leftPad - rightPad;
  const y = (price: number) => chartTop + ((domainMax - price) / (domainMax - domainMin)) * chartHeight;
  const x = (index: number) => leftPad + index * (innerWidth / visibleCount) + (innerWidth / visibleCount) / 2;
  const candleStep = innerWidth / visibleCount;
  const vwapPath = visibleBars
    .map((bar, index) => `${index === 0 ? "M" : "L"} ${x(index).toFixed(2)} ${y(bar.vwap).toFixed(2)}`)
    .join(" ");
  const closePoints = visibleBars.map((bar, index) => `${x(index).toFixed(2)},${y(bar.close).toFixed(2)}`).join(" ");
  const areaPoints = `${closePoints} ${x(visibleBars.length - 1).toFixed(2)},${(chartTop + chartHeight).toFixed(2)} ${x(0).toFixed(2)},${(chartTop + chartHeight).toFixed(2)}`;
  const rsiValues = rsiSeries(sourceBars);
  const visibleRsi = visibleBars.map((bar) => rsiValues[bar.index] ?? 50);
  const rsiY = (value: number) => rsiTop + ((100 - value) / 100) * rsiHeight;
  const rsiPath = visibleRsi
    .map((value, index) => `${index === 0 ? "M" : "L"} ${x(index).toFixed(2)} ${rsiY(value).toFixed(2)}`)
    .join(" ");
  const lastBar = visibleBars[visibleBars.length - 1];
  const lastY = y(lastBar.close);
  const lastUp = lastBar.close >= lastBar.open;
  const signalDisplayIndex = setup.signalIndex - windowStart;
  const signalBar = setup.bars5m[setup.signalIndex];
  const signalMarkerY = signalBar ? Math.min(chartTop + chartHeight - 12, y(signalBar.low) + 22) : chartTop + chartHeight - 12;
  const mappedExecutions = executions
    .map((execution) => {
      const index = mode === "5m" ? execution.barIndex : Math.floor(execution.barIndex / 48);
      return { ...execution, index, displayIndex: index - windowStart };
    })
    .filter((execution) => execution.index >= windowStart && execution.index <= lastVisibleIndex);

  return (
    <div className="practice-chart" aria-label={`${mode} replay chart`}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img">
        <defs>
          <linearGradient id="practiceGridFade" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--practice-grid-strong)" />
            <stop offset="100%" stopColor="var(--practice-grid)" />
          </linearGradient>
          <linearGradient id="practiceCloseArea" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--practice-chart-line)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--practice-chart-line)" stopOpacity="0" />
          </linearGradient>
        </defs>

        <rect x="0" y="0" width={width} height={height} rx="0" className="chart-paper" />

        {visibleBars.map((bar, index) => {
          if (index === 0 || visibleBars[index - 1]?.session === bar.session) return null;
          return (
            <line
              key={`session-${index}`}
              x1={x(index) - candleStep / 2}
              x2={x(index) - candleStep / 2}
              y1={chartTop}
              y2={volumeTop + volumeHeight}
              className="session-rule"
            />
          );
        })}

        {Array.from({ length: 5 }, (_, index) => {
          const lineY = chartTop + (chartHeight / 4) * index;
          const price = domainMax - ((domainMax - domainMin) / 4) * index;
          return (
            <g key={lineY}>
              <line x1={leftPad} x2={width - rightPad} y1={lineY} y2={lineY} className="grid-line" />
              <text x={width - rightPad + 7} y={lineY + 4} className="price-label">
                {price.toFixed(1)}
              </text>
            </g>
          );
        })}

        <polygon points={areaPoints} className="close-area" />
        <polyline points={closePoints} className="close-line" />

        {setup.levels.map((level) => {
          const lineY = y(level.price);
          return (
            <g key={level.id} className={`level level-${level.tone}`}>
              <line x1="0" x2={width} y1={lineY} y2={lineY} />
              <text x="14" y={lineY - 6}>{level.label} {money(level.price)}</text>
            </g>
          );
        })}

        <path d={vwapPath} className="vwap-line" />

        {visibleBars.map((bar, index) => {
          const candleX = x(index);
          const up = bar.close >= bar.open;
          const bodyTop = y(Math.max(bar.open, bar.close));
          const bodyBottom = y(Math.min(bar.open, bar.close));
          const bodyHeight = Math.max(2, bodyBottom - bodyTop);
          const candleWidth = clamp(candleStep * 0.6, 2.5, 10);
          const volumeHeightScaled = (bar.volume / maxVolume) * volumeHeight;
          return (
            <g key={`${bar.index}-${bar.timeLabel}`} className={up ? "bar-up" : "bar-down"}>
              <rect
                x={leftPad + index * candleStep}
                y={chartTop}
                width={candleStep}
                height={chartHeight}
                className={`session-fill session-${bar.session}`}
              />
              <line x1={candleX} x2={candleX} y1={y(bar.high)} y2={y(bar.low)} className="wick" />
              <rect
                x={candleX - candleWidth / 2}
                y={bodyTop}
                width={candleWidth}
                height={bodyHeight}
                className="body"
              />
              <rect
                x={candleX - candleWidth / 2}
                y={volumeTop + volumeHeight - volumeHeightScaled}
                width={candleWidth}
                height={volumeHeightScaled}
                className="volume"
              />
            </g>
          );
        })}

        {mode === "5m" && setup.signalIndex <= currentIndex && signalDisplayIndex >= 0 && signalDisplayIndex < visibleBars.length && (
          <g className="signal-marker" transform={`translate(${x(signalDisplayIndex)} ${signalMarkerY})`}>
            <circle r="8" />
            <text x="12" y="4">RVOL</text>
          </g>
        )}

        {mappedExecutions.map((execution) => (
          <g key={execution.id} className={`execution execution-${execution.side}`}>
            <circle cx={x(execution.displayIndex)} cy={y(execution.fillPrice)} r="5" />
            <text x={x(execution.displayIndex) + 8} y={y(execution.fillPrice) - 8}>
              {execution.side.toUpperCase()} {execution.shares}
            </text>
          </g>
        ))}

        <line x1={leftPad} x2={width - rightPad} y1={lastY} y2={lastY} className={lastUp ? "last-price-line up" : "last-price-line down"} />
        <rect x={width - rightPad} y={lastY - 10} width={rightPad} height="20" rx="2" className={lastUp ? "last-price-tag up" : "last-price-tag down"} />
        <text x={width - rightPad / 2} y={lastY + 4} className="last-price-text">
          {lastBar.close.toFixed(2)}
        </text>

        <g className="rsi-panel">
          <rect x={leftPad} y={rsiTop} width={innerWidth} height={rsiHeight} />
          <line x1={leftPad} x2={width - rightPad} y1={rsiY(70)} y2={rsiY(70)} className="rsi-guide" />
          <line x1={leftPad} x2={width - rightPad} y1={rsiY(30)} y2={rsiY(30)} className="rsi-guide" />
          <path d={rsiPath} className="rsi-line" />
          <text x="14" y={rsiTop + 15} className="rsi-label">RSI {Math.round(visibleRsi[visibleRsi.length - 1] ?? 50)}</text>
          <text x={width - rightPad + 7} y={rsiY(70) + 4} className="rsi-axis">70</text>
          <text x={width - rightPad + 7} y={rsiY(30) + 4} className="rsi-axis">30</text>
        </g>

        <text x="14" y="544" className="axis-label">
          {visibleBars[0]?.timeLabel} ET
        </text>
        <text x={width - 110} y="544" className="axis-label">
          {visibleBars[visibleBars.length - 1]?.timeLabel} ET
        </text>
      </svg>
    </div>
  );
}

export default function PracticeClient({
  setups,
  initialAttempts,
  canSave,
}: {
  setups: PracticeSetup[];
  initialAttempts: PracticeAttemptSummary[];
  canSave: boolean;
}) {
  const [attempts, setAttempts] = useState(initialAttempts);
  const [phase, setPhase] = useState<Phase>("replay");
  const [selectedKey, setSelectedKey] = useState(setups[0]?.key ?? "");
  const [theme, setTheme] = useState<PracticeTheme>("dark");
  const [balanceInput, setBalanceInput] = useState(INITIAL_BALANCE);
  const [currentIndex, setCurrentIndex] = useState(STARTING_BAR_INDEX);
  const [chartMode, setChartMode] = useState<ChartMode>("5m");
  const [orderType, setOrderType] = useState<OrderType>("market");
  const [orderSide, setOrderSide] = useState<OrderSide>("buy");
  const [sharesInput, setSharesInput] = useState("100");
  const [limitInput, setLimitInput] = useState("");
  const [position, setPosition] = useState<Position>({ shares: 0, avgCost: 0, realizedPnl: 0 });
  const [executions, setExecutions] = useState<PracticeExecution[]>([]);
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([]);
  const [activeTip, setActiveTip] = useState<TipKey>("buy");
  const [message, setMessage] = useState("Start at 04:00 ET. Trade whenever you want.");
  const [metrics, setMetrics] = useState<PracticeMetrics | null>(null);
  const [notes, setNotes] = useState("");
  const [selfScore, setSelfScore] = useState("unscored");
  const [saving, setSaving] = useState(false);

  const setup = setups.find((item) => item.key === selectedKey) ?? setups[0];
  const completedSetups = useMemo(() => new Set(attempts.map((attempt) => attempt.setupKey)), [attempts]);

  useEffect(() => {
    if (!setup || phase !== "replay") return;

    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target;
      const element = target instanceof HTMLElement ? target : null;
      if (
        element?.isContentEditable ||
        element?.closest("input, select, textarea")
      ) {
        return;
      }

      if (event.code === "Space" || event.key === " ") {
        event.preventDefault();
        stepForward();
      } else if (event.key.toLowerCase() === "b") {
        setOrderSide("buy");
      } else if (event.key.toLowerCase() === "s") {
        setOrderSide("sell");
      } else if (event.key === "Enter") {
        event.preventDefault();
        placeOrder(orderSide);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  if (!setup) {
    return (
      <main className="practice-shell">
        <div className="practice-empty">No practice setups are available yet.</div>
      </main>
    );
  }

  const startingBalance = Number(balanceInput);
  const safeBalance = Number.isFinite(startingBalance) && startingBalance > 0 ? startingBalance : 0;
  const currentBar = setup.bars5m[currentIndex] ?? setup.bars5m[0];
  const marketValue = position.shares * currentBar.close;
  const unrealizedPnl = position.shares * (currentBar.close - position.avgCost);
  const equity = safeBalance + position.realizedPnl + unrealizedPnl;
  const sessionPnl = position.realizedPnl + unrealizedPnl;
  const pnlPct = safeBalance > 0 ? (sessionPnl / safeBalance) * 100 : 0;
  const buyingPower = Math.max(0, equity * PDT_MULTIPLIER - marketValue);
  const maintenanceRequirement = marketValue * MAINTENANCE_RATE;
  const marginCall = position.shares > 0 && equity < maintenanceRequirement;
  const attemptCount = setupAttemptCount(attempts, setup.key);
  const displayIndex = phase === "review" ? setup.bars5m.length - 1 : currentIndex;

  const reviewMetrics = metrics ?? computeMetrics(safeBalance, setup, executions, position, currentIndex);
  const dayBars = setup.bars5m.slice(0, displayIndex + 1);
  const dayHigh = Math.max(...dayBars.map((bar) => bar.high));
  const dayLow = Math.min(...dayBars.map((bar) => bar.low));
  const dayOpen = setup.bars5m[0]?.open ?? currentBar.open;
  const visibleVolume = dayBars.reduce((sum, bar) => sum + bar.volume, 0);
  const priceChange = currentBar.close - dayOpen;
  const priceChangePct = dayOpen > 0 ? (priceChange / dayOpen) * 100 : 0;
  const estimatedCost = Math.max(0, Math.floor(Number(sharesInput) || 0)) * currentBar.close;
  const tapeItems = setups.slice(0, 6).map((item, index) => {
    const bar = item.bars5m[Math.min(displayIndex, item.bars5m.length - 1)] ?? item.bars5m[0];
    const open = item.bars5m[0]?.open ?? bar.open;
    const change = open > 0 ? ((bar.close - open) / open) * 100 : 0;
    return {
      ticker: completedSetups.has(item.key) ? item.sourceTicker : `P${String(index + 1).padStart(2, "0")}`,
      price: bar.close,
      change,
    };
  });

  function resetRound(nextSetup = setup) {
    setSelectedKey(nextSetup.key);
    setCurrentIndex(STARTING_BAR_INDEX);
    setChartMode("5m");
    setOrderType("market");
    setSharesInput("100");
    setLimitInput("");
    setPosition({ shares: 0, avgCost: 0, realizedPnl: 0 });
    setExecutions([]);
    setPendingOrders([]);
    setMetrics(null);
    setNotes("");
    setSelfScore("unscored");
    setMessage("Start at 04:00 ET. Trade whenever you want.");
  }

  function beginSetup(nextSetup: PracticeSetup) {
    resetRound(nextSetup);
    setPhase("briefing");
  }

  function recordExecution(execution: PracticeExecution) {
    setExecutions((current) => [...current, execution]);
    setPosition((current) => applyExecution(current, execution));
  }

  function placeOrder(side: "buy" | "sell") {
    const shares = Math.floor(Number(sharesInput));
    if (!Number.isFinite(shares) || shares <= 0) {
      setMessage("Enter a positive share amount.");
      return;
    }

    const limitPrice = Number(limitInput);
    if (orderType === "limit" && (!Number.isFinite(limitPrice) || limitPrice <= 0)) {
      setMessage("Enter a valid limit price.");
      return;
    }

    if (side === "sell" && shares > position.shares) {
      setMessage("Practice is long-only. You can only sell shares you already hold.");
      return;
    }

    const requestedPrice = orderType === "limit" ? limitPrice : null;
    const estimatedFill = fillPrice(currentBar, side, orderType, requestedPrice ?? undefined);
    if (side === "buy" && shares * estimatedFill > buyingPower) {
      setMessage("That order exceeds current buying power.");
      return;
    }

    if (orderType === "limit") {
      setPendingOrders((orders) => [
        ...orders,
        { id: id("limit"), side, shares, limitPrice, createdAtIndex: currentIndex },
      ]);
      setMessage(`${side === "buy" ? "Buy" : "Sell"} limit working at ${money(limitPrice)}.`);
      return;
    }

    const execution: PracticeExecution = {
      id: id("exec"),
      side,
      orderType,
      shares,
      requestedPrice,
      fillPrice: estimatedFill,
      barIndex: currentIndex,
      timeLabel: currentBar.timeLabel,
      createdAt: new Date().toISOString(),
    };
    recordExecution(execution);
    setMessage(`${side === "buy" ? "Bought" : "Sold"} ${shares} at ${money(estimatedFill)}.`);
  }

  function processLimitOrders(nextIndex: number) {
    const nextBar = setup.bars5m[nextIndex];
    if (!nextBar || pendingOrders.length === 0) return;
    const filled: PracticeExecution[] = [];
    const remaining: PendingOrder[] = [];
    let projectedPosition = position;

    for (const order of pendingOrders) {
      const canFill =
        order.createdAtIndex < nextIndex &&
        (order.side === "buy"
          ? nextBar.low <= order.limitPrice
          : nextBar.high >= order.limitPrice);
      if (!canFill) {
        remaining.push(order);
        continue;
      }
      if (order.side === "sell" && order.shares > projectedPosition.shares) {
        remaining.push(order);
        continue;
      }
      const execution: PracticeExecution = {
        id: id("exec"),
        side: order.side,
        orderType: "limit",
        shares: order.shares,
        requestedPrice: order.limitPrice,
        fillPrice: order.limitPrice,
        barIndex: nextIndex,
        timeLabel: nextBar.timeLabel,
        createdAt: new Date().toISOString(),
      };
      projectedPosition = applyExecution(projectedPosition, execution);
      filled.push(execution);
    }

    if (filled.length > 0) {
      setExecutions((current) => [...current, ...filled]);
      setPosition(projectedPosition);
      setMessage(`${filled.length} limit order${filled.length === 1 ? "" : "s"} filled on ${nextBar.timeLabel}.`);
    }
    setPendingOrders(remaining);
  }

  function stepForward() {
    if (currentIndex >= setup.bars5m.length - 1) {
      finishRound("end_of_day");
      return;
    }
    const nextIndex = currentIndex + 1;
    setCurrentIndex(nextIndex);
    processLimitOrders(nextIndex);
  }

  function jumpForward(count: number) {
    const next = Math.min(setup.bars5m.length - 1, currentIndex + count);
    for (let index = currentIndex + 1; index <= next; index += 1) {
      processLimitOrders(index);
    }
    setCurrentIndex(next);
    if (next >= setup.bars5m.length - 1) finishRound("end_of_day");
  }

  function finishRound(reason: "book_it" | "end_of_day") {
    let finalPosition = position;
    let finalExecutions = executions;
    const bar = setup.bars5m[currentIndex] ?? setup.bars5m[setup.bars5m.length - 1];
    if (finalPosition.shares > 0) {
      const execution: PracticeExecution = {
        id: id("exec"),
        side: "sell",
        orderType: "auto_close",
        shares: finalPosition.shares,
        requestedPrice: null,
        fillPrice: bar.close,
        barIndex: currentIndex,
        timeLabel: bar.timeLabel,
        createdAt: new Date().toISOString(),
      };
      finalExecutions = [...finalExecutions, execution];
      finalPosition = applyExecution(finalPosition, execution);
      setExecutions(finalExecutions);
      setPosition(finalPosition);
    }
    const nextMetrics = computeMetrics(safeBalance, setup, finalExecutions, finalPosition, currentIndex);
    setPendingOrders([]);
    setMetrics(nextMetrics);
    setMessage(reason === "book_it" ? "Booked. The ticker is revealed." : "The 8pm close is in. The ticker is revealed.");
    setPhase("review");
  }

  async function saveAttempt() {
    if (!canSave) {
      setMessage("Sign in to save this practice attempt. The simulator is open for preview.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        setupKey: setup.key,
        accountBalance: safeBalance,
        attemptNumber: attemptCount + 1,
        completedAt: new Date().toISOString(),
        executions,
        metrics: reviewMetrics,
        notes,
        selfScore,
        reveal: {
          ticker: setup.sourceTicker,
          company: setup.sourceCompany,
          sourceDate: setup.sourceDate,
          sourceSignalTime: setup.sourceSignalTime,
          priceScale: setup.priceScale,
          volumeScale: setup.volumeScale,
        },
      };
      const response = await fetch("/api/practice/attempts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error ?? "save_failed");
      setAttempts((current) => [
        {
          id: json.attempt.id,
          setupKey: setup.key,
          attemptNumber: attemptCount + 1,
          completedAt: payload.completedAt,
          realizedPnl: reviewMetrics.realizedPnl,
        },
        ...current,
      ]);
      setMessage("Saved to Practice history.");
    } catch (error) {
      setMessage(error instanceof Error ? `Save failed: ${error.message}` : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="practice-shell" data-practice-theme={theme}>
      <div className="practice-wrap">
        {phase === "lobby" && (
          <section className="practice-lobby" aria-labelledby="practice-title">
            <div className="practice-lobby__intro">
              <p className="practice-kicker">Longboard Practice</p>
              <h1 id="practice-title">Trade the setup before you know the name.</h1>
              <p>
                Ten anonymized RVOL sessions are ready for today. Prices and volume are scaled, but
                the chart relationships stay intact.
              </p>
              <label className="practice-field">
                <span>Starting account balance</span>
                <input
                  value={balanceInput}
                  onChange={(event) => setBalanceInput(event.target.value)}
                  inputMode="decimal"
                  aria-label="Starting account balance"
                />
              </label>
            </div>

            <div className="practice-queue" aria-label="Today practice queue">
              {setups.map((item) => {
                const count = setupAttemptCount(attempts, item.key);
                const completed = completedSetups.has(item.key);
                return (
                  <button
                    key={item.key}
                    type="button"
                    className="practice-setup"
                    onClick={() => beginSetup(item)}
                  >
                    <span className="practice-setup__slot">{String(item.slot).padStart(2, "0")}</span>
                    <strong>{completed ? item.sourceTicker : item.anonymizedName}</strong>
                    <span>{completed ? `${item.sourceCompany} revealed` : "Hidden ticker and date"}</span>
                    <em>{count > 0 ? `${count} attempt${count === 1 ? "" : "s"}` : "Fresh setup"}</em>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {phase === "briefing" && (
          <section className="practice-briefing" aria-labelledby="briefing-title">
            <div>
              <p className="practice-kicker">{setup.anonymizedName}</p>
              <h1 id="briefing-title">Start at premarket. Book it when you are done.</h1>
              <p>
                You can trade anytime from 04:00 ET. Use market or limit orders, manage the position,
                and ask for platform tips whenever something on the terminal needs context.
              </p>
            </div>
            <div className="practice-rules">
              <span>No shorting</span>
              <span>Simple fills</span>
              <span>4x PDT buying power</span>
              <span>Auto-close on Book It</span>
            </div>
            <div className="practice-actions">
              <button type="button" className="practice-btn practice-btn--ghost" onClick={() => setPhase("lobby")}>
                Back
              </button>
              <button type="button" className="practice-btn practice-btn--primary" onClick={() => setPhase("replay")}>
                Start Replay
              </button>
            </div>
          </section>
        )}

        {(phase === "replay" || phase === "review") && (
          <section className="practice-terminal" aria-label="Practice replay terminal">
            <div className="practice-terminal-frame">
              <header className="practice-game-header">
                <div className="practice-brand">
                  <span className="practice-brand__mark">L</span>
                  <span className="practice-brand__word">LONGBOARD<span>PRACTICE</span></span>
                  <span className="practice-round">ROUND {setup.slot}</span>
                </div>
                <div className="practice-header-metrics">
                  <div>
                    <span>Equity</span>
                    <strong>{wholeMoney(equity)}</strong>
                  </div>
                  <i />
                  <div>
                    <span>Session P&amp;L</span>
                    <strong className={sessionPnl >= 0 ? "is-positive" : "is-negative"}>{signedMoney(sessionPnl)}</strong>
                  </div>
                  <button type="button" className="practice-theme-toggle" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
                    {theme === "dark" ? "Light" : "Dark"}
                  </button>
                </div>
              </header>

              <div className="practice-game-main">
                <div className="practice-chart-column">
                  <div className="practice-symbol-row">
                    <div className="practice-symbol-group">
                      <strong>{phase === "review" ? setup.sourceTicker : setup.anonymizedName.replace("Practice ", "P")}</strong>
                      <span>{phase === "review" ? setup.sourceCompany : "Hidden technical setup"}</span>
                      <b>{currentBar.close.toFixed(2)}</b>
                      <em className={priceChange >= 0 ? "is-positive" : "is-negative"}>{signedPrice(priceChange)} ({pct(priceChangePct)})</em>
                    </div>
                    <div className="practice-tabs" role="tablist" aria-label="Chart timeframe">
                      <button type="button" aria-selected={chartMode === "5m"} onClick={() => setChartMode("5m")}>5m</button>
                      <button type="button" aria-selected={chartMode === "4h"} onClick={() => setChartMode("4h")}>4H</button>
                    </div>
                  </div>
                  <div className="practice-ohlc">
                    <span>O <b>{dayOpen.toFixed(2)}</b></span>
                    <span>H <b className="is-positive">{dayHigh.toFixed(2)}</b></span>
                    <span>L <b className="is-negative">{dayLow.toFixed(2)}</b></span>
                    <span>VOL <b>{compact(visibleVolume)}</b></span>
                    <span>{currentBar.timeLabel} ET</span>
                  </div>
                  <div className="practice-chart-stage">
                    <PracticeChart setup={setup} currentIndex={displayIndex} mode={chartMode} executions={executions} />
                  </div>
                  <div className="practice-replay-controls">
                    <button type="button" onClick={() => setPhase("lobby")}>Queue</button>
                    <button
                      type="button"
                      className="practice-control-primary"
                      onClick={stepForward}
                      disabled={phase === "review"}
                      title="Step one candle. You can also press the space bar."
                      data-hint="Press Space to step"
                      aria-keyshortcuts="Space"
                      autoFocus={phase === "replay"}
                    >
                      Step
                    </button>
                    <button type="button" onClick={() => jumpForward(6)} disabled={phase === "review"}>+30m</button>
                    <button type="button" className="practice-control-book" onClick={() => finishRound("book_it")} disabled={phase === "review"}>Book It</button>
                    <span>{displayIndex + 1} / {setup.bars5m.length} candles</span>
                  </div>
                </div>

                <aside className="practice-right-rail">
                  {phase === "replay" ? (
                    <div className="practice-order-ticket">
                      <div className="practice-side-toggle" aria-label="Order side">
                        <button type="button" className="buy" aria-pressed={orderSide === "buy"} onClick={() => setOrderSide("buy")}>BUY</button>
                        <button type="button" className="sell" aria-pressed={orderSide === "sell"} onClick={() => setOrderSide("sell")}>SELL</button>
                      </div>
                      <div className="practice-segmented" aria-label="Order type">
                        <button type="button" aria-pressed={orderType === "market"} onClick={() => setOrderType("market")}>Market</button>
                        <button type="button" aria-pressed={orderType === "limit"} onClick={() => setOrderType("limit")}>Limit</button>
                      </div>
                      <div className="practice-qty-stepper">
                        <span>QTY</span>
                        <div>
                          <button type="button" onClick={() => setSharesInput(String(Math.max(1, Math.floor(Number(sharesInput) || 0) - 25)))}>-</button>
                          <strong>{Math.floor(Number(sharesInput) || 0)}</strong>
                          <button type="button" onClick={() => setSharesInput(String(Math.floor(Number(sharesInput) || 0) + 25))}>+</button>
                        </div>
                      </div>
                      {orderType === "limit" && (
                        <label>
                          Limit
                          <input value={limitInput} onChange={(event) => setLimitInput(event.target.value)} inputMode="decimal" />
                        </label>
                      )}
                      <div className="practice-est-cost">
                        <span>Est. cost</span>
                        <strong>{wholeMoney(estimatedCost)}</strong>
                      </div>
                      <button type="button" className="practice-place-order" onClick={() => placeOrder(orderSide)}>
                        PLACE ORDER &gt;
                      </button>
                      <p className="practice-message" role="status">{message}</p>
                    </div>
                  ) : (
                    <div className="practice-review-card">
                      <span>Realized P/L</span>
                      <strong className={reviewMetrics.realizedPnl >= 0 ? "is-positive" : "is-negative"}>{signedMoney(reviewMetrics.realizedPnl)}</strong>
                      <span>Return</span>
                      <strong>{pct(reviewMetrics.returnPct)}</strong>
                      <span>MFE / MAE</span>
                      <strong>{money(reviewMetrics.maxFavorableExcursion)} / {money(reviewMetrics.maxAdverseExcursion)}</strong>
                      <span>Hold</span>
                      <strong>{reviewMetrics.holdBars} candles</strong>
                    </div>
                  )}

                  <div className="practice-positions">
                    <div className="practice-positions__head">
                      <span>{phase === "review" ? "TRADE REVIEW" : "OPEN POSITIONS"}</span>
                      <strong className={pnlPct >= 0 ? "is-positive" : "is-negative"}>{pct(pnlPct)}</strong>
                    </div>
                    {position.shares > 0 ? (
                      <div className="practice-position-row">
                        <span className="practice-position-badge">LONG</span>
                        <div>
                          <strong>{phase === "review" ? setup.sourceTicker : setup.anonymizedName.replace("Practice ", "P")}</strong>
                          <small>{position.shares} @ {position.avgCost.toFixed(2)}</small>
                        </div>
                        <b className={unrealizedPnl >= 0 ? "is-positive" : "is-negative"}>{signedMoney(unrealizedPnl)}</b>
                      </div>
                    ) : (
                      <div className="practice-position-row practice-position-row--empty">
                        <span className="practice-position-badge">FLAT</span>
                        <div>
                          <strong>{executions.length ? "No open position" : "No trades yet"}</strong>
                          <small>{executions.length ? `${executions.length} execution${executions.length === 1 ? "" : "s"}` : "Use the order ticket above"}</small>
                        </div>
                        <b>{signedMoney(sessionPnl)}</b>
                      </div>
                    )}
                    {executions.slice(-4).reverse().map((execution) => (
                      <div key={execution.id} className="practice-position-row">
                        <span className={`practice-position-badge ${execution.side}`}>{execution.side.toUpperCase()}</span>
                        <div>
                          <strong>{execution.orderType === "auto_close" ? "AUTO CLOSE" : execution.orderType.toUpperCase()}</strong>
                          <small>{execution.shares} @ {execution.fillPrice.toFixed(2)} / {execution.timeLabel}</small>
                        </div>
                        <b>{execution.side === "buy" ? "-" : "+"}{wholeMoney(execution.shares * execution.fillPrice).replace("$", "$")}</b>
                      </div>
                    ))}
                  </div>

                  <div className="practice-tips">
                    <div className="practice-tip-buttons" aria-label="Practice tips">
                      {(Object.keys(TIPS) as TipKey[]).map((key) => (
                        <button key={key} type="button" aria-pressed={activeTip === key} onClick={() => setActiveTip(key)}>
                          {TIPS[key].title}
                        </button>
                      ))}
                    </div>
                    <div className="practice-tip-copy">
                      <strong>{TIPS[activeTip].title}</strong>
                      <p>{TIPS[activeTip].body}</p>
                    </div>
                  </div>
                </aside>
              </div>

              <div className="practice-command-strip" aria-label="Replay command shortcuts">
                <span><b>SPACE</b> Step candle</span>
                <span><b>B</b> Buy side</span>
                <span><b>S</b> Sell side</span>
                <span><b>ENTER</b> Place order</span>
                <span><b>BOOK IT</b> End round</span>
              </div>

              <div className="practice-tape" aria-hidden="true">
                <div>
                  {[...tapeItems, ...tapeItems].map((item, index) => (
                    <span key={`${item.ticker}-${index}`}>
                      <b>{item.ticker}</b>
                      <i>{item.price.toFixed(2)}</i>
                      <em className={item.change >= 0 ? "is-positive" : "is-negative"}>{pct(item.change)}</em>
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {pendingOrders.length > 0 && phase === "replay" && (
              <div className="practice-pending">
                {pendingOrders.map((order) => (
                  <span key={order.id}>{order.side.toUpperCase()} {order.shares} @ {money(order.limitPrice)}</span>
                ))}
              </div>
            )}

            {phase === "review" && (
              <div className="practice-review">
                <div className="practice-reveal">
                  <span>Source ticker</span>
                  <strong>{setup.sourceTicker}</strong>
                  <span>Company</span>
                  <strong>{setup.sourceCompany}</strong>
                  <span>Session</span>
                  <strong>{setup.sourceDate} / signal {setup.sourceSignalTime} ET</strong>
                  <span>Scale</span>
                  <strong>Price x{setup.priceScale.toFixed(3)} / volume x{setup.volumeScale.toFixed(2)}</strong>
                </div>
                <label className="practice-field">
                  <span>Self-score</span>
                  <select value={selfScore} onChange={(event) => setSelfScore(event.target.value)}>
                    <option value="unscored">Unscored</option>
                    <option value="good">Good trade</option>
                    <option value="mixed">Mixed trade</option>
                    <option value="poor">Poor trade</option>
                  </select>
                </label>
                <label className="practice-field practice-field--notes">
                  <span>Notes</span>
                  <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
                </label>
                <div className="practice-actions">
                  <button type="button" className="practice-btn practice-btn--ghost" onClick={() => setPhase("lobby")}>Return to Queue</button>
                  <button type="button" className="practice-btn practice-btn--primary" onClick={saveAttempt} disabled={saving}>{saving ? "Saving" : canSave ? "Save Attempt" : "Sign in to Save"}</button>
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
