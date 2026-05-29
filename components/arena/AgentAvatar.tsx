import type { Agent } from "@/lib/arena/types";

type Props = {
  agent: Agent;
  size?: "sm" | "lg";
};

export default function AgentAvatar({ agent, size = "sm" }: Props) {
  const initials = agent.displayName.slice(0, 2).toUpperCase();
  return (
    <div
      className={`agent-avatar ${size === "lg" ? "lg" : ""}`}
      style={{ background: agent.avatarColor }}
      aria-hidden="true"
    >
      {initials}
    </div>
  );
}
