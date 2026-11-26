"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { recordingVideoFromUrl, type RecordingVideo } from "@/lib/chatRecordingVideos";
import { thumbnailUrl, watchUrl, type PicksArea, type PicksVideo } from "@/lib/videoPicksFeed";
import {
  DEFAULT_FILTER,
  effectiveScore,
  hideVideo,
  loadPicksState,
  picksWeights,
  relativeDay,
  restoreAllHidden,
  savePicksState,
  setWatched,
  toggleLike,
  unhideVideo,
  type PicksFilter,
  type PicksState,
} from "@/lib/videoPicksState";
import { RecordingVideoCard } from "../ChatRecordingVideos";
import styles from "./VideoPicksPage.module.css";

// #529 Booker Tube: a calm front page of public YouTube videos, in place of the room. One lead
// pick, a row per area, then everything newest first; filters, search and sort; and each card
// says in a few words why it is here.
//  - A video plays in place in the chat's own click-to-play card (#513): the player is asked of
//    YouTube's privacy-enhanced address only after a press, one at a time, and nothing plays next.
//  - "More like this", "Not for me" and watched are kept in this browser only (lib/videoPicksState).
//  - Colours and fonts are the chat's own tokens, so the page follows whichever look the member chose.
// Loaded only when the page is opened (ChatPageView), so the chat itself carries none of it.

type Topic = { id: string; area: string; label: string };
type Answer = {
  title: string;
  updatedAt: string | null;
  windowDays: number;
  areas: PicksArea[];
  topics: Topic[];
  videos: PicksVideo[];
  canManage: boolean;
};
type Load = { kind: "loading" } | { kind: "error" } | { kind: "ready"; data: Answer };
type Toast = { id: number; text: string; undo?: string };

const PICKS_PER_AREA = 3;
const TOAST_MS = 5500;
const FALLBACK_REASON = "Curated pick";

async function send(url: string, method: string, body?: unknown) {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      typeof data?.error === "string" && data.error.includes(" ")
        ? data.error
        : "That didn't work. Please try again.",
    );
  return data;
}

export default function VideoPicksPage() {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/chat/video-picks", { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("unavailable"))))
      .then((data: Answer) => {
        if (!Array.isArray(data?.videos)) throw new Error("unavailable");
        setLoad({
          kind: "ready",
          data: {
            ...data,
            areas: data.areas ?? [],
            topics: data.topics ?? [],
            canManage: data.canManage === true,
          },
        });
      })
      .catch(() => {
        // A failed re-read (after an admin change) keeps what is on screen.
        if (!controller.signal.aborted)
          setLoad((current) => (current.kind === "ready" ? current : { kind: "error" }));
      });
    return () => controller.abort();
  }, [version]);
  const reload = useCallback(() => setVersion((value) => value + 1), []);
  if (load.kind !== "ready")
    return (
      <div className={styles.picks} data-video-picks={load.kind}>
        <div className={styles.inner}>
          <p className={styles.empty} role="status">
            {load.kind === "loading"
              ? "Loading today’s picks…"
              : "The picks couldn’t be loaded. Please try again in a moment."}
          </p>
        </div>
      </div>
    );
  return <Picks data={load.data} onChanged={reload} />;
}

