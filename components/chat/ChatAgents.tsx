"use client";

import { useEffect, useId, useState } from "react";
import {
  AGENT_LIMIT,
  AGENT_TOKEN_LIMIT,
  agentRoomLabel as roomLabel,
  type AgentCeiling,
  type AgentPermissions,
} from "@/lib/chatAgents";
import ChatAgentCeiling from "./ChatAgentCeiling";
import styles from "./ChatAgents.module.css";

// #450: your agents on the developers page: make up to 3, each with its own name and tokens,
// narrow what each may do (never past the admins' limits), pause or delete them.
type Token = { id: string; label: string; hint: string; createdAt: string; lastUsedAt: string | null };
export type Agent = {
  id: string;
  name: string;
  readRooms: string[] | null;
  postRooms: string[] | null;
  dm: boolean;
  react: boolean;
  thread: boolean;
  perMinute: number | null;
  perDay: number | null;
  paused: boolean;
  adminPaused: boolean;
  createdAt: string;
  effective: AgentPermissions;
  tokens: Token[];
};
type List = {
  access: boolean;
  admin?: boolean;
  ceiling?: AgentCeiling;
  agents: Agent[];
  unavailable?: boolean;
};

const roomList = (rooms: string[]) => (rooms.length ? rooms.map(roomLabel).join(", ") : "none");
const when = (value: string | null) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "Never";

async function call(body: Record<string, unknown>) {
  const r = await fetch("/api/chat/agents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok)
    throw new Error(
      [400, 403, 404, 409].includes(r.status) && typeof data.error === "string" && data.error.includes(" ")
        ? data.error
        : "Something went wrong. Try again.",
    );
  return data;
}

export default function ChatAgents() {
  const [state, setState] = useState<"loading" | "ready" | "no_access" | "failed">("loading");
  const [list, setList] = useState<List | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const nameId = useId();

  useEffect(() => {
    let live = true;
    fetch("/api/chat/agents", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: List) => {
        if (!live) return;
        setList(data);
        setState(data.access ? "ready" : "no_access");
      })
      .catch(() => live && setState("failed"));
    return () => {
      live = false;
    };
  }, []);

  const replace = (agent: Agent) =>
    setList((l) => l && { ...l, agents: l.agents.map((a) => (a.id === agent.id ? { ...a, ...agent } : a)) });

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const data = await call({ action: "create", name });
      setList((l) => l && { ...l, agents: [...l.agents, { ...data.agent, tokens: [] }] });
      setName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't make the agent. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") return <p className={styles.muted}>Loading your agents…</p>;
  if (state === "failed")
    return <p className={styles.error}>Couldn&apos;t load your agents. Refresh to try again.</p>;
  const admin = list?.admin ? <ChatAgentCeiling /> : null;
  if (state === "no_access" || !list?.ceiling)
    return (
      <>
        <p className={styles.notice}>
          {list?.unavailable
            ? "Agents aren't switched on yet."
            : "Agents come with developer access, which is invite-only for now."}
        </p>
        {admin}
      </>
    );
  const ceiling = list.ceiling;
  return (
    <div className={styles.agents}>
      <form className={styles.create} onSubmit={create}>
        <label htmlFor={nameId}>New agent name</label>
        <div className={styles.row}>
          <input
            id={nameId}
            value={name}
            maxLength={28}
            placeholder="e.g. Desk Helper"
            onChange={(e) => setName(e.target.value)}
          />
          <button
            type="submit"
            disabled={busy || name.trim().length < 2 || list.agents.length >= AGENT_LIMIT}
          >
            Create agent
          </button>
        </div>
        <p className={styles.muted}>
          Up to {AGENT_LIMIT} agents. Their posts show the agent&apos;s name with an Agent badge and
          &ldquo;run by&rdquo; your chat name.
        </p>
      </form>
      <p className={styles.error} role="alert">
        {error}
      </p>
      {list.agents.length === 0 ? (
        <p className={styles.muted}>No agents yet.</p>
      ) : (
        <ul className={styles.list}>
          {list.agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              ceiling={ceiling}
              onChange={replace}
              onDelete={() =>
                setList((l) => l && { ...l, agents: l.agents.filter((a) => a.id !== agent.id) })
              }
            />
          ))}
        </ul>
      )}
      {admin}
    </div>
  );
}

