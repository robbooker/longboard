"use client";
// #379 Six view: six cards, three across and two down, to fill a monitor. Each card is a type from
// the registry (lib/chatCards.ts) drawn by its component (cards/cardComponents.tsx): a room, a DM
// or the Gainers Table today. The layout is saved per member on the server (/api/chat/card-layout)
// and copied in this browser, which is what Six falls back to if the server copy can't be read.
// Rooms and DMs render exactly as in Quad (the same PublicChat pane).
// #470/#474: on a computer each card can be resized by dragging the edge between it and the card
// beside it (SixCardEdge). Each row has its own edges and widths, so the card above or below stays
// as it is. The widths are saved with the layout and "Reset widths" makes every card even again.
// #494: the notification bell sits at the top right of the toolbar, as in the single chat. It is the
// same bell on the same activity (read here once; the cards share it), so reading a notification
// here clears it everywhere and the other way round.
import type { CSSProperties } from "react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ChatUpdatesProvider, useChatUpdates, useChatIdentity } from "./ChatUpdates";
import type { PublicChatProps } from "./PublicChat";
import SkipLatestButton from "./SkipLatestButton";
import ChatProfileSettings from "./ChatProfileSettings";
import ChatAppControls from "./ChatAppControls";
import ChatRadio from "./ChatRadio";
import ChatActivityBell from "./ChatActivityBell";
import { ChatActivityProvider, useSharedChatActivity } from "./ChatActivityContext";
import { useDmSound } from "./hooks/useDmSound";
import { CARD_COMPONENTS } from "./cards/cardComponents";
import { isChatAppId } from "@/lib/chatApps";
import {
  SIX_COLUMNS,
  isEvenSixWidths,
  parseSixWidths,
  sixRowTemplate,
  sixRowWidths,
  sixWidthsStorageKey,
  withSixRow,
  type SixRowWidths,
  type SixWidths,
} from "@/lib/chatSixWidths";
import SixCardEdge from "./SixCardEdge";
import {
  CARD_DEFINITIONS,
  SIX_SLOTS,
  availableCardTypes,
  cardKey,
  cardSource,
  defaultSixLayout,
  validateCardLayout,
  type CardLayout,
  type CardOptions,
  type CardSlot,
  type CardType,
} from "@/lib/chatCards";
import type { DirectConversation } from "@/lib/chatDirectMessages";
import type { ChatRoom } from "@/lib/publicChat";
import quad from "./QuadChat.module.css";
import { useChatTheme } from "./room/useChatTheme";
import publicStyles from "./PublicChat.module.css";
import styles from "./SixChat.module.css";

const EMPTY: CardLayout = Array(SIX_SLOTS).fill(null);

/** #494: the single chat's bell, on the Six view's shared activity. */
function SixBell({ productUpdates }: { productUpdates: boolean }) {
  const activity = useSharedChatActivity();
  return (
    <div className={styles.bell} data-six-bell>
      <ChatActivityBell
        data={activity.data}
        error={activity.error}
        read={activity.read}
        productUpdates={productUpdates}
      />
    </div>
  );
}

