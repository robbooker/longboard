"use client";
// #450: how an agent's post is shown: its name, an "Agent" badge and "run by <owner>", on every
// screen size. Its larger view (tap the name or picture) offers Mute, which hides that agent's
// posts for you. The muted list is read once per page, only when an agent post is on screen.
import { useEffect, useState, useSyncExternalStore } from "react";
import type { ChatMessageAgent } from "@/lib/chatAgents";
import type { PicturePerson } from "./MemberPictureView";
import styles from "./MembershipBadges.module.css";

let muted: Set<string> | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
function loadMutes() {
  if (muted || loading) return;
  loading = fetch("/api/chat/agents/mutes", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : { muted: [] }))
    .then((data: { muted?: unknown }) => {
      muted = new Set(
        Array.isArray(data.muted) ? data.muted.filter((id): id is string => typeof id === "string") : [],
      );
    })
    .catch(() => {
      muted = new Set();
    })
    .finally(() => {
      loading = null;
      emit();
    });
}

/** Whether you muted this agent (false until the list arrives, and for non-agent posts). */
export function useAgentMuted(agentId: string | undefined) {
  useEffect(() => {
    if (agentId) loadMutes();
  }, [agentId]);
  return useSyncExternalStore(
    subscribe,
    () => !!agentId && !!muted?.has(agentId),
    () => false,
  );
}

const EMPTY = new Set<string>();
/** Every agent you muted (loaded once `needed` is true: an agent post is on screen). */
export function useMutedAgents(needed: boolean): ReadonlySet<string> {
  useEffect(() => {
    if (needed) loadMutes();
  }, [needed]);
  return useSyncExternalStore(
    subscribe,
    () => muted ?? EMPTY,
    () => EMPTY,
  );
}

export async function setAgentMuted(agentId: string, mute: boolean) {
  const r = await fetch("/api/chat/agents/mutes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentId, muted: mute }),
  });
  if (!r.ok) throw new Error("mute_failed");
  muted = new Set(muted ?? []);
  if (mute) muted.add(agentId);
  else muted.delete(agentId);
  emit();
}

/** The tile and name of an agent's post: initials on the agent's own colour, never the owner's. */
export function agentPerson(agent: ChatMessageAgent): PicturePerson {
  return { memberId: null, path: null, name: agent.name, colorKey: `agent:${agent.id}`, bot: true, agent };
}

export function AgentByline({ agent }: { agent?: ChatMessageAgent }) {
  if (!agent) return null;
  return (
    <span className={styles.agent} data-agent-byline="">
      <span
        className={styles.badge}
        data-membership="agent"
        title="An agent: a program a member runs"
        aria-label="Agent"
      >
        Agent
      </span>
      {agent.owner && <span className={styles.runBy}>run by {agent.owner}</span>}
    </span>
  );
}

/** In the agent's larger view: who runs it, and Mute / Unmute. */
export function AgentViewDetails({ agent, buttonClass }: { agent: ChatMessageAgent; buttonClass?: string }) {
  const isMuted = useAgentMuted(agent.id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <p className={styles.agentView}>
        <span className={styles.badge} data-membership="agent">
          Agent
        </span>{" "}
        {agent.owner ? `run by ${agent.owner}` : "run by a member"}
      </p>
      <button
        type="button"
        className={buttonClass}
        disabled={busy}
        data-agent-mute=""
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await setAgentMuted(agent.id, !isMuted);
          } catch {
            setError("Couldn't change that. Try again.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {isMuted ? "Unmute this agent" : "Mute this agent"}
      </button>
      {isMuted && <p className={styles.agentView}>Its posts are hidden for you.</p>}
      {error && (
        <p className={styles.agentView} role="alert">
          {error}
        </p>
      )}
    </>
  );
}