function AgentCard({
  agent,
  ceiling,
  onChange,
  onDelete,
}: {
  agent: Agent;
  ceiling: AgentCeiling;
  onChange: (agent: Agent) => void;
  onDelete: () => void;
}) {
  const [rename, setRename] = useState(agent.name);
  // Only what the admins allow now (a narrower limit since may leave older choices behind).
  const [read, setRead] = useState<string[]>(
    (agent.readRooms ?? ceiling.readRooms).filter((room) => ceiling.readRooms.includes(room)),
  );
  const [post, setPost] = useState<string[]>(
    (agent.postRooms ?? ceiling.postRooms).filter((room) => ceiling.postRooms.includes(room)),
  );
  const [react, setReact] = useState(agent.react && ceiling.react);
  const [thread, setThread] = useState(agent.thread && ceiling.thread);
  const [perMinute, setPerMinute] = useState(
    String(Math.min(agent.perMinute ?? ceiling.perMinute, ceiling.perMinute)),
  );
  const [perDay, setPerDay] = useState(String(Math.min(agent.perDay ?? ceiling.perDay, ceiling.perDay)));
  const [label, setLabel] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const ids = useId();

  async function run(work: () => Promise<void>, done = "") {
    if (busy) return;
    setBusy(true);
    setError("");
    setSaved("");
    try {
      await work();
      setSaved(done);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }
  const update = (patch: Record<string, unknown>, done = "Saved.") =>
    run(async () => onChange((await call({ action: "update", agentId: agent.id, patch })).agent), done);
  const sameRooms = (a: string[], b: string[]) =>
    a.length === b.length && a.every((room) => b.includes(room));
  function saveSettings(event: React.FormEvent) {
    event.preventDefault();
    const minute = Number(perMinute),
      day = Number(perDay);
    if (!Number.isInteger(minute) || minute < 1 || minute > ceiling.perMinute)
      return setError(`Posts a minute: 1 to ${ceiling.perMinute}.`);
    if (!Number.isInteger(day) || day < 1 || day > ceiling.perDay)
      return setError(`Posts a day: 1 to ${ceiling.perDay}.`);
    // Everything the admins allow is stored as "follow the limits" (null), so it moves with them.
    const patch: Record<string, unknown> = {
      readRooms: sameRooms(read, ceiling.readRooms) ? null : read,
      postRooms: sameRooms(post, ceiling.postRooms) ? null : post,
      perMinute: minute === ceiling.perMinute ? null : minute,
      perDay: day === ceiling.perDay ? null : day,
    };
    if (ceiling.react) patch.react = react;
    if (ceiling.thread) patch.thread = thread;
    update(patch, "Settings saved.");
  }
  const toggle = (list: string[], set: (rooms: string[]) => void, room: string) =>
    set(list.includes(room) ? list.filter((r) => r !== room) : [...list, room]);
  const status = agent.adminPaused ? "Paused by an admin" : agent.paused ? "Paused" : "Active";

  return (
    <li className={styles.card} data-agent-card={agent.name}>
      <div className={styles.head}>
        <div>
          <strong className={styles.name}>{agent.name}</strong>
          <span className={styles.status} data-paused={agent.paused || agent.adminPaused || undefined}>
            {status}
          </span>
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            disabled={busy}
            onClick={() => update({ paused: !agent.paused }, agent.paused ? "Resumed." : "Paused.")}
          >
            {agent.paused ? "Resume" : "Pause"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (!window.confirm(`Delete “${agent.name}”? Its tokens stop working straight away.`)) return;
              run(async () => {
                await call({ action: "delete", agentId: agent.id });
                onDelete();
              });
            }}
          >
            Delete
          </button>
        </div>
      </div>
      {agent.adminPaused && (
        <p className={styles.notice}>
          An admin paused this agent. Its tokens don&apos;t work until they resume it.
        </p>
      )}
      <p className={styles.muted}>
        Can read: {roomList(agent.effective.readRooms)}. Can post: {roomList(agent.effective.postRooms)}.{" "}
        {agent.effective.perMinute} posts a minute, {agent.effective.perDay} a day.
        {agent.effective.react ? " Reacts." : ""}
        {agent.effective.thread ? " Replies in threads." : ""}
      </p>

      <form
        className={styles.row}
        onSubmit={(e) => {
          e.preventDefault();
          update({ name: rename }, "Renamed.");
        }}
      >
        <label className={styles.hiddenLabel} htmlFor={`${ids}-name`}>
          Name
        </label>
        <input id={`${ids}-name`} value={rename} maxLength={28} onChange={(e) => setRename(e.target.value)} />
        <button type="submit" disabled={busy || rename.trim() === agent.name || rename.trim().length < 2}>
          Rename
        </button>
      </form>

      <details className={styles.settings}>
        <summary>What this agent may do</summary>
        <form className={styles.settingsForm} onSubmit={saveSettings}>
          <fieldset>
            <legend>Rooms it may read</legend>
            {ceiling.readRooms.map((room) => (
              <label key={room} className={styles.check}>
                <input
                  type="checkbox"
                  checked={read.includes(room)}
                  onChange={() => toggle(read, setRead, room)}
                />
                {roomLabel(room)}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Rooms it may post in</legend>
            {ceiling.postRooms.map((room) => (
              <label key={room} className={styles.check}>
                <input
                  type="checkbox"
                  checked={post.includes(room)}
                  onChange={() => toggle(post, setPost, room)}
                />
                {roomLabel(room)}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>It may</legend>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={react}
                disabled={!ceiling.react}
                onChange={(e) => setReact(e.target.checked)}
              />
              React to messages{ceiling.react ? "" : " (off for all agents)"}
            </label>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={thread}
                disabled={!ceiling.thread}
                onChange={(e) => setThread(e.target.checked)}
              />
              Reply in threads{ceiling.thread ? "" : " (off for all agents)"}
            </label>
            <label className={styles.check}>
              <input type="checkbox" checked={false} disabled />
              Send private messages (not yet)
            </label>
          </fieldset>
          <div className={styles.limits}>
            <label>
              Posts a minute (up to {ceiling.perMinute})
              <input
                type="number"
                min={1}
                max={ceiling.perMinute}
                value={perMinute}
                onChange={(e) => setPerMinute(e.target.value)}
              />
            </label>
            <label>
              Posts a day (up to {ceiling.perDay})
              <input
                type="number"
                min={1}
                max={ceiling.perDay}
                value={perDay}
                onChange={(e) => setPerDay(e.target.value)}
              />
            </label>
          </div>
          <button type="submit" className={styles.primary} disabled={busy}>
            Save settings
          </button>
        </form>
      </details>

      <div className={styles.tokens}>
        <strong>Tokens</strong>
        {fresh && (
          <div className={styles.fresh} role="status">
            <p>
              <strong>Copy this token for {agent.name} now.</strong> It won&apos;t be shown again.
            </p>
            <code className={styles.secret}>{fresh}</code>
            <div className={styles.actions}>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(fresh);
                    setCopied(true);
                  } catch {
                    setCopied(false);
                  }
                }}
              >
                {copied ? "Copied" : "Copy token"}
              </button>
              <button type="button" onClick={() => setFresh(null)}>
                Done
              </button>
            </div>
          </div>
        )}
        {agent.tokens.length > 0 && (
          <ul className={styles.tokenList}>
            {agent.tokens.map((t) => (
              <li key={t.id}>
                <span>
                  <strong>{t.label}</strong>{" "}
                  <span className={styles.muted}>
                    lbc_…{t.hint} · last used {when(t.lastUsedAt)}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm(`Revoke “${t.label}”? Programs using it stop working straight away.`))
                      return;
                    run(async () => {
                      await call({ action: "token-revoke", tokenId: t.id });
                      onChange({ ...agent, tokens: agent.tokens.filter((x) => x.id !== t.id) });
                    });
                  }}
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          className={styles.row}
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const data = await call({ action: "token-create", agentId: agent.id, label });
              onChange({ ...agent, tokens: [data.details, ...agent.tokens] });
              setFresh(data.token);
              setCopied(false);
              setLabel("");
            });
          }}
        >
          <label className={styles.hiddenLabel} htmlFor={`${ids}-token`}>
            Token name
          </label>
          <input
            id={`${ids}-token`}
            value={label}
            maxLength={60}
            placeholder="Token name, e.g. home server"
            onChange={(e) => setLabel(e.target.value)}
          />
          <button type="submit" disabled={busy || !label.trim() || agent.tokens.length >= AGENT_TOKEN_LIMIT}>
            Create token
          </button>
        </form>
      </div>
      <p className={styles.error} role="alert">
        {error}
      </p>
      <p className={styles.saved} role="status">
        {saved}
      </p>
    </li>
  );
}