function Picks({ data, onChanged }: { data: Answer; onChanged: () => void }) {
  const [state, setState] = useState<PicksState>(loadPicksState);
  // What the order is worked out from. It stands still while a video plays, so pressing play,
  // "More like this" or "Watched" never moves the card (and its player) under the member.
  const [ranking, setRanking] = useState(state);
  const [playing, setPlaying] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const top = useRef<HTMLDivElement>(null);
  const update = useCallback((change: (current: PicksState) => PicksState) => {
    setState((current) => {
      const next = change(current);
      if (next !== current) savePicksState(next);
      return next;
    });
  }, []);
  useEffect(() => {
    if (!playing) setRanking(state);
  }, [playing, state]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(
      () => setToast((current) => (current?.id === toast.id ? null : current)),
      TOAST_MS,
    );
    return () => clearTimeout(timer);
  }, [toast]);
  // The browser tab is named for the page while it is open (a pop-out window names itself, #438).
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("popout") === "1") return;
    const before = document.title;
    const apply = () => {
      if (document.title !== data.title) document.title = data.title;
    };
    apply();
    // The app's own metadata can put its title back when the address changes.
    const watch = new MutationObserver(apply);
    watch.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => {
      watch.disconnect();
      document.title = before;
    };
  }, [data.title]);
  const say = useCallback(
    (text: string, undo?: string) => setToast({ id: Date.now() + Math.random(), text, undo }),
    [],
  );

  const topicsById = useMemo(() => new Map(data.topics.map((topic) => [topic.id, topic])), [data.topics]);
  const filter = useMemo<PicksFilter>(() => {
    // A remembered area or topic that the collection no longer has falls back to "all".
    const area =
      state.filter.area !== "all" && data.areas.some((item) => item.id === state.filter.area)
        ? state.filter.area
        : "all";
    const topic = topicsById.get(state.filter.topic);
    return {
      ...state.filter,
      area,
      topic: topic && (area === "all" || topic.area === area) ? topic.id : "all",
    };
  }, [state.filter, data.areas, topicsById]);
  const setFilter = useCallback(
    (change: Partial<PicksFilter>) =>
      update((current) => ({ ...current, filter: { ...current.filter, ...change } })),
    [update],
  );
  const frontPage =
    filter.area === "all" && filter.topic === "all" && !filter.query.trim() && filter.sort === "best";

  const visible = useMemo(
    () => data.videos.filter((video) => !state.hidden[video.id]),
    [data.videos, state.hidden],
  );
  const byBest = useMemo(() => {
    const weights = picksWeights(ranking);
    const scores = new Map(
      visible.map((video) => [video.id, effectiveScore(video, weights, !!ranking.liked[video.id])]),
    );
    return [...visible].sort(
      (a, b) => scores.get(b.id)! - scores.get(a.id)! || Date.parse(b.published) - Date.parse(a.published),
    );
  }, [visible, ranking]);
  const byNewest = useMemo(
    () => [...visible].sort((a, b) => Date.parse(b.published) - Date.parse(a.published)),
    [visible],
  );

  const actions = useMemo<CardActions>(
    () => ({
      like(video) {
        const liked = !state.liked[video.id];
        update((current) => toggleLike(current, video));
        say(
          liked
            ? `More like this: ${video.channel} and ${(topicsById.get(video.primaryTopic ?? "")?.label ?? "videos like it").toLowerCase()} move up.`
            : `Back to normal for ${video.channel}.`,
        );
      },
      hide(video) {
        update((current) => hideVideo(current, video));
        say(`Hidden. You’ll see a little less from ${video.channel}.`, video.id);
      },
      watched(video, watched) {
        update((current) => setWatched(current, video.id, watched));
      },
      playing(key, video, on) {
        setPlaying((current) => (on ? key : current === key ? null : current));
        if (on) update((current) => setWatched(current, video.id, true));
      },
    }),
    [state.liked, update, say, topicsById],
  );
  const card = (video: PicksVideo, section: string, lead = false) => (
    <PickCard
      key={`${section}:${video.id}`}
      instance={`${section}:${video.id}`}
      video={video}
      lead={lead}
      reason={topicsById.get(video.primaryTopic ?? "")?.label ?? FALLBACK_REASON}
      watched={video.id in state.watched}
      liked={!!state.liked[video.id]}
      actions={actions}
    />
  );
  const openArea = (area: string) => {
    setFilter({ area, topic: "all" });
    top.current?.scrollIntoView({ block: "start" });
  };
  const reset = () => setFilter(DEFAULT_FILTER);

  const areaTopics =
    filter.area === "all" ? data.topics : data.topics.filter((topic) => topic.area === filter.area);
  const hiddenCount = Object.keys(state.hidden).length;
  const watchedCount = visible.filter((video) => video.id in state.watched).length;
  const updated = data.updatedAt
    ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(
        new Date(data.updatedAt),
      )
    : "";

  let body;
  if (!visible.length) {
    body = (
      <p className={styles.empty}>
        {hiddenCount
          ? "You’ve hidden every video. Restore them below."
          : "No videos to show right now. New picks arrive every morning."}
      </p>
    );
  } else if (frontPage) {
    // The lead: the best pick not yet watched (as of the last time the order was worked out).
    const lead = byBest.find((video) => !(video.id in ranking.watched)) ?? byBest[0];
    body = (
      <>
        <section className={styles.leadSection} aria-labelledby="vp-lead" data-picks-section="lead">
          <p className={styles.kicker} id="vp-lead">
            Lead pick
          </p>
          {card(lead, "lead", true)}
        </section>
        {data.areas.map((area) => {
          const all = byBest.filter((video) => video.area === area.id);
          if (!all.length) return null;
          const rest = all.filter((video) => video.id !== lead.id);
          return (
            <section
              key={area.id}
              className={styles.section}
              aria-labelledby={`vp-area-${area.id}`}
              data-picks-section={area.id}
            >
              <div className={styles.sectionHead}>
                <div className={styles.sectionTitles}>
                  <h3 className={styles.sectionTitle} id={`vp-area-${area.id}`}>
                    {area.label}
                  </h3>
                  {area.tagline ? <p className={styles.sectionSub}>{area.tagline}</p> : null}
                </div>
                <button type="button" className={styles.sectionAction} onClick={() => openArea(area.id)}>
                  All {area.label} ({all.length}) →
                </button>
              </div>
              <div className={styles.grid}>
                {(rest.length ? rest : all)
                  .slice(0, PICKS_PER_AREA)
                  .map((video) => card(video, `area-${area.id}`))}
              </div>
            </section>
          );
        })}
        <section className={styles.section} aria-labelledby="vp-everything" data-picks-section="everything">
          <div className={styles.sectionHead}>
            <div className={styles.sectionTitles}>
              <h3 className={styles.sectionTitle} id="vp-everything">
                Everything, newest first
              </h3>
              <p className={styles.sectionSub}>
                {byNewest.length} {byNewest.length === 1 ? "video" : "videos"} in this edition
              </p>
            </div>
          </div>
          <div className={styles.grid}>{byNewest.map((video) => card(video, "everything"))}</div>
        </section>
      </>
    );
  } else {
    const query = filter.query.trim().toLowerCase();
    const wanted = (video: PicksVideo) =>
      (filter.area === "all" || video.area === filter.area) &&
      (filter.topic === "all" ||
        video.primaryTopic === filter.topic ||
        video.topics.includes(filter.topic)) &&
      (!query || video.title.toLowerCase().includes(query));
    const found = (filter.sort === "newest" ? byNewest : byBest).filter(wanted);
    const named = [
      data.areas.find((area) => area.id === filter.area)?.label,
      topicsById.get(filter.topic)?.label,
      query ? `“${filter.query.trim()}”` : "",
    ].filter(Boolean);
    body = (
      <section className={styles.section} aria-labelledby="vp-filtered" data-picks-section="filtered">
        <div className={styles.sectionHead}>
          <div className={styles.sectionTitles}>
            <h3 className={styles.sectionTitle} id="vp-filtered">
              {named.length ? named.join(" · ") : "All videos"}
            </h3>
            <p className={styles.sectionSub} data-picks-count={found.length}>
              {found.length} {found.length === 1 ? "video" : "videos"} ·{" "}
              {filter.sort === "newest" ? "newest first" : "best match"}
            </p>
          </div>
          <button type="button" className={styles.sectionAction} onClick={reset}>
            ← Back to front page
          </button>
        </div>
        {found.length ? (
          <div className={styles.grid}>{found.map((video) => card(video, "filtered"))}</div>
        ) : (
          <p className={styles.empty}>
            No videos match that. Try clearing the search or picking another topic.
          </p>
        )}
      </section>
    );
  }

  return (
    <div className={styles.picks} data-video-picks="ready">
      <div className={styles.inner} ref={top}>
        <header className={styles.masthead}>
          <h2 className={styles.brand}>{data.title}</h2>
          <p className={styles.edition}>
            {updated ? `Updated ${updated} · ` : ""}
            {data.videos.length} picks from the last {data.windowDays} days
          </p>
        </header>
        <div className={styles.controls} role="search" aria-label="Filter and search videos">
          <div className={styles.areas} role="group" aria-label="Filter by area">
            {[{ id: "all", label: "Front page" }, ...data.areas].map((area) => (
              <button
                key={area.id}
                type="button"
                className={styles.pill}
                aria-pressed={filter.area === area.id}
                data-picks-area={area.id}
                onClick={() => setFilter({ area: area.id, topic: "all" })}
              >
                {area.label}
              </button>
            ))}
          </div>
          <div className={styles.controlsRow}>
            <input
              type="search"
              className={styles.search}
              placeholder="Search titles…"
              aria-label="Search video titles"
              autoComplete="off"
              maxLength={120}
              value={filter.query}
              onChange={(event) => setFilter({ query: event.target.value })}
            />
            <label className={styles.field}>
              <span>Topic</span>
              <select
                value={filter.topic}
                onChange={(event) => setFilter({ topic: event.target.value })}
                data-picks-topic
              >
                <option value="all">{filter.area === "all" ? "All topics" : "All topics in area"}</option>
                {areaTopics.map((topic) => (
                  <option key={topic.id} value={topic.id}>
                    {topic.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span>Sort</span>
              <select
                value={filter.sort}
                onChange={(event) => setFilter({ sort: event.target.value === "newest" ? "newest" : "best" })}
                data-picks-sort
              >
                <option value="best">Best match</option>
                <option value="newest">Newest first</option>
              </select>
            </label>
            {frontPage ? null : (
              <button type="button" className={styles.button} onClick={reset}>
                Reset
              </button>
            )}
          </div>
        </div>
        <div className={styles.main}>{body}</div>
        <footer className={styles.footer}>
          <p className={styles.footNote}>
            No autoplay and no sidebar. A video loads from YouTube’s privacy-enhanced player only when you
            press play.
          </p>
          <p className={styles.footMeta}>
            <span data-picks-stats>
              {visible.length} videos · {watchedCount} watched
            </span>
            {hiddenCount ? (
              <button
                type="button"
                className={styles.linkButton}
                data-picks-restore
                onClick={() => {
                  update(restoreAllHidden);
                  say(`Restored ${hiddenCount} hidden ${hiddenCount === 1 ? "video" : "videos"}.`);
                }}
              >
                Restore {hiddenCount} hidden
              </button>
            ) : null}
          </p>
        </footer>
        {data.canManage ? (
          <ManageChannels areas={data.areas} topics={data.topics} onChanged={onChanged} />
        ) : null}
      </div>
      <div className={styles.toastHost}>
        {toast ? (
          <div className={styles.toast} role="status" aria-live="polite" data-picks-toast>
            <span>{toast.text}</span>
            {toast.undo ? (
              <button
                type="button"
                className={styles.toastAction}
                onClick={() => {
                  const id = toast.undo!;
                  update((current) => unhideVideo(current, id));
                  setToast(null);
                }}
              >
                Undo
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

type CardActions = {
  like: (video: PicksVideo) => void;
  hide: (video: PicksVideo) => void;
  watched: (video: PicksVideo, watched: boolean) => void;
  playing: (key: string, video: PicksVideo, on: boolean) => void;
};

function PickCard({
  video,
  instance,
  lead,
  reason,
  watched,
  liked,
  actions,
}: {
  video: PicksVideo;
  instance: string;
  lead: boolean;
  reason: string;
  watched: boolean;
  liked: boolean;
  actions: CardActions;
}) {
  const [playing, setPlaying] = useState(false);
  const [requests, setRequests] = useState({ play: 0, stop: 0 });
  // The player's address is only ever built by the chat's own checked helper (#513).
  const player = useMemo<RecordingVideo | null>(() => {
    const found = recordingVideoFromUrl(watchUrl(video.id));
    return found ? { ...found, title: video.title } : null;
  }, [video.id, video.title]);
  const latest = useRef({ actions, video, instance });
  latest.current = { actions, video, instance };
  const onPlayingChange = useCallback((on: boolean) => {
    setPlaying(on);
    latest.current.actions.playing(latest.current.instance, latest.current.video, on);
  }, []);
  // A card that leaves the page while playing (hidden, or filtered away) is no longer playing.
  useEffect(
    () => () => latest.current.actions.playing(latest.current.instance, latest.current.video, false),
    [],
  );
  const when = relativeDay(video.published);
  const Title = lead ? "h3" : "h4";
  return (
    <article
      className={lead ? styles.leadCard : styles.card}
      data-picks-card={video.id}
      data-picks-instance={instance}
      data-watched={watched || undefined}
      data-playing={playing || undefined}
    >
      <div className={styles.media}>
        <div className={styles.frame}>
          {player ? (
            <RecordingVideoCard
              video={player}
              fill
              playRequest={requests.play}
              stopRequest={requests.stop}
              onPlayingChange={onPlayingChange}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- a YouTube still, shown as it is; nothing for the image optimiser to do */}
              <img
                className={styles.thumb}
                src={thumbnailUrl(video.id)}
                alt={`Still from ${video.title}, by ${video.channel}`}
                loading="lazy"
                decoding="async"
                width={480}
                height={360}
              />
              <span className={styles.playBadge} aria-hidden="true">
                <span className={styles.playMark} />
                Play
              </span>
              {watched ? <span className={styles.watchedPill}>Watched</span> : null}
            </RecordingVideoCard>
          ) : null}
        </div>
        {playing ? (
          <div className={styles.playerBar}>
            <span>Playing from YouTube’s privacy-enhanced player</span>
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => setRequests((current) => ({ ...current, stop: current.stop + 1 }))}
            >
              Close player
            </button>
          </div>
        ) : null}
      </div>
      <div className={styles.body}>
        <p className={styles.reason} data-picks-reason>
          {when ? `${reason} · ${when}` : reason}
        </p>
        <Title className={styles.title}>
          <button
            type="button"
            className={styles.titleButton}
            onClick={() => setRequests((current) => ({ ...current, play: current.play + 1 }))}
          >
            {video.title}
          </button>
        </Title>
        <p className={styles.channel}>{video.channel}</p>
        {video.snippet ? <p className={styles.snippet}>{video.snippet}</p> : null}
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.chip}
            aria-pressed={liked}
            data-picks-action="like"
            onClick={() => actions.like(video)}
          >
            {liked ? "Liked" : "More like this"}
          </button>
          <button
            type="button"
            className={styles.chip}
            data-picks-action="hide"
            onClick={() => actions.hide(video)}
          >
            Not for me
          </button>
          <button
            type="button"
            className={styles.chip}
            aria-pressed={watched}
            data-picks-action="watched"
            onClick={() => actions.watched(video, !watched)}
          >
            {watched ? "Watched" : "Mark watched"}
          </button>
          <a className={styles.watchLink} href={watchUrl(video.id)} target="_blank" rel="noopener noreferrer">
            Watch on YouTube
          </a>
        </div>
      </div>
    </article>
  );
}

type Channel = { channelId: string; name: string; area: string; topics: string[] };
type LastRefresh = {
  videos: number;
  succeeded: number;
  channels: number;
  failed: Array<{ name: string; error: string }>;
};

/** Admins only: add or remove a channel, and run the refresh now. Read when it is first opened. */
function ManageChannels({
  areas,
  topics,
  onChanged,
}: {
  areas: PicksArea[];
  topics: Topic[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [last, setLast] = useState<LastRefresh | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const [channel, setChannel] = useState("");
  const [area, setArea] = useState(areas[0]?.id ?? "");
  const [chosen, setChosen] = useState<string[]>([]);
  const [removing, setRemoving] = useState<string | null>(null);
  const read = useCallback(async () => {
    try {
      const data = await send("/api/chat/video-picks/channels", "GET");
      setChannels(Array.isArray(data?.channels) ? data.channels : []);
      setLast(data?.lastRefresh ?? null);
    } catch (error) {
      setNote({ text: (error as Error).message, bad: true });
    }
  }, []);
  useEffect(() => {
    if (open && !channels) void read();
  }, [open, channels, read]);
  const run = async (name: string, work: () => Promise<void>) => {
    if (busy) return;
    setBusy(name);
    setNote(null);
    try {
      await work();
    } catch (error) {
      setNote({ text: (error as Error).message, bad: true });
    } finally {
      setBusy(null);
    }
  };
  const add = (event: FormEvent) => {
    event.preventDefault();
    void run("add", async () => {
      const data = await send("/api/chat/video-picks/channels", "POST", { channel, area, topics: chosen });
      setChannel("");
      setChosen([]);
      setNote({ text: `Added ${data.channel.name}. Its videos join the page at the next refresh.` });
      await read();
    });
  };
  const remove = (item: Channel) =>
    run(`remove:${item.channelId}`, async () => {
      await send(`/api/chat/video-picks/channels?id=${encodeURIComponent(item.channelId)}`, "DELETE");
      setRemoving(null);
      setNote({ text: `Removed ${item.name} and its videos.` });
      await read();
      onChanged();
    });
  const refresh = () =>
    run("refresh", async () => {
      const data = await send("/api/chat/video-picks/refresh", "POST");
      const failed = Array.isArray(data?.failed) ? data.failed.length : 0;
      setNote(
        data?.stored
          ? {
              text: `Refreshed: ${data.videos} videos from ${data.succeeded} of ${data.channels} channels${failed ? ` (${failed} couldn’t be read and kept their last videos)` : ""}.`,
            }
          : {
              text:
                data?.reason === "no_channels"
                  ? "There are no channels to read yet."
                  : "Too many channels couldn’t be read just now, so the page keeps its last list. Try again later.",
              bad: true,
            },
      );
      await read();
      onChanged();
    });
  const areaLabel = (id: string) => areas.find((item) => item.id === id)?.label ?? id;
  const areaTopics = topics.filter((topic) => topic.area === area);
  return (
    <section className={styles.manage} aria-label="Manage channels" data-picks-manage>
      <button
        type="button"
        className={styles.button}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        data-picks-manage-toggle
      >
        {open ? "Close channel settings" : "Manage channels"}
      </button>
      {open ? (
        <div className={styles.managePanel}>
          <div className={styles.manageRow}>
            <button
              type="button"
              className={styles.button}
              disabled={!!busy}
              onClick={refresh}
              data-picks-refresh
            >
              {busy === "refresh" ? "Refreshing… (about half a minute)" : "Refresh now"}
            </button>
            {last ? (
              <span className={styles.manageMeta} data-picks-last>
                Last refresh: {last.videos} videos from {last.succeeded} of {last.channels} channels
                {last.failed.length
                  ? ` · couldn’t read ${last.failed.map((item) => item.name).join(", ")}`
                  : ""}
              </span>
            ) : null}
          </div>
          <form className={styles.manageForm} onSubmit={add}>
            <label className={styles.manageField}>
              <span>Add a channel</span>
              <input
                value={channel}
                onChange={(event) => setChannel(event.target.value)}
                placeholder="UC… id, youtube.com/channel/UC… or @handle"
                maxLength={200}
                required
                autoComplete="off"
                data-picks-channel-input
              />
            </label>
            <label className={styles.manageField}>
              <span>Area</span>
              <select
                value={area}
                onChange={(event) => {
                  setArea(event.target.value);
                  setChosen([]);
                }}
              >
                {areas.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            {areaTopics.length ? (
              <fieldset className={styles.manageTopics}>
                <legend>Topics it covers (up to 3, optional)</legend>
                {areaTopics.map((topic) => (
                  <label key={topic.id}>
                    <input
                      type="checkbox"
                      checked={chosen.includes(topic.id)}
                      disabled={!chosen.includes(topic.id) && chosen.length >= 3}
                      onChange={(event) =>
                        setChosen((current) =>
                          event.target.checked
                            ? [...current, topic.id]
                            : current.filter((id) => id !== topic.id),
                        )
                      }
                    />{" "}
                    {topic.label}
                  </label>
                ))}
              </fieldset>
            ) : null}
            <button type="submit" className={styles.primary} disabled={!!busy || !channel.trim()}>
              {busy === "add" ? "Checking the channel…" : "Add channel"}
            </button>
          </form>
          {note ? (
            <p className={note.bad ? styles.error : styles.notice} role="status" data-picks-note>
              {note.text}
            </p>
          ) : null}
          {channels ? (
            <ul className={styles.channelList} data-picks-channels={channels.length}>
              {channels.map((item) => (
                <li key={item.channelId} data-picks-channel={item.channelId}>
                  <span className={styles.channelName}>{item.name}</span>
                  <span className={styles.manageMeta}>{areaLabel(item.area)}</span>
                  {removing === item.channelId ? (
                    <>
                      <button
                        type="button"
                        className={styles.danger}
                        disabled={!!busy}
                        onClick={() => void remove(item)}
                      >
                        Remove {item.name}
                      </button>
                      <button type="button" className={styles.linkButton} onClick={() => setRemoving(null)}>
                        Keep
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className={styles.linkButton}
                      onClick={() => setRemoving(item.channelId)}
                      aria-label={`Remove ${item.name}`}
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.manageMeta}>Loading the channels…</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
