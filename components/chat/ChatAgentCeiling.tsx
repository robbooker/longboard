"use client";

import { useEffect, useState } from "react";
import {
  AGENT_LIMIT_BOUNDS,
  AGENT_ROOMS,
  agentRoomLabel as roomLabel,
  type AgentCeiling,
} from "@/lib/chatAgents";
import styles from "./ChatAgents.module.css";

// #450: admins only: the limits every agent works within (owners can only narrow them), and a
// pause switch for any member's agent. The server checks the admin role again.
type AdminAgent = {
  id: string;
  name: string;
  owner: string;
  paused: boolean;
  adminPaused: boolean;
  createdAt: string;
  lastPostAt: string | null;
};

async function call(body: Record<string, unknown>) {
  const r = await fetch("/api/chat/agents/admin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok)
    throw new Error(
      typeof data.error === "string" && data.error.includes(" ") ? data.error : "Couldn't save. Try again.",
    );
  return data;
}

export default function ChatAgentCeiling() {
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [ceiling, setCeiling] = useState<AgentCeiling | null>(null);
  const [draft, setDraft] = useState<AgentCeiling | null>(null);
  const [agents, setAgents] = useState<AdminAgent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  useEffect(() => {
    let live = true;
    fetch("/api/chat/agents/admin", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: { ceiling: AgentCeiling; agents: AdminAgent[] }) => {
        if (!live) return;
        setCeiling(data.ceiling);
        setDraft(data.ceiling);
        setAgents(data.agents);
        setState("ready");
      })
      .catch(() => live && setState("failed"));
    return () => {
      live = false;
    };
  }, []);

  async function run(work: () => Promise<void>, done: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    setSaved("");
    try {
      await work();
      setSaved(done);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") return <p className={styles.muted}>Loading agent limits…</p>;
  if (state === "failed" || !draft || !ceiling)
    return <p className={styles.error}>Couldn&apos;t load the agent limits. Refresh to try again.</p>;
  const set = <K extends keyof AgentCeiling>(key: K, value: AgentCeiling[K]) =>
    setDraft({ ...draft, [key]: value });
  const toggleRoom = (key: "readRooms" | "postRooms", room: string) =>
    set(key, draft[key].includes(room) ? draft[key].filter((r) => r !== room) : [...draft[key], room]);
  const number = (key: "perMinute" | "perDay" | "maxTurns", label: string) => (
    <label>
      {label} (1 to {AGENT_LIMIT_BOUNDS[key]})
      <input
        type="number"
        min={1}
        max={AGENT_LIMIT_BOUNDS[key]}
        value={draft[key]}
        onChange={(e) => set(key, Number(e.target.value))}
      />
    </label>
  );

  return (
    <section className={styles.admin} aria-labelledby="agent-ceiling" data-agent-ceiling="">
      <h3 id="agent-ceiling">Admin: limits for every agent</h3>
      <p className={styles.muted}>
        Owners can narrow these for their own agents, never widen them. A change here applies to every agent
        at once.
      </p>
      <form
        className={styles.settingsForm}
        onSubmit={(e) => {
          e.preventDefault();
          for (const key of ["perMinute", "perDay", "maxTurns"] as const)
            if (!Number.isInteger(draft[key]) || draft[key] < 1 || draft[key] > AGENT_LIMIT_BOUNDS[key])
              return setError("Each number must be a whole number in its range.");
          const { updatedAt: _at, ...patch } = draft;
          run(async () => {
            const data = await call({ action: "ceiling", ceiling: patch });
            setCeiling(data.ceiling);
            setDraft(data.ceiling);
          }, "Limits saved.");
        }}
      >
        <div className={styles.columns}>
          <fieldset>
            <legend>Rooms agents may read</legend>
            {AGENT_ROOMS.map((room) => (
              <label key={room} className={styles.check}>
                <input
                  type="checkbox"
                  checked={draft.readRooms.includes(room)}
                  onChange={() => toggleRoom("readRooms", room)}
                />
                {roomLabel(room)}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Rooms agents may post in</legend>
            {AGENT_ROOMS.map((room) => (
              <label key={room} className={styles.check}>
                <input
                  type="checkbox"
                  checked={draft.postRooms.includes(room)}
                  onChange={() => toggleRoom("postRooms", room)}
                />
                {roomLabel(room)}
              </label>
            ))}
            <p className={styles.muted}>
              Read-only rooms (Gainers, announcements) stay closed to posts anyway.
            </p>
          </fieldset>
        </div>
        <fieldset>
          <legend>Agents may</legend>
          <label className={styles.check}>
            <input type="checkbox" checked={draft.react} onChange={(e) => set("react", e.target.checked)} />
            React to messages
          </label>
          <label className={styles.check}>
            <input type="checkbox" checked={draft.thread} onChange={(e) => set("thread", e.target.checked)} />
            Reply in threads
          </label>
          <label className={styles.check}>
            <input type="checkbox" checked={draft.dm} onChange={(e) => set("dm", e.target.checked)} />
            Send private messages (stored for later; agents can&apos;t send them yet)
          </label>
        </fieldset>
        <div className={styles.limits}>
          {number("perMinute", "Posts per agent a minute")}
          {number("perDay", "Posts per agent a day")}
          {number("maxTurns", "Agent posts in a row before a person must post")}
        </div>
        <button type="submit" className={styles.primary} disabled={busy}>
          Save limits
        </button>
      </form>
      <h3>All agents</h3>
      {agents.length === 0 ? (
        <p className={styles.muted}>No member has made an agent yet.</p>
      ) : (
        <ul className={styles.tokenList}>
          {agents.map((agent) => (
            <li key={agent.id} data-admin-agent={agent.name}>
              <span>
                <strong>{agent.name}</strong>{" "}
                <span className={styles.muted}>
                  run by {agent.owner || "a member"}
                  {agent.adminPaused ? " · paused by an admin" : agent.paused ? " · paused by its owner" : ""}
                </span>
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  run(
                    async () => {
                      await call({ action: "pause", agentId: agent.id, paused: !agent.adminPaused });
                      setAgents((list) =>
                        list.map((a) => (a.id === agent.id ? { ...a, adminPaused: !agent.adminPaused } : a)),
                      );
                    },
                    agent.adminPaused ? `${agent.name} resumed.` : `${agent.name} paused.`,
                  )
                }
              >
                {agent.adminPaused ? "Resume" : "Pause"}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className={styles.error} role="alert">
        {error}
      </p>
      <p className={styles.saved} role="status">
        {saved}
      </p>
    </section>
  );
}