function CardPicker({
  index,
  current,
  options,
  layout,
  onApply,
  onClose,
}: {
  index: number;
  current: CardSlot | null;
  options: CardOptions;
  layout: CardLayout;
  onApply: (slot: CardSlot) => void;
  onClose: () => void;
}) {
  const id = useId();
  const types = availableCardTypes(options);
  const [type, setType] = useState<CardType>(current?.type ?? types[0]?.type ?? "room");
  const definition = CARD_DEFINITIONS[type];
  const taken = new Set(layout.flatMap((slot, i) => (slot && i !== index ? [cardKey(slot)] : [])));
  const sources = definition.sources(options).map((s) => ({
    ...s,
    taken: !definition.allowDuplicates && taken.has(cardKey({ type, source: s.source })),
  }));
  const firstFree = sources.find((s) => !s.taken)?.source ?? "";
  const [source, setSource] = useState(current?.source ?? firstFree);
  const chosen = sources.find((s) => s.source === source && !s.taken);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.querySelector<HTMLInputElement>("input:checked, input")?.focus();
  }, []);
  return (
    <div
      ref={panel}
      className={styles.picker}
      role="dialog"
      aria-labelledby={`${id}-title`}
      data-card-picker
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (chosen) onApply({ type, source: chosen.source });
        }}
      >
        <h3 id={`${id}-title`}>Card {index + 1}: what should it show?</h3>
        <fieldset>
          <legend>Card type</legend>
          {types.map((t) => (
            <label key={t.type} className={styles.typeOption}>
              <input
                type="radio"
                name={`${id}-type`}
                value={t.type}
                checked={type === t.type}
                onChange={() => {
                  setType(t.type);
                  const next = t.sources(options).find(
                    (s) => t.allowDuplicates || !taken.has(cardKey({ type: t.type, source: s.source })),
                  );
                  setSource(next?.source ?? "");
                }}
              />
              <span>
                <strong>{t.label}</strong>
                <small>{t.description}</small>
              </span>
            </label>
          ))}
        </fieldset>
        {definition.hasSource && (
          <label className={styles.sourceLabel}>
            {type === "room" || type === "video" ? "Room" : type === "dm" ? "Conversation" : type === "app" ? "App" : "Show"}
            <select value={source} onChange={(e) => setSource(e.target.value)}>
              {!chosen && <option value="">Choose…</option>}
              {sources.map((s) => (
                <option key={s.source} value={s.source} disabled={s.taken}>
                  {type === "room" ? "# " : ""}
                  {s.label}
                  {s.taken ? " (on another card)" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        {!chosen && (
          <p className={styles.pickerNote} role="status">
            {definition.hasSource ? "Everything of this type is already on a card." : "Already on another card."}
          </p>
        )}
        <div className={styles.pickerActions}>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={!chosen} className={styles.primary}>
            Show on card {index + 1}
          </button>
        </div>
      </form>
    </div>
  );
}

function SixContents(props: PublicChatProps) {
  // #407: the same app-wide theme as the single chat; the toolbar, card headers and every card follow it.
  const { theme, palette } = useChatTheme(props.initialTheme, props.accountId);
  const updates = useChatUpdates()!;
  const identity = useChatIdentity();
  const member =
    identity &&
    identity.accountId === props.accountId &&
    identity.member &&
    identity.member.id === props.bootstrap?.member?.id
      ? identity.member
      : props.bootstrap?.member;
  const [options, setOptions] = useState<CardOptions | null>(null),
    [layout, setLayout] = useState<CardLayout>(EMPTY),
    [widths, setWidths] = useState<SixWidths | null>(null);
  const layoutNow = useRef(layout),
    widthsNow = useRef(widths),
    widthsTimer = useRef(0);
  layoutNow.current = layout;
  widthsNow.current = widths;
  const [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [mobile, setMobile] = useState(false),
    [active, setActive] = useState(0),
    [picking, setPicking] = useState<number | null>(null);
  const restored = useRef(false),
    saves = useRef(0),
    root = useRef<HTMLDivElement>(null),
    changeButtons = useRef<Array<HTMLButtonElement | null>>([]);
  const observedNames = useRef(new Map<string, string>());
  const [skipHandlers, setSkipHandlers] = useState<Array<(() => void) | null>>(Array(SIX_SLOTS).fill(null));
  const registerSkip = useMemo(
    () =>
      Array.from(
        { length: SIX_SLOTS },
        (_, index) => (handler: (() => void) | null) =>
          setSkipHandlers((current) => current.map((value, i) => (i === index ? handler : value))),
      ),
    [],
  );
  const storageKey = `rb-chat-six-v1:${props.accountId}`,
    quadKey = `rb-chat-quad-v1:${props.accountId}`,
    widthsKey = sixWidthsStorageKey(props.accountId);
  const { observe } = useDmSound(props.bootstrap!.member!.id);
  useEffect(() => {
    const media = matchMedia("(max-width:760px)");
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  /**
   * First open: the server's copy, else this browser's, else a start built from Quad's layout.
   * #470: the card widths come the same way (the server's when it has the account's row and knows
   * about widths, else this browser's copy); none saved means even. #474: a #470 save (three column
   * widths) is read as the same widths for both rows.
   */
  const restore = useCallback(
    async (next: CardOptions): Promise<{ layout: CardLayout; widths: SixWidths | null }> => {
      const local = (key: string) => {
        try {
          return JSON.parse(localStorage.getItem(key) || "null") as unknown;
        } catch {
          return null;
        }
      };
      let saved: unknown = null,
        serverRead = false,
        savedWidths: unknown = undefined;
      try {
        const response = await fetch("/api/chat/card-layout?view=six", { cache: "no-store" });
        if (response.ok) {
          const body = (await response.json()) as { layout: unknown; saved: boolean; widths?: unknown };
          serverRead = true;
          if (body.saved) saved = body.layout;
          if (body.saved && "widths" in body) savedWidths = body.widths;
        }
      } catch {}
      if (!saved) saved = local(storageKey);
      if (savedWidths === undefined) savedWidths = local(widthsKey);
      if (!serverRead && saved) setNotice("Your saved layout couldn't be read from the server; showing this browser's copy.");
      return {
        layout: saved ? validateCardLayout(saved, next) : defaultSixLayout(local(quadKey), next),
        widths: parseSixWidths(savedWidths),
      };
    },
    [storageKey, quadKey, widthsKey],
  );

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/api/chat/quad-options", { cache: "no-store" });
        if (response.status === 401 || response.status === 403) {
          setOptions(null);
          setLayout(EMPTY);
          window.location.replace("/chat/login");
          return;
        }
        if (!response.ok) throw Error("Could not refresh conversations. Try again shortly.");
        const data = (await response.json()) as {
          accountId: string;
          rooms: ChatRoom[];
          conversations: DirectConversation[];
          gainersTable?: boolean;
          apps?: string[];
          /** #506: live video is set up, so a card may show a room's live video. */
          stageVideo?: boolean;
        };
        if (cancelled) return;
        if (data.accountId !== props.accountId) {
          setOptions(null);
          window.location.reload();
          return;
        }
        const conversations = data.conversations ?? [];
        const namesChanged = conversations.some(
          (row) =>
            observedNames.current.has(row.otherId) && observedNames.current.get(row.otherId) !== row.otherName,
        );
        observedNames.current = new Map(conversations.map((row) => [row.otherId, row.otherName]));
        if (namesChanged)
          window.dispatchEvent(
            new CustomEvent("chat-peer-names-changed", { detail: { memberId: props.bootstrap?.member?.id } }),
          );
        const next: CardOptions = {
          rooms: data.rooms,
          conversations,
          gainersTable: !!data.gainersTable,
          apps: (data.apps ?? []).filter(isChatAppId),
          stageVideo: !!data.stageVideo,
        };
        observe(conversations);
        if (!restored.current) {
          restored.current = true;
          const first = await restore(next);
          if (cancelled) return;
          setLayout(first.layout);
          setWidths(first.widths);
        } else setLayout((current) => validateCardLayout(current, next));
        setOptions(next);
        setReady(true);
        setError("");
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Conversations unavailable.");
      }
    };
    const stop = updates.watch(load, ["inbox"], false, 15000, 60000, "direct");
    return () => {
      cancelled = true;
      stop();
    };
  }, [updates, props.accountId, props.bootstrap?.member?.id, observe, restore]);

  // This browser's copy follows every change, including access refreshes that empty a card.
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(layout));
    } catch {}
  }, [layout, ready, storageKey]);

  // #470: and the card widths (removed when they're even).
  useEffect(() => {
    if (!ready) return;
    try {
      if (widths) localStorage.setItem(widthsKey, JSON.stringify(widths));
      else localStorage.removeItem(widthsKey);
    } catch {}
  }, [widths, ready, widthsKey]);
  useEffect(() => () => clearTimeout(widthsTimer.current), []);

  /**
   * #470/#474: new card widths (null: even). They show at once; the account copy is saved when a
   * drag ends, or after a short pause in arrow key presses, with the cards as they are (so an account
   * with nothing saved yet gets a whole row). A failed save leaves this browser's copy.
   */
  const changeWidths = useCallback((next: SixWidths | null, delay: number) => {
    widthsNow.current = next;
    setWidths(next);
    clearTimeout(widthsTimer.current);
    widthsTimer.current = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/chat/card-layout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ view: "six", layout: layoutNow.current, widths: next }),
        });
        if (!response.ok) throw Error();
      } catch {
        setNotice("Card widths are saved in this browser only; the server copy couldn't be updated.");
      }
    }, delay);
  }, []);
  /** One row's cards changed (the other row keeps its widths). */
  const onEdgeChange = useCallback(
    (row: number, shares: SixRowWidths, how: "drag" | "key") =>
      changeWidths(withSixRow(widthsNow.current, row, shares), how === "drag" ? 0 : 600),
    [changeWidths],
  );

  /** The member changed a card: save on the server, which checks it and sends back what it kept. */
  const save = useCallback(async (next: CardLayout) => {
    const attempt = ++saves.current;
    try {
      const response = await fetch("/api/chat/card-layout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ view: "six", layout: next }),
      });
      if (!response.ok) throw Error();
      const body = (await response.json()) as { layout: CardLayout };
      if (attempt !== saves.current) return;
      if (JSON.stringify(body.layout) !== JSON.stringify(next)) {
        setLayout(body.layout);
        setNotice("A card you chose isn't available to you, so it was cleared.");
      }
    } catch {
      if (attempt === saves.current) setNotice("Saved in this browser only; the server copy couldn't be updated.");
    }
  }, []);

  const guard = useCallback(() => {
    if (root.current?.querySelector("dialog[open]")) {
      setNotice("Close the open dialog before changing cards.");
      return false;
    }
    const event = new Event("chat-before-refresh", { cancelable: true });
    window.dispatchEvent(event);
    if (event.defaultPrevented) {
      setNotice("Finish sending or remove pending attachments before changing cards.");
      return false;
    }
    return true;
  }, []);

  function change(index: number, slot: CardSlot | null) {
    if (!options || !guard()) return false;
    setNotice("");
    const next = validateCardLayout(
      layout.map((v, i) => (i === index ? slot : v)),
      options,
    );
    setLayout(next);
    void save(next);
    return true;
  }
  function closePicker(index: number) {
    setPicking(null);
    requestAnimationFrame(() => changeButtons.current[index]?.focus());
  }

  /**
   * #494: a DM notification (the bell dispatches chat-open-dm, as in the single chat). A card already
   * showing that conversation comes to the front; otherwise the single chat opens it.
   */
  const layoutRef = useRef(layout),
    guardRef = useRef(guard);
  layoutRef.current = layout;
  guardRef.current = guard;
  useEffect(() => {
    const openDm = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (!id) return;
      const index = layoutRef.current.findIndex((slot) => slot?.type === "dm" && slot.source === id);
      if (index >= 0) {
        setActive(index);
        requestAnimationFrame(() => {
          const card = root.current?.querySelector<HTMLElement>(`section[data-card="${index + 1}"]`);
          card?.scrollIntoView({ block: "nearest" });
          card?.querySelector<HTMLElement>("textarea")?.focus({ preventScroll: true });
        });
      } else if (guardRef.current()) window.location.href = `/chat?dm=${encodeURIComponent(id)}`;
    };
    window.addEventListener("chat-open-dm", openDm);
    return () => window.removeEventListener("chat-open-dm", openDm);
  }, []);

  const allowedRooms = options?.rooms ?? [];
  return (
    <ChatActivityProvider memberId={member?.id}>
    <div
      className={`${publicStyles.themeScope} ${quad.page} ${styles.page}`}
      data-theme={theme}
      data-palette={palette}
      ref={root}
      data-six-view
    >
      <ChatProfileSettings accountId={props.accountId} member={member ?? null} />
      <ChatAppControls version={props.appVersion ?? "development"} />
      <header className={quad.toolbar}>
        <a
          href="/chat"
          onClick={(e) => {
            if (!guard()) e.preventDefault();
          }}
        >
          ← Single chat
        </a>
        <h1>Six view</h1>
        {/* #415: a pause marker while Trader Radio plays and no Gainers card is on screen. */}
        {!layout.some((slot, index) => (mobile ? index === active : true) && slot?.type === "room" && slot.source === "gainers") && (
          <ChatRadio shape="pill" />
        )}
        <nav className={styles.viewSwitch} aria-label="Multi-card view">
          <a
            href="/chat/quad"
            onClick={(e) => {
              if (!guard()) e.preventDefault();
            }}
          >
            Quad
          </a>
          <a href="/chat/six" aria-current="page">
            Six
          </a>
        </nav>
        {/* #470: computers only (the CSS hides it on narrower windows, which have no card edges). */}
        <button
          className={styles.resetWidths}
          data-six-reset
          disabled={!ready || isEvenSixWidths(widths)}
          title="Put every card back to the same width"
          onClick={() => changeWidths(null, 0)}
        >
          Reset widths
        </button>
        {/* #420: themes and colours are in Profile settings (its Look section). */}
        <button onClick={() => window.dispatchEvent(new Event("chat-open-profile-settings"))}>Profile settings</button>
        <button
          onClick={() => {
            if (guard()) window.dispatchEvent(new Event("chat-refresh-app"));
          }}
        >
          Refresh app
        </button>
        {member && <SixBell productUpdates={!!props.bootstrap?.featureChannel} />}
      </header>
      {(error || notice) && (
        <p className={quad.notice} role="status">
          {error || notice}
        </p>
      )}
      <nav className={quad.tabs} aria-label="Choose visible card">
        {layout.map((slot, i) => (
          <button key={i} aria-pressed={active === i} onClick={() => setActive(i)}>
            {(slot && options && cardSource(slot, options)?.label) || `Card ${i + 1}`}
          </button>
        ))}
      </nav>
      {!ready || !options ? (
        <p role="status">{error || "Loading your cards…"}</p>
      ) : (
        <div className={styles.grid}>
          {/* #474: each row is its own grid on a computer, with its own edges and widths. Narrower
              windows and phones don't see the rows (display: contents), so the cards flow as before. */}
          {([0, 1] as const).map((row) => (
            <div
              key={row}
              className={styles.row}
              data-six-row={row + 1}
              style={{ "--six-row": sixRowTemplate(sixRowWidths(widths, row)) } as CSSProperties}
            >
              <SixCardEdge row={row} edge={1} onChange={onEdgeChange} />
              <SixCardEdge row={row} edge={2} onChange={onEdgeChange} />
              {layout.slice(row * SIX_COLUMNS, (row + 1) * SIX_COLUMNS).map((slot, column) => {
                const index = row * SIX_COLUMNS + column;
                const source = slot ? cardSource(slot, options) : null;
                const definition = slot ? CARD_DEFINITIONS[slot.type] : null;
                const component = slot ? CARD_COMPONENTS[slot.type] : null;
                const title = source?.label ?? "Empty card";
                const visible = mobile ? index === active : true;
                const headingId = `six-card-${index}-title`;
                return (
                  <section
                    key={index}
                    className={quad.pane}
                    onFocusCapture={() => setActive(index)}
                    onPointerDownCapture={() => setActive(index)}
                    onWheelCapture={() => setActive(index)}
                    onTouchStartCapture={() => setActive(index)}
                    hidden={!visible}
                    aria-labelledby={headingId}
                    data-card={index + 1}
                    data-card-type={slot?.type ?? ""}
                  >
                    <header className={`${quad.paneHeader} ${styles.cardHeader}`}>
                      <h2 id={headingId} className={styles.cardTitle}>
                        <span className={quad.srOnly}>Card {index + 1}: </span>
                        {definition && (slot?.type === "room" || slot?.type === "dm") && (
                          <span className={styles.cardKind}>{slot?.type === "room" ? "#" : "DM"}</span>
                        )}
                        {title}
                      </h2>
                      {slot?.type === "room" && slot.source === "gainers" && <ChatRadio room shape="pane" />}
                      {component?.skipLatest && (
                        <SkipLatestButton
                          disabled={!skipHandlers[index]}
                          onClick={() => skipHandlers[index]?.()}
                        />
                      )}
                      <button
                        ref={(node) => {
                          changeButtons.current[index] = node;
                        }}
                        className={styles.headerButton}
                        aria-expanded={picking === index}
                        aria-label={slot ? `Change card ${index + 1}` : `Choose card ${index + 1}`}
                        onClick={() => setPicking(picking === index ? null : index)}
                      >
                        {slot ? "Change" : "Choose"}
                      </button>
                      {slot && (
                        <button
                          className={styles.headerButton}
                          aria-label={`Remove card ${index + 1}`}
                          title="Remove card"
                          onClick={() => change(index, null)}
                        >
                          ✕
                        </button>
                      )}
                    </header>
                    <div className={quad.body}>
                      {picking === index && (
                        <CardPicker
                          index={index}
                          current={slot}
                          options={options}
                          layout={layout}
                          onClose={() => closePicker(index)}
                          onApply={(next) => {
                            if (change(index, next)) closePicker(index);
                          }}
                        />
                      )}
                      {slot && source && component ? (
                        <component.Body
                          key={cardKey(slot)}
                          type={slot.type}
                          source={slot.source}
                          visible={visible}
                          active={active === index}
                          chat={props}
                          allowedRooms={allowedRooms}
                          onSkipLatest={registerSkip[index]}
                          onPrivateMessage={(otherId) => {
                            const dm = CARD_DEFINITIONS.dm
                              .sources(options)
                              .find((s) => s.otherId === otherId);
                            if (!dm)
                              return setNotice(
                                "Start a new DM in Single chat; it will then appear in the picker.",
                              );
                            const existing = layout.findIndex(
                              (c) => c?.type === "dm" && c.source === dm.source,
                            );
                            if (existing >= 0) setActive(existing);
                            else change(index, { type: "dm", source: dm.source });
                          }}
                        />
                      ) : (
                        picking !== index && (
                          <div className={quad.empty}>
                            Choose what this card shows: a room, a DM, the Gainers Table, the News Feed or an
                            app like the Reader.
                            <small>Only things you can access appear in the picker.</small>
                          </div>
                        )
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
    </ChatActivityProvider>
  );
}

export default function SixChat(props: PublicChatProps) {
  return (
    <ChatUpdatesProvider
      accountId={props.accountId}
      room={props.room}
      rooms={props.allowedRooms}
      serverSession={!!props.serverSession}
      pollingRoom
    >
      <SixContents {...props} />
    </ChatUpdatesProvider>
  );
}
