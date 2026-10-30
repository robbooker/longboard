"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  LINK_NOTE_MAX,
  LINK_TITLE_MAX,
  PAGE_NAME_MAX,
  parseHttpsUrl,
  sortPageLinks,
  toggleLinkLike,
  type ChatPage,
  type ChatPageLink,
  type ChatPageSuggestion,
  type LinkSort,
} from "@/lib/chatPages";
import { NEW_CHAT_PAGE } from "./hooks/useChatPages";
import styles from "./ChatPageView.module.css";

// LB-PAGES (#321): what a sidebar page shows in place of the room: an embedded website, a shared
// list of links (Trader Links), the member's own private links, or an admin's "add a page" form.
// #323: on a shared list each link has a like button with its count, and the list is ranked by
// likes ("Top", the default) or newest first ("New"); pinned links stay on top either way.
// #329: members use the same form to suggest a page; their suggestion opens as its status, and
// admins approve or decline from the waiting list.

type Props = {
  page: ChatPage | null;
  creating: boolean;
  canManage: boolean;
  /** #329: the member's own pending or declined suggestion, if that is what was opened. */
  suggestion: ChatPageSuggestion | null;
  /** #329: the admin's waiting list, if that is what was opened. */
  waiting: ChatPageSuggestion[] | null;
  onPagesChanged: () => void;
  onOpenPage: (id: string) => void;
};

async function send(url: string, method: string, body?: unknown) {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof data?.error === "string" && data.error.includes(" ") ? data.error : "That didn't work. Please try again.");
  return data;
}

export default function ChatPageView({ page, creating, canManage, suggestion, waiting, onPagesChanged, onOpenPage }: Props) {
  if (creating) return <NewPageForm canManage={canManage} onPagesChanged={onPagesChanged} />;
  if (waiting) return <WaitingList waiting={waiting} onPagesChanged={onPagesChanged} />;
  if (suggestion) return <SuggestionStatus suggestion={suggestion} onPagesChanged={onPagesChanged} onDismissed={() => onOpenPage(NEW_CHAT_PAGE)} />;
  if (!page)
    return (
      <div className={styles.page}>
        <p className={styles.empty} role="status">
          This page isn’t available right now.
        </p>
      </div>
    );
  if (page.kind === "embed" && page.embedUrl)
    return <EmbedPage page={page} canManage={canManage} onPagesChanged={onPagesChanged} />;
  return <LinksPage key={page.id} page={page} canManage={canManage} onPagesChanged={onPagesChanged} />;
}

function RemovePage({ page, onPagesChanged }: { page: ChatPage; onPagesChanged: () => void }) {
  const [error, setError] = useState("");
  if (page.builtIn) return null;
  return (
    <>
      <button
        type="button"
        className={styles.quiet}
        onClick={async () => {
          if (!window.confirm(`Remove the “${page.name}” page for everyone?`)) return;
          try {
            await send(`/api/chat/pages?id=${encodeURIComponent(page.id)}`, "DELETE");
            onPagesChanged();
          } catch (caught) {
            setError((caught as Error).message);
          }
        }}
      >
        Remove page
      </button>
      {error && <span className={styles.error}>{error}</span>}
    </>
  );
}

function EmbedPage({ page, canManage, onPagesChanged }: { page: ChatPage; canManage: boolean; onPagesChanged: () => void }) {
  const url = page.embedUrl!;
  return (
    <div className={styles.page} data-embed="true">
      <div className={styles.embedBar}>
        <span className={styles.host}>{new URL(url).host}</span>
        <a className={styles.button} href={url} target="_blank" rel="noopener noreferrer">
          Open in its own tab ↗
        </a>
        {canManage && <RemovePage page={page} onPagesChanged={onPagesChanged} />}
      </div>
      <iframe
        className={styles.frame}
        src={url}
        title={page.name}
        // The site runs its own scripts and sign-in, but cannot reach the chat or move this tab.
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
        referrerPolicy="strict-origin-when-cross-origin"
        allow="clipboard-write; fullscreen"
      />
    </div>
  );
}

type Draft = { title: string; url: string; note: string };
const EMPTY: Draft = { title: "", url: "", note: "" };

function LinkForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: Draft;
  submitLabel: string;
  onSubmit: (draft: Draft) => Promise<void>;
  onCancel?: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    // The server checks again; this only saves a round trip for the common mistake.
    const url = parseHttpsUrl(draft.url);
    if (!draft.title.trim()) return setError("Add a title.");
    if (!url.ok) return setError(url.error);
    setBusy(true);
    setError("");
    try {
      await onSubmit(draft);
      setDraft(initial === EMPTY ? EMPTY : draft);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <label>
        Title
        <input
          value={draft.title}
          maxLength={LINK_TITLE_MAX}
          onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          placeholder="Finviz screener"
        />
      </label>
      <label>
        Web address
        <input
          value={draft.url}
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(event) => setDraft({ ...draft, url: event.target.value })}
          placeholder="https://"
        />
      </label>
      <label>
        Note <small>(optional)</small>
        <input
          value={draft.note}
          maxLength={LINK_NOTE_MAX}
          onChange={(event) => setDraft({ ...draft, note: event.target.value })}
          placeholder="One line about it"
        />
      </label>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.formActions}>
        <button type="submit" className={styles.primary} disabled={busy}>
          {busy ? "Saving…" : submitLabel}
        </button>
        {onCancel && (
          <button type="button" className={styles.quiet} onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function LinksPage({ page, canManage, onPagesChanged }: { page: ChatPage; canManage: boolean; onPagesChanged: () => void }) {
  const mine = page.kind === "my-links";
  const base = mine ? "/api/chat/pages/my-links" : "/api/chat/pages/links";
  const [links, setLinks] = useState<ChatPageLink[] | null>(null);
  const [canPin, setCanPin] = useState(false);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ id: string; text: string } | null>(null);
  const [likesOn, setLikesOn] = useState(false);
  const [sort, setSort] = useState<LinkSort>("top");
  // #323: links with a like request out: the last tap's choice, and the state before the taps.
  const wanted = useRef(new Map<string, { like: boolean; before: boolean }>());
  const [syncing, setSyncing] = useState<ReadonlySet<string>>(new Set());
  const load = useCallback(async () => {
    try {
      const data = await send(mine ? base : `${base}?page=${encodeURIComponent(page.id)}`, "GET");
      setLinks(Array.isArray(data?.links) ? data.links : []);
      setCanPin(data?.canPin === true);
      setLikesOn(!mine && data?.likes === true);
      setError("");
    } catch (caught) {
      setError((caught as Error).message);
    }
  }, [base, mine, page.id]);
  useEffect(() => {
    void load();
  }, [load]);
  // My Links keep the server's order (newest first); shared lists follow the Top / New choice.
  const shown = useMemo(() => (links && !mine ? sortPageLinks(links, likesOn ? sort : "new") : links), [links, mine, likesOn, sort]);
  const setLink = (id: string, change: (link: ChatPageLink) => ChatPageLink) =>
    setLinks((current) => current?.map((link) => (link.id === id ? change(link) : link)) ?? current);
  // Like or take the like back at once, then settle on the server's count. Taps made while a
  // request is out are not lost: the page keeps sending until the server matches the last tap,
  // and undoes the change if that fails.
  const toggleLike = (link: ChatPageLink, button: HTMLButtonElement) => {
    const pending = wanted.current.get(link.id);
    const like = pending === undefined ? !link.likedByMe : !pending.like;
    const focused = document.activeElement === button;
    setLink(link.id, (current) => toggleLinkLike(current, like));
    setNotice(null);
    // The link may move in the ranking; keep the keyboard on its button.
    if (focused)
      requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`button[data-like="${CSS.escape(link.id)}"]`)?.focus());
    wanted.current.set(link.id, { like, before: pending?.before ?? link.likedByMe });
    if (pending === undefined) {
      setSyncing((current) => new Set(current).add(link.id));
      void syncLike(link.id);
    }
  };
  const syncLike = async (id: string) => {
    let sent: boolean | undefined;
    let data: { likeCount?: unknown; likedByMe?: unknown } | null = null;
    try {
      while (wanted.current.get(id)!.like !== sent) {
        const like = wanted.current.get(id)!.like;
        sent = like;
        data = await send(
          like ? `${base}/likes` : `${base}/likes?id=${encodeURIComponent(id)}`,
          like ? "POST" : "DELETE",
          like ? { id } : undefined,
        );
      }
      if (typeof data?.likeCount === "number") {
        const likeCount = data.likeCount, likedByMe = data.likedByMe === true;
        setLink(id, (current) => ({ ...current, likeCount, likedByMe }));
      }
    } catch (caught) {
      const before = wanted.current.get(id)!.before;
      setLink(id, (current) => toggleLinkLike(current, before));
      setNotice({ id, text: (caught as Error).message });
    } finally {
      wanted.current.delete(id);
      setSyncing((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  };
  const act = async (id: string, run: () => Promise<unknown>, done?: string) => {
    try {
      await run();
      setNotice(done ? { id, text: done } : null);
      await load();
    } catch (caught) {
      setNotice({ id, text: (caught as Error).message });
    }
  };
  return (
    <div className={styles.page}>
      <div className={styles.listHead}>
        <p className={styles.intro}>
          {mine
            ? "Your own saved links. Only you can see them. Share one to add it to Trader Links."
            : "Links traders find useful. Anyone can add one."}
        </p>
        <button type="button" className={styles.primary} aria-expanded={adding} onClick={() => setAdding((open) => !open)}>
          {adding ? "Close" : "Add a link"}
        </button>
        {canManage && <RemovePage page={page} onPagesChanged={onPagesChanged} />}
      </div>
      {adding && (
        <LinkForm
          initial={EMPTY}
          submitLabel="Save link"
          onSubmit={async (draft) => {
            await send(base, "POST", mine ? draft : { ...draft, pageId: page.id });
            setAdding(false);
            await load();
          }}
          onCancel={() => setAdding(false)}
        />
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {links === null && !error && (
        <p className={styles.empty} role="status">
          Loading links…
        </p>
      )}
      {links?.length === 0 && (
        <p className={styles.empty}>{mine ? "You haven’t saved any links yet." : "No links yet. Add the first one."}</p>
      )}
      {likesOn && !!links?.length && (
        <div className={styles.sortBar} role="group" aria-label="Order links by">
          <button type="button" className={styles.sort} aria-pressed={sort === "top"} onClick={() => setSort("top")}>
            Top
          </button>
          <button type="button" className={styles.sort} aria-pressed={sort === "new"} onClick={() => setSort("new")}>
            New
          </button>
        </div>
      )}
      <ul className={styles.links}>
        {shown?.map((link) =>
          editing === link.id ? (
            <li key={link.id} className={styles.link}>
              <LinkForm
                initial={{ title: link.title, url: link.url, note: link.note ?? "" }}
                submitLabel="Save changes"
                onSubmit={async (draft) => {
                  await send(base, "PATCH", { id: link.id, ...draft });
                  setEditing(null);
                  await load();
                }}
                onCancel={() => setEditing(null)}
              />
            </li>
          ) : (
            <li key={link.id} className={styles.link} data-pinned={link.pinned || undefined}>
              {likesOn && <LikeButton link={link} busy={syncing.has(link.id)} onToggle={toggleLike} />}
              <div className={styles.linkMain}>
                <a href={link.url} target="_blank" rel="noopener noreferrer" className={styles.linkTitle}>
                  {link.pinned && <span className={styles.pin}>Pinned · </span>}
                  {link.title} <span aria-hidden="true">↗</span>
                  <span className={styles.srOnly}> (opens in a new tab)</span>
                </a>
                <span className={styles.linkUrl}>{link.url.replace(/^https:\/\//, "").replace(/\/$/, "")}</span>
                {link.note && <span className={styles.note}>{link.note}</span>}
                {!mine && link.addedByName && <span className={styles.meta}>Added by {link.addedByName}</span>}
              </div>
              <div className={styles.linkActions}>
                {mine && (
                  <button
                    type="button"
                    className={styles.quiet}
                    onClick={() =>
                      act(link.id, () => send(`${base}/share`, "POST", { id: link.id }), "Shared to Trader Links.")
                    }
                  >
                    Share
                  </button>
                )}
                {!mine && canPin && (
                  <button
                    type="button"
                    className={styles.quiet}
                    aria-pressed={link.pinned}
                    onClick={() => act(link.id, () => send(base, "PATCH", { id: link.id, pinned: !link.pinned }))}
                  >
                    {link.pinned ? "Unpin" : "Pin to top"}
                  </button>
                )}
                {link.canEdit && (
                  <>
                    <button type="button" className={styles.quiet} onClick={() => setEditing(link.id)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className={styles.quiet}
                      onClick={() => {
                        if (window.confirm(`Remove “${link.title}”?`))
                          void act(link.id, () => send(`${base}?id=${encodeURIComponent(link.id)}`, "DELETE"));
                      }}
                    >
                      Remove
                    </button>
                  </>
                )}
              </div>
              {notice?.id === link.id && (
                <p className={styles.notice} role="status">
                  {notice.text}
                </p>
              )}
            </li>
          ),
        )}
      </ul>
    </div>
  );
}

function LikeButton({
  link,
  busy,
  onToggle,
}: {
  link: ChatPageLink;
  busy: boolean;
  onToggle: (link: ChatPageLink, button: HTMLButtonElement) => void;
}) {
  const count = link.likeCount === 1 ? "1 like" : `${link.likeCount} likes`;
  return (
    <button
      type="button"
      className={styles.like}
      data-like={link.id}
      aria-pressed={link.likedByMe}
      aria-busy={busy || undefined}
      disabled={link.addedByMe}
      aria-label={link.addedByMe ? `Your link, ${count}` : `${link.likedByMe ? "Unlike" : "Like"} “${link.title}”, ${count}`}
      title={link.addedByMe ? "You can’t like your own link" : link.likedByMe ? "Take back your like" : "Like this link"}
      onClick={(event) => onToggle(link, event.currentTarget)}
    >
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path d="M8 2.5 14 9.5H10.5V13.5H5.5V9.5H2Z" />
      </svg>
      <span className={styles.likeCount}>{link.likeCount}</span>
    </button>
  );
}

/** What a suggested page would show: the kind, and a website's address to open in its own tab. */
function SuggestionDetail({ suggestion }: { suggestion: ChatPageSuggestion }) {
  if (!suggestion.embedUrl) return <span className={styles.note}>A list of links</span>;
  return (
    <a href={suggestion.embedUrl} target="_blank" rel="noopener noreferrer" className={styles.linkUrl}>
      A website: {suggestion.embedUrl.replace(/^https:\/\//, "").replace(/\/$/, "")} <span aria-hidden="true">↗</span>
      <span className={styles.srOnly}> (opens in a new tab)</span>
    </a>
  );
}

/** #329: the member's own suggestion. It never opens as the page itself until it is approved. */
function SuggestionStatus({ suggestion, onPagesChanged, onDismissed }: { suggestion: ChatPageSuggestion; onPagesChanged: () => void; onDismissed: () => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const declined = suggestion.status === "declined";
  return (
    <div className={styles.page}>
      <div className={styles.listHead}>
        <p className={styles.intro} role="status" data-suggestion-status={suggestion.status}>
          {declined
            ? `An admin declined “${suggestion.name}”, so it won’t be added to Pages.`
            : `“${suggestion.name}” is waiting for approval. Only you can see it until an admin approves it; then it appears for everyone.`}
        </p>
      </div>
      <SuggestionDetail suggestion={suggestion} />
      {declined && (
        <div className={styles.formActions}>
          <button
            type="button"
            className={styles.quiet}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await send(`/api/chat/pages?id=${encodeURIComponent(suggestion.id)}&dismiss=1`, "DELETE");
                onPagesChanged();
                onDismissed();
              } catch (caught) {
                setError((caught as Error).message);
                setBusy(false);
              }
            }}
          >
            Dismiss
          </button>
        </div>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** #329: an admin's list of suggested pages, with Approve and Decline for each. */
function WaitingList({ waiting, onPagesChanged }: { waiting: ChatPageSuggestion[]; onPagesChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ id: string; text: string } | null>(null);
  const [done, setDone] = useState("");
  const decide = async (suggestion: ChatPageSuggestion, decision: "approve" | "decline") => {
    setBusy(suggestion.id);
    setNotice(null);
    setDone("");
    try {
      await send("/api/chat/pages", "PATCH", { id: suggestion.id, decision });
      setDone(decision === "approve" ? `“${suggestion.name}” is now in everyone’s Pages list.` : `“${suggestion.name}” was declined.`);
      onPagesChanged();
    } catch (caught) {
      setNotice({ id: suggestion.id, text: (caught as Error).message });
      // Most likely another admin got there first: show the list as it is now.
      onPagesChanged();
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className={styles.page}>
      <div className={styles.listHead}>
        <p className={styles.intro}>Pages members have suggested. Nobody else sees one until you approve it.</p>
      </div>
      {done && (
        <p className={styles.notice} role="status">
          {done}
        </p>
      )}
      {waiting.length === 0 && <p className={styles.empty}>Nothing is waiting for approval.</p>}
      <ul className={styles.links}>
        {waiting.map((suggestion) => (
          <li key={suggestion.id} className={styles.link}>
            <div className={styles.linkMain}>
              <span className={styles.linkTitle}>{suggestion.name}</span>
              <SuggestionDetail suggestion={suggestion} />
              <span className={styles.meta}>Suggested by {suggestion.suggestedByName ?? "Former member"}</span>
            </div>
            <div className={styles.linkActions}>
              <button type="button" className={styles.primary} disabled={busy !== null} onClick={() => void decide(suggestion, "approve")}>
                Approve
              </button>
              <button type="button" className={styles.quiet} disabled={busy !== null} onClick={() => void decide(suggestion, "decline")}>
                Decline
              </button>
            </div>
            {notice?.id === suggestion.id && (
              <p className={styles.notice} role="status">
                {notice.text}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function NewPageForm({ canManage, onPagesChanged }: { canManage: boolean; onPagesChanged: () => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"embed" | "links">("links");
  const [embedUrl, setEmbedUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (kind === "embed") {
      const url = parseHttpsUrl(embedUrl);
      if (!url.ok) return setError(url.error);
    }
    setBusy(true);
    setError("");
    try {
      const data = await send("/api/chat/pages", "POST", { name, kind, embedUrl: kind === "embed" ? embedUrl : undefined });
      setAdded(data?.page?.name ?? data?.suggestion?.name ?? name);
      setName("");
      setEmbedUrl("");
      onPagesChanged();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={styles.page}>
      <div className={styles.listHead}>
        <p className={styles.intro}>
          {canManage
            ? "Add a page to everyone’s sidebar: a website shown inside the chat, or a list of links members can add to."
            : "Suggest a page for everyone’s sidebar: a website shown inside the chat, or a list of links members can add to. An admin looks at it first."}
        </p>
      </div>
      <form className={styles.form} onSubmit={submit} noValidate>
        <label>
          Page name
          <input value={name} maxLength={PAGE_NAME_MAX} onChange={(event) => setName(event.target.value)} />
        </label>
        <fieldset className={styles.kinds}>
          <legend>What it shows</legend>
          <label>
            <input type="radio" name="kind" checked={kind === "links"} onChange={() => setKind("links")} /> A list of
            links
          </label>
          <label>
            <input type="radio" name="kind" checked={kind === "embed"} onChange={() => setKind("embed")} /> A website
          </label>
        </fieldset>
        {kind === "embed" && (
          <label>
            Website address
            <input
              value={embedUrl}
              inputMode="url"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="https://"
              onChange={(event) => setEmbedUrl(event.target.value)}
            />
            <small>Some websites don’t allow being shown inside another site; members can still open it in its own tab.</small>
          </label>
        )}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {added && (
          <p className={styles.notice} role="status">
            {canManage ? `“${added}” is now in everyone’s Pages list.` : `“${added}” is waiting for approval. It appears for everyone once an admin approves it.`}
          </p>
        )}
        <div className={styles.formActions}>
          <button type="submit" className={styles.primary} disabled={busy}>
            {busy ? (canManage ? "Adding…" : "Sending…") : canManage ? "Add page" : "Suggest page"}
          </button>
        </div>
      </form>
    </div>
  );
}
