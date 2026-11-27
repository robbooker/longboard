"use client";
// #528 Gainer Balloons: the day's gainers as balloons. One component for the app in the chat
// (/chat?page=balloons) and for a card in Dual, Quad and Six (`compact`).
//
//  size    = shares traded so far today (log scale)
//  stretch = volume ÷ float, as far as the company's country allows (China / Hong Kong the most, the U.S. the least)
//  height  = percent change from the previous close
//  matte   = float not known
//  ripple  = a burst of volume; sinking and leaning = the price falling back
//
// This file is the React shell: data, the clock, the controls. It never imports three.js. The scene
// (./scene/scene.ts and three) is downloaded with a dynamic import only once this component is on
// screen and the browser has WebGL; without WebGL a plain list is shown and three is never fetched.
// One time path for everything: each frame asks the data layer for getStateAtTime(T). "Live" sets T
// to now; the scrubber and Play set it to any earlier moment of the same day.
//
// A card draws less (scene/quality.ts), shows a slim scrubber only when it has room, limits the
// ticker labels to the biggest stories, and stops drawing entirely while it is hidden, off screen or
// the tab is in the background. Keys (space, arrows, Esc) are read only while focus is inside this
// component, so a chat composer in the next card never loses a keystroke.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { DEFAULT_SPEED_ID, PLAYBACK_SPEEDS, type PlaybackSpeedId } from "@/lib/gainerBalloons/config";
import {
  createMarketData,
  type MarketData,
  type StockState,
  type TimeBounds,
} from "@/lib/gainerBalloons/data";
import {
  DASH,
  SESSION_LABELS,
  formatCompactNumber,
  formatEasternClock,
  formatMarketDay,
  formatPct,
  formatPrice,
  formatRatio,
} from "@/lib/gainerBalloons/format";
import { computeLayout } from "@/lib/gainerBalloons/layout";
import {
  CONDITION_LABELS,
  PLAIN_SKY,
  formatTemp,
  skyWeather,
  type SkyWeather,
} from "@/lib/gainerBalloons/weather";
import { QUALITY, cardSizeClass, labelBudget, labelTextPx, type SizeClass } from "./scene/quality";
import type { BalloonScene } from "./scene/scene";
import { useBalloonsFeed } from "./useBalloonsFeed";
import { useBalloonsWeather } from "./useBalloonsWeather";
import WeatherIcon from "./WeatherIcon";
import styles from "./GainerBalloons.module.css";

type Mode = "live" | "replay";
type WebGl = "pending" | "on" | "off" | "lost";
type Detail = Pick<
  StockState,
  | "ticker"
  | "country"
  | "colorHex"
  | "floatKnown"
  | "floatShares"
  | "hasTraded"
  | "price"
  | "pctChange"
  | "cumVolume"
  | "volumeToFloat"
  | "prevClose"
  | "liftLoss"
  | "peakPctChange"
  | "burst"
>;
type ListRow = { ticker: string; pctChange: number | null; volume: number | null };

const detailOf = (s: StockState): Detail => ({
  ticker: s.ticker,
  country: s.country,
  colorHex: s.colorHex,
  floatKnown: s.floatKnown,
  floatShares: s.floatShares,
  hasTraded: s.hasTraded,
  price: s.price,
  pctChange: s.pctChange,
  cumVolume: s.cumVolume,
  volumeToFloat: s.volumeToFloat,
  prevClose: s.prevClose,
  liftLoss: s.liftLoss,
  peakPctChange: s.peakPctChange,
  burst: s.burst,
});

