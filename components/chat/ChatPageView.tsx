"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  LINK_NOTE_MAX,
  LINK_TITLE_MAX,
  PAGE_NAME_MAX,
  parseHttpsUrl,
  type ChatPage,
  type ChatPageLink,
} from "@/lib/chatPages";
import styles from "./ChatPageView.module.css";

// LB-PAGES (#321): what a sidebar page shows in place of the room: an embedded website, a shared
// list of links (Trader Links), the member's own private links, or an admin's "add a page" form.

type Props = {
  page: ChatPage | null;
  creating: boolean;
  canManage: boolean;
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

export default function ChatPageView({ page, creating, canManage, onPagesChanged }: Props) {
  if (creating) return canManage ? <NewPageForm onPagesChanged={onPagesChanged} /> : null;
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
  const load = useCallback(async () => {
    try {
      const data = await send(mine ? base : `${base}?page=${encodeURIComponent(page.id)}`, "GET");
      setLinks(Array.isArray(data?.links) ? data.links : []);
      setCanPin(data?.canPin === true);
      setError("");
    } catch (caught) {
      setError((caught as Error).message);
    }
  }, [base, mine, page.id]);
  useEffect(() => {
    void load();
  }, [load]);
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
      <ul className={styles.links}>
        {links?.map((link) =>
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

function NewPageForm({ onPagesChanged }: { onPagesChanged: () => void }) {
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
      setAdded(data?.page?.name ?? name);
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
      <p className={styles.intro}>
        Add a page to everyone’s sidebar: a website shown inside the chat, or a list of links members can add to.
      </p>
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
            “{added}” is now in everyone’s Pages list.
          </p>
        )}
        <div className={styles.formActions}>
          <button type="submit" className={styles.primary} disabled={busy}>
            {busy ? "Adding…" : "Add page"}
          </button>
        </div>
      </form>
    </div>
  );
}
