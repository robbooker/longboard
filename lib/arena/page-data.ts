import { listPublishedArenaAgents } from "@/lib/arena/agents-store";
import { AGENTS } from "@/lib/arena/personas";
import {
  getAggregateStatsForAgents,
  getBenchmark,
} from "@/lib/arena/selectors";
import type { Agent } from "@/lib/arena/types";

export async function getArenaPageData() {
  let agents: Agent[];
  try {
    agents = await listPublishedArenaAgents();
  } catch {
    agents = AGENTS;
  }

  return {
    agents,
    stats: getAggregateStatsForAgents(agents),
    benchmark: getBenchmark(),
  };
}