/** True when this browser can give a page a WebGL context (asked for once, then handed straight back). */
function webglAvailable() {
  try {
    const probe = document.createElement("canvas");
    const gl = (probe.getContext("webgl2") ?? probe.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

export default function GainerBalloons({
  compact = false,
  visible = true,
}: {
  compact?: boolean;
  active?: boolean;
  visible?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const clockText = useRef<HTMLSpanElement>(null);
  const sessionText = useRef<HTMLSpanElement>(null);
  const slider = useRef<HTMLInputElement>(null);
  const fill = useRef<HTMLDivElement>(null);
  const spark = useRef<HTMLCanvasElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);

  // --- On screen? A hidden card, a card scrolled away and a background tab all stop the work.
  const [inView, setInView] = useState(true);
  const [tabShown, setTabShown] = useState(true);
  useEffect(() => {
    const onVisibility = () => setTabShown(document.visibilityState === "visible");
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    const el = root.current;
    const observer =
      el && typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver(([entry]) => setInView(entry.isIntersecting))
        : null;
    if (el) observer?.observe(el);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      observer?.disconnect();
    };
  }, []);
  const onScreen = visible && inView && tabShown;

  // --- Size: the full app, or a card's class from its own box.
  const [box, setBox] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => {
      const width = el.clientWidth;
      const height = el.clientHeight;
      if (width && height)
        setBox((before) => (before.width === width && before.height === height ? before : { width, height }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const size: SizeClass = compact ? cardSizeClass(box.width, box.height) : "full";
  /** A card shows the scrubber only when it has room for one that is worth using. */
  const scrubber = !compact || size !== "small";

  const reducedMotion = useRef(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => (reducedMotion.current = media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  // --- Data.
  const { feed, status, clockOffsetMs } = useBalloonsFeed(onScreen);
  const offset = useRef(0);
  offset.current = clockOffsetMs;
  const marketNow = useCallback(() => Date.now() + offset.current, []);
  const source = useMemo<MarketData | null>(() => {
    if (!feed) return null;
    const stocks = [...feed.stocks].sort((a, b) => a.ticker.localeCompare(b.ticker));
    return createMarketData({ date: feed.day, barMinutes: feed.barMinutes, asOfMs: feed.now, stocks });
  }, [feed]);
  const metadata = useMemo(() => source?.getStockMetadata() ?? [], [source]);
  /** Changes only when the stocks, a float becoming known, or a country do: the field is re-laid then. */
  const signature = useMemo(
    () => metadata.map((m) => `${m.ticker}:${m.floatKnown ? 1 : 0}:${m.tier}`).join("|"),
    [metadata],
  );
  const bounds = useMemo<TimeBounds | null>(() => source?.getTimeBounds() ?? null, [source]);
  const day = feed?.day ?? null;
  /** Today's session is still running (or about to): Live follows the clock. */
  const liveCapable = !!feed && !!bounds && feed.day === feed.today && feed.now < bounds.endMs;
  const empty = !!feed && feed.stocks.length === 0;

  const sourceRef = useRef<MarketData | null>(null);
  const boundsRef = useRef<TimeBounds | null>(null);
  const liveCapableRef = useRef(false);
  sourceRef.current = source;
  boundsRef.current = bounds;
  liveCapableRef.current = liveCapable;

  // --- Time. T lives in a ref (it changes every frame); what the buttons show is state.
  const time = useRef(0);
  const [mode, setModeState] = useState<Mode>("replay");
  const modeRef = useRef<Mode>("replay");
  const [playing, setPlayingState] = useState(false);
  const playingRef = useRef(false);
  const [speedId, setSpeedId] = useState<PlaybackSpeedId>(DEFAULT_SPEED_ID);
  const speed = useRef(PLAYBACK_SPEEDS.find((s) => s.id === DEFAULT_SPEED_ID)!.minutesPerSec);
  const snapNext = useRef(true);
  const setMode = useCallback((next: Mode) => {
    modeRef.current = next;
    setModeState(next);
  }, []);
  const setPlaying = useCallback((next: boolean) => {
    playingRef.current = next;
    setPlayingState(next);
  }, []);
  /** Where "the day so far" ends: now while the day runs, the end of the day afterwards. */
  const edge = useCallback(() => {
    const b = boundsRef.current;
    if (!b) return 0;
    return liveCapableRef.current ? Math.min(Math.max(marketNow(), b.startMs), b.endMs) : b.endMs;
  }, [marketNow]);

  // A new day arrives (the first read, or the date rolling over): start Live, or at the end of a finished day.
  const startedDay = useRef<string | null>(null);
  useEffect(() => {
    if (!day || !bounds || startedDay.current === day) return;
    startedDay.current = day;
    snapNext.current = true;
    setPlaying(false);
    if (liveCapable) setMode("live");
    else {
      setMode("replay");
      time.current = Math.max(bounds.startMs, bounds.lastDataMs);
    }
  }, [day, bounds, liveCapable, setMode, setPlaying]);
  // The session ended while Live: stay on the last moment of the day.
  useEffect(() => {
    if (!liveCapable && modeRef.current === "live" && bounds) {
      setMode("replay");
      time.current = bounds.endMs;
    }
  }, [liveCapable, bounds, setMode]);

  const goLive = useCallback(() => {
    if (!liveCapableRef.current) return;
    setMode("live");
    setPlaying(false);
  }, [setMode, setPlaying]);
  const hold = useCallback(() => {
    // Leaving Live keeps the moment on screen.
    if (modeRef.current === "live") time.current = edge();
    setMode("replay");
  }, [edge, setMode]);
  const togglePlay = useCallback(() => {
    const b = boundsRef.current;
    if (!b) return;
    if (modeRef.current === "live") {
      hold();
      setPlaying(false);
      return;
    }
    if (!playingRef.current && time.current >= edge() - 1_000) {
      // At the end already: Live if the day is still running, otherwise play the day again from the start.
      if (liveCapableRef.current) return goLive();
      time.current = b.startMs;
      snapNext.current = true;
    }
    setPlaying(!playingRef.current);
  }, [edge, goLive, hold, setPlaying]);
  const step = useCallback(
    (bars: number) => {
      const b = boundsRef.current;
      if (!b) return;
      hold();
      setPlaying(false);
      time.current = Math.min(edge(), Math.max(b.startMs, time.current + bars * b.barMs));
    },
    [edge, hold, setPlaying],
  );
  const scrubTo = useCallback(
    (progress: number) => {
      const b = boundsRef.current;
      if (!b) return;
      const wanted = b.startMs + Math.min(1, Math.max(0, progress)) * (b.endMs - b.startMs);
      // Dragged up to now on a running day: that is Live.
      if (liveCapableRef.current && wanted >= edge() - 30_000) return goLive();
      hold();
      setPlaying(false);
      time.current = Math.min(edge(), wanted);
    },
    [edge, goLive, hold, setPlaying],
  );

  // --- Selection, by ticker (ids change when the list does).
  const [selected, setSelected] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selected;
  const [detail, setDetail] = useState<Detail | null>(null);
  const [rows, setRows] = useState<ListRow[]>([]);
  const idOf = useCallback(
    (ticker: string | null) => (ticker ? metadata.findIndex((m) => m.ticker === ticker) : -1),
    [metadata],
  );
  const metadataRef = useRef(metadata);
  metadataRef.current = metadata;

  // --- Weather. A card follows the remembered choice; only the full app can ask for a location.
  const weather = useBalloonsWeather(onScreen);
  const sky = useRef<SkyWeather>(PLAIN_SKY);
  sky.current = skyWeather(weather.weather);

  // --- The scene (three.js), loaded on demand.
  const sceneRef = useRef<BalloonScene | null>(null);
  const [webgl, setWebgl] = useState<WebGl>("pending");
  const [sceneTry, setSceneTry] = useState(0);
  const interactedAt = useRef(0);
  const sizeRef = useRef<SizeClass>(size);
  sizeRef.current = size;
  const boxRef = useRef(box);
  boxRef.current = box;
  const ready = status === "ready" && box.width > 0;
  useEffect(() => {
    const host = stage.current;
    if (!ready || !host) return;
    if (!webglAvailable()) {
      setWebgl("off");
      return;
    }
    let gone = false;
    let made: BalloonScene | null = null;
    void import("./scene/scene")
      .then(({ createBalloonScene }) => {
        if (gone) return;
        made = createBalloonScene(host, {
          quality: QUALITY[sizeRef.current],
          onSelect: (id) => {
            const ticker = id >= 0 ? (metadataRef.current[id]?.ticker ?? null) : null;
            setSelected((before) => (ticker && before === ticker ? null : ticker));
          },
          onContextLost: () => {
            made?.markContextLost();
            setWebgl("lost");
          },
          onInteract: () => (interactedAt.current = performance.now()),
        });
        sceneRef.current = made;
        snapNext.current = true;
        setWebgl("on");
      })
      .catch(() => {
        if (!gone) setWebgl("off");
      });
    return () => {
      gone = true;
      made?.dispose();
      if (sceneRef.current === made) sceneRef.current = null;
    };
  }, [ready, sceneTry]);

  // The stocks changed: lay the field out again (balloons already flying glide to their new places).
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || webgl !== "on") return;
    scene.setStocks(metadataRef.current, computeLayout(metadataRef.current));
    scene.setSelectedId(metadataRef.current.findIndex((m) => m.ticker === selectedRef.current));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-laid only when the signature changes, not on every minute's bars
  }, [signature, webgl]);
  useEffect(() => {
    sceneRef.current?.setSelectedId(idOf(selected));
  }, [selected, idOf, webgl]);
  useEffect(() => {
    if (webgl === "on") sceneRef.current?.resize(box.width, box.height, QUALITY[size].maxPixelRatio);
  }, [box, size, webgl]);
  // A stock that left the list can't stay selected.
  useEffect(() => {
    if (selected && feed && idOf(selected) < 0) setSelected(null);
  }, [selected, feed, idOf]);

  // --- The frame loop: runs only while on screen.
  const running = onScreen && !!source && (webgl === "on" || webgl === "off" || webgl === "lost");
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let last = performance.now();
    let lastDraw = 0;
    let lastPanel = 0;
    let lastClock = "";
    let lastSession = "";
    const began = last;
    // Back on screen after a pause: arrive, don't race to catch up.
    snapNext.current = true;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const data = sourceRef.current;
      const b = boundsRef.current;
      if (!data || !b) return;
      const scene = sceneRef.current;
      // A card idles at a lower frame rate and goes to full speed while it is being touched; the list needs very little.
      const fps = !scene
        ? 2
        : now - interactedAt.current < 1_500 || playingRef.current
          ? 60
          : QUALITY[sizeRef.current].idleFps;
      if (fps < 60 && now - lastDraw < 1000 / fps - 2) return;
      lastDraw = now;
      const dt = Math.min(0.1, Math.max(0.001, (now - last) / 1000));
      last = now;

      const end = liveCapableRef.current
        ? Math.min(Math.max(Date.now() + offset.current, b.startMs), b.endMs)
        : b.endMs;
      if (modeRef.current === "live") time.current = end;
      else if (playingRef.current) {
        time.current += dt * speed.current * 60_000;
        if (time.current >= end) {
          time.current = end;
          // Caught up with now: carry on Live. A finished day stops at its end.
          if (liveCapableRef.current) {
            modeRef.current = "live";
            setModeState("live");
          }
          playingRef.current = false;
          setPlayingState(false);
        }
      }
      const snapshot = data.getStateAtTime(time.current);
      if (scene) {
        scene.renderFrame(snapshot, dt, (now - began) / 1000, {
          reducedMotion: reducedMotion.current,
          snap: snapNext.current,
          weather: sky.current,
          labels: {
            budget: labelBudget(boxRef.current.width, boxRef.current.height, sizeRef.current !== "full"),
            textPx: labelTextPx(sizeRef.current, boxRef.current.width),
          },
        });
        snapNext.current = false;
      }

      const clock = formatEasternClock(snapshot.timeMs);
      if (clock !== lastClock) {
        lastClock = clock;
        if (clockText.current) clockText.current.textContent = clock;
      }
      if (snapshot.session !== lastSession) {
        lastSession = snapshot.session;
        if (sessionText.current) sessionText.current.textContent = SESSION_LABELS[snapshot.session];
      }
      if (slider.current && document.activeElement !== slider.current)
        slider.current.value = String(Math.round(snapshot.progress * 1000));
      if (fill.current) fill.current.style.width = `${(snapshot.progress * 100).toFixed(2)}%`;

      // The details and the list are React; twice a second is plenty.
      if (now - lastPanel > 480) {
        lastPanel = now;
        const id = metadataRef.current.findIndex((m) => m.ticker === selectedRef.current);
        setDetail(id >= 0 ? detailOf(snapshot.stocks[id]) : null);
        if (!scene)
          setRows(
            snapshot.stocks
              .map((s) => ({
                ticker: s.ticker,
                pctChange: s.hasTraded ? s.pctChange : null,
                volume: s.hasTraded ? s.cumVolume : null,
              }))
              .sort((a, b2) => (b2.volume ?? -1) - (a.volume ?? -1) || a.ticker.localeCompare(b2.ticker)),
          );
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running]);
  // A tap shows its details at once, not at the next half second.
  useEffect(() => {
    const id = idOf(selected);
    setDetail(
      id >= 0 && source
        ? detailOf(source.getStateAtTime(modeRef.current === "live" ? edge() : time.current).stocks[id])
        : null,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the selection changes
  }, [selected]);

  // For the browser test and for looking into a problem: what the scene is doing, with no cost to anyone else.
  useEffect(() => {
    const el = root.current as (HTMLDivElement & { __balloons?: unknown }) | null;
    if (!el) return;
    el.__balloons = {
      scene: () => sceneRef.current?.stats ?? null,
      time: () => time.current,
      mode: () => modeRef.current,
      where: (ticker: string) =>
        sceneRef.current?.screenPosition(metadataRef.current.findIndex((m) => m.ticker === ticker)) ?? null,
    };
    return () => {
      delete el.__balloons;
    };
  }, []);

  // --- The scrubber's sparkline (the full app only): the whole field's volume through the day.
  useEffect(() => {
    const canvas = spark.current;
    if (!canvas || !source || compact) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const profile = source.getActivityProfile(160);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = getComputedStyle(canvas).color;
    const barW = canvas.width / profile.length;
    profile.forEach((v, i) => {
      if (v <= 0.01) return;
      const h = Math.max(1.5, v * (canvas.height - 6));
      ctx.fillRect(i * barW, canvas.height - h, Math.max(1, barW - 0.5), h);
    });
  }, [source, compact]);

  // --- Search and legend (the full app only).
  const [legendOpen, setLegendOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const matches = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return [];
    const all = metadata.map((m) => m.ticker);
    return [
      ...all.filter((t) => t.startsWith(q)),
      ...all.filter((t) => !t.startsWith(q) && t.includes(q)),
    ].slice(0, 8);
  }, [query, metadata]);
  const jumpTo = useCallback(
    (ticker: string) => {
      setSelected(ticker);
      setSearchOpen(false);
      setQuery("");
      sceneRef.current?.setSelectedId(idOf(ticker));
      sceneRef.current?.focusOn(idOf(ticker), reducedMotion.current);
      root.current?.focus();
    },
    [idOf],
  );
  useEffect(() => {
    if (searchOpen) searchInput.current?.focus();
  }, [searchOpen]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const tag = target.tagName;
    const typing =
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      (tag === "INPUT" && (target as HTMLInputElement).type !== "range");
    if (event.key === "Escape") {
      if (searchOpen) setSearchOpen(false);
      else if (legendOpen) setLegendOpen(false);
      else if (selected) setSelected(null);
      else return;
      event.stopPropagation();
      return;
    }
    if (typing || event.metaKey || event.ctrlKey || event.altKey || !source) return;
    if (event.key === " " || event.code === "Space") {
      // A focused button or link takes the space itself.
      if (tag === "BUTTON" || tag === "A") return;
      event.preventDefault();
      event.stopPropagation();
      togglePlay();
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      // The scrubber moves itself with the arrows.
      if (tag === "INPUT") return;
      event.preventDefault();
      event.stopPropagation();
      step((event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 5 : 1));
    }
  };

  const dayLabel = day ? formatMarketDay(day) : "";
  const pastDay = !!feed && feed.day !== feed.today;
  const modeLabel = mode === "live" ? "Live" : liveCapable ? "Replay" : dayLabel;
  const w = weather.weather;
  const weatherButton = w && (
    <button
      type="button"
      className={styles.weather}
      onClick={weather.toggleUnit}
      data-balloons-weather={w.condition}
      data-balloons-weather-local={w.local || undefined}
      aria-label={`${CONDITION_LABELS[w.condition]}, ${formatTemp(w.tempC, weather.unit)}, ${w.local ? (w.place ?? "your weather") : "New York"}. Show °${weather.unit === "F" ? "C" : "F"}`}
      title={`${CONDITION_LABELS[w.condition]} · show °${weather.unit === "F" ? "C" : "F"}`}
    >
      <WeatherIcon condition={w.condition} night={w.night} size={compact ? 16 : 20} />
      <span data-balloons-temp>{formatTemp(w.tempC, weather.unit)}</span>
      {!compact && (
        <span className={styles.weatherPlace}>{w.local ? (w.place ?? "Your weather") : "New York"}</span>
      )}
    </button>
  );
  const liveButton = liveCapable && (
    <button
      type="button"
      className={styles.live}
      aria-pressed={mode === "live"}
      onClick={goLive}
      data-balloons-live
      title={mode === "live" ? "Following the market clock" : "Back to now"}
    >
      <span className={styles.liveDot} aria-hidden="true" />
      Live
    </button>
  );
  const range = (
    <div className={styles.track}>
      {!compact && (
        <>
          <span className={`${styles.band} ${styles.bandPre}`} title="Pre-market, 4:00 AM to 9:30 AM ET" />
          <span className={`${styles.band} ${styles.bandReg}`} title="Regular hours, 9:30 AM to 4:00 PM ET" />
          <span className={`${styles.band} ${styles.bandAfter}`} title="After hours, 4:00 PM to 8:00 PM ET" />
          <canvas ref={spark} className={styles.spark} width={320} height={36} aria-hidden="true" />
        </>
      )}
      <div ref={fill} className={styles.fill} />
      <input
        ref={slider}
        className={styles.slider}
        type="range"
        min={0}
        max={1000}
        step={1}
        defaultValue={0}
        aria-label={`Time of day${dayLabel ? `, ${dayLabel}` : ""}: 4:00 AM to 8:00 PM New York time`}
        onChange={(event) => scrubTo(Number(event.target.value) / 1000)}
        onPointerUp={(event) => (event.target as HTMLInputElement).blur()}
        data-balloons-scrubber
      />
    </div>
  );

  const panel = detail && (
    <aside
      className={styles.detail}
      aria-label={`${detail.ticker} details`}
      data-balloons-detail={detail.ticker}
    >
      <header>
        <span
          className={styles.swatch}
          data-unknown={!detail.floatKnown || undefined}
          style={detail.floatKnown ? { background: detail.colorHex } : undefined}
          aria-hidden="true"
        />
        <h3>{detail.ticker}</h3>
        <span className={styles.country}>{detail.country ?? DASH}</span>
        <button
          type="button"
          className={styles.close}
          onClick={() => setSelected(null)}
          aria-label={`Close ${detail.ticker} details`}
        >
          Close
        </button>
      </header>
      <dl>
        <div>
          <dt>Price</dt>
          <dd>{detail.hasTraded ? formatPrice(detail.price) : DASH}</dd>
        </div>
        <div>
          <dt>Change</dt>
          <dd
            data-direction={
              !detail.hasTraded
                ? undefined
                : detail.pctChange > 0.05
                  ? "up"
                  : detail.pctChange < -0.05
                    ? "down"
                    : undefined
            }
          >
            {detail.hasTraded ? formatPct(detail.pctChange) : DASH}
          </dd>
        </div>
        <div>
          <dt>Volume</dt>
          <dd>{detail.hasTraded ? formatCompactNumber(detail.cumVolume) : DASH}</dd>
        </div>
        <div>
          <dt>Float</dt>
          <dd>{formatCompactNumber(detail.floatShares)}</dd>
        </div>
        <div>
          <dt>Volume ÷ float</dt>
          <dd>{detail.floatKnown && detail.hasTraded ? formatRatio(detail.volumeToFloat) : DASH}</dd>
        </div>
        <div>
          <dt>Prev close</dt>
          <dd>{formatPrice(detail.prevClose)}</dd>
        </div>
      </dl>
      {!compact && (
        <p className={styles.note}>
          {[
            !detail.floatKnown && "Float not known: shown matte, with no stretch.",
            detail.floatKnown &&
              (detail.volumeToFloat ?? 0) >= 1 &&
              `Traded ${formatRatio(detail.volumeToFloat)} its float.`,
            detail.prevClose === null &&
              detail.hasTraded &&
              "No previous close: change is from the day’s first trade.",
            detail.liftLoss > 0.35
              ? `Losing lift after reaching ${formatPct(detail.peakPctChange)}.`
              : detail.burst > 0.25 && "A fresh burst of volume.",
          ]
            .filter(Boolean)
            .join(" ")}
        </p>
      )}
    </aside>
  );

  return (
    <div
      ref={root}
      className={styles.root}
      data-balloons={compact ? "card" : "app"}
      data-size={size}
      data-mode={mode}
      data-webgl={webgl}
      data-balloons-day={day ?? undefined}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        // A tap on the picture gives this component the keyboard (buttons and fields keep their own focus).
        if (!(event.target as HTMLElement).closest("button, a, input, select, textarea"))
          root.current?.focus({ preventScroll: true });
      }}
      role="group"
      aria-label="Gainer Balloons: the day’s gainers as balloons"
    >
      <div ref={stage} className={styles.stage} hidden={webgl !== "on"} />

      {status === "loading" && (
        <p className={styles.status} role="status">
          Loading the day’s gainers…
        </p>
      )}
      {status === "error" && (
        <p className={styles.status} role="status" data-balloons-error>
          The balloons can’t be loaded right now. They’ll try again shortly.
        </p>
      )}
      {empty && (
        <p className={styles.status} role="status" data-balloons-empty>
          No gainers yet today. Balloons appear here as stocks start to move.
        </p>
      )}

      {(webgl === "off" || webgl === "lost") && !empty && (
        <div className={styles.list} data-balloons-list>
          {webgl === "lost" && (
            <p>
              The picture was paused by your browser.{" "}
              <button
                type="button"
                onClick={() => {
                  setWebgl("pending");
                  setSceneTry((n) => n + 1);
                }}
              >
                Show the balloons again
              </button>
            </p>
          )}
          <table>
            <thead>
              <tr>
                <th scope="col">Ticker</th>
                <th scope="col">Change</th>
                <th scope="col">Volume</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.ticker} data-balloons-row={row.ticker}>
                  <th scope="row">{row.ticker}</th>
                  <td
                    data-direction={
                      row.pctChange === null
                        ? undefined
                        : row.pctChange > 0.05
                          ? "up"
                          : row.pctChange < -0.05
                            ? "down"
                            : undefined
                    }
                  >
                    {formatPct(row.pctChange)}
                  </td>
                  <td>{formatCompactNumber(row.volume)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {source && !compact && (
        <>
          <header className={styles.top}>
            <div className={styles.brand}>
              <h2>Gainer Balloons</h2>
              <p className={styles.clockRow}>
                <span ref={clockText} className={styles.clock} data-balloons-clock />
                <span ref={sessionText} className={styles.session} />
                <span className={styles.date} data-balloons-date>
                  {dayLabel}
                </span>
              </p>
              {pastDay && <p className={styles.dayNote}>Most recent trading day</p>}
              <div className={styles.weatherRow}>
                {weatherButton}
                {weather.local ? (
                  <button
                    type="button"
                    className={styles.link}
                    onClick={weather.chooseNewYork}
                    data-balloons-weather-off
                  >
                    Use New York weather
                  </button>
                ) : (
                  <button
                    type="button"
                    className={styles.link}
                    onClick={weather.chooseLocal}
                    data-balloons-weather-local-button
                  >
                    Use my local weather
                  </button>
                )}
              </div>
              {weather.note && (
                <p className={styles.dayNote} role="status" data-balloons-weather-note>
                  {weather.note}
                </p>
              )}
            </div>
            <div className={styles.actions}>
              <div className={styles.search}>
                <button
                  type="button"
                  className={styles.pill}
                  aria-expanded={searchOpen}
                  onClick={() => setSearchOpen((open) => !open)}
                  data-balloons-search-button
                >
                  Find a ticker
                </button>
                {searchOpen && (
                  <div className={styles.searchBox}>
                    <input
                      ref={searchInput}
                      type="text"
                      inputMode="text"
                      autoCapitalize="characters"
                      autoComplete="off"
                      spellCheck={false}
                      maxLength={10}
                      placeholder="Ticker"
                      aria-label="Find a ticker"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && matches[0]) jumpTo(matches[0]);
                      }}
                      data-balloons-search
                    />
                    {query.trim() && (
                      <ul>
                        {matches.map((ticker) => (
                          <li key={ticker}>
                            <button type="button" onClick={() => jumpTo(ticker)} data-balloons-match={ticker}>
                              {ticker}
                            </button>
                          </li>
                        ))}
                        {matches.length === 0 && (
                          <li className={styles.noMatch}>Not among the day’s gainers</li>
                        )}
                      </ul>
                    )}
                  </div>
                )}
              </div>
              {webgl === "on" && (
                <button
                  type="button"
                  className={styles.pill}
                  onClick={() => sceneRef.current?.resetCamera(reducedMotion.current)}
                  data-balloons-reset
                >
                  Reset view
                </button>
              )}
              <button
                type="button"
                className={styles.pill}
                aria-expanded={legendOpen}
                onClick={() => setLegendOpen((open) => !open)}
                data-balloons-legend-button
              >
                Legend
              </button>
            </div>
          </header>

          {legendOpen && (
            <section className={styles.legend} aria-label="How to read the balloons" data-balloons-legend>
              <header>
                <h3>How to read the balloons</h3>
                <button
                  type="button"
                  className={styles.close}
                  onClick={() => setLegendOpen(false)}
                  aria-label="Close legend"
                >
                  Close
                </button>
              </header>
              <ul>
                <li>
                  <strong>Size</strong>
                  <span>
                    Shares traded so far today, on a log scale: 400K and 80M both fit in one picture.
                  </span>
                </li>
                <li>
                  <strong>Stretch</strong>
                  <span>
                    Volume ÷ float. Past 1× its float a balloon pulls taut and glossy. The country sets how
                    far it can stretch: China / Hong Kong the most, other non-U.S. next, the U.S. the least.
                  </span>
                </li>
                <li>
                  <strong>Height</strong>
                  <span>Percent change from the previous close. The dashed ring is 0%.</span>
                </li>
                <li>
                  <strong>Movement</strong>
                  <span>
                    Lower floats are lighter: they drift wider and react faster. A ring spreading from a
                    balloon is a burst of volume. A balloon sinking and leaning on a slack string is a price
                    falling back.
                  </span>
                </li>
                <li>
                  <strong>Matte</strong>
                  <span>
                    A frosted, matte balloon with a hollow dot: float not known, so no stretch is shown.
                  </span>
                </li>
                <li>
                  <strong>Sky</strong>
                  <span>
                    The time of day follows New York, the market’s clock. The weather is yours, or New York’s.
                  </span>
                </li>
              </ul>
              <p className={styles.chips}>
                <span>
                  <i style={{ background: "#d85745" }} />
                  China / HK
                </span>
                <span>
                  <i style={{ background: "#d89336" }} />
                  Other non-U.S.
                </span>
                <span>
                  <i style={{ background: "#4f7eb8" }} />
                  U.S.
                </span>
                <span>
                  <i data-unknown />
                  Float not known
                </span>
              </p>
              <p className={styles.keys}>
                <kbd>Space</kbd> play or pause · <kbd>←</kbd> <kbd>→</kbd> 2 minutes · <kbd>Esc</kbd> close
              </p>
              <p className={styles.keys}>A picture of volume and price. It is not advice.</p>
            </section>
          )}

          {/* On a narrow screen the details sit directly on top of the timeline (one stack); wider, each has its own corner. */}
          <div className={styles.dock}>
            {panel}
            <footer className={styles.bottom}>
              <div className={styles.controls}>
                <div className={styles.group}>
                  <button
                    type="button"
                    className={styles.ctrl}
                    onClick={() => step(-1)}
                    aria-label="Back 2 minutes"
                    title="Back 2 minutes (left arrow)"
                  >
                    −2m
                  </button>
                  <button
                    type="button"
                    className={`${styles.ctrl} ${styles.primary}`}
                    onClick={togglePlay}
                    data-balloons-play
                  >
                    {mode === "live" || playing ? "Pause" : "Play"}
                  </button>
                  <button
                    type="button"
                    className={styles.ctrl}
                    onClick={() => step(1)}
                    aria-label="Forward 2 minutes"
                    title="Forward 2 minutes (right arrow)"
                  >
                    +2m
                  </button>
                </div>
                <div
                  className={styles.group}
                  role="group"
                  aria-label="Replay speed, market minutes per second"
                >
                  {PLAYBACK_SPEEDS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={styles.ctrl}
                      aria-pressed={speedId === option.id}
                      onClick={() => {
                        setSpeedId(option.id);
                        speed.current = option.minutesPerSec;
                      }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                {liveButton}
                <span className={styles.modeNote} data-balloons-mode>
                  {modeLabel}
                </span>
              </div>
              {range}
              <div className={styles.axis} aria-hidden="true">
                <span style={{ left: "0%" }}>4:00 AM</span>
                <span style={{ left: "34.375%" }}>9:30 AM</span>
                <span style={{ left: "50%" }}>12:00 PM</span>
                <span style={{ left: "75%" }}>4:00 PM</span>
                <span style={{ left: "100%" }}>8:00 PM</span>
              </div>
            </footer>
          </div>
        </>
      )}

      {source && compact && (
        <>
          <div className={styles.cardTop}>
            <span className={styles.chip}>
              <span ref={clockText} className={styles.clock} data-balloons-clock />
              {liveCapable ? (
                liveButton
              ) : (
                <span className={styles.date} data-balloons-date>
                  {dayLabel}
                </span>
              )}
            </span>
            {weatherButton}
            <a
              className={styles.open}
              href="/chat?page=balloons"
              target="_blank"
              rel="noopener"
              aria-label="Open Gainer Balloons full size"
              title="Open full size"
              data-balloons-open
            >
              Open ↗
            </a>
          </div>
          {panel}
          {scrubber && <div className={styles.cardBottom}>{range}</div>}
        </>
      )}
    </div>
  );
}
