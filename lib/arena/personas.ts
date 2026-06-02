import type { AgentSlug } from "./types";
import type { AgentTradeConfig, AgentVoiceConfig } from "./config-types";
import {
  DEFAULT_IDENTITIES,
  defaultTradeConfig,
  defaultVoiceConfig,
} from "./defaults";
import {
  assembleTradeSystemPrompt,
  assembleVoiceSystemPrompt,
  buildTradeMandate,
  deriveStyleLabel,
} from "./prompts/assemble";
import type { Agent } from "./types";

function buildAgent(
  identity: (typeof DEFAULT_IDENTITIES)[number],
  trade: AgentTradeConfig,
  voice: AgentVoiceConfig,
): Agent {
  return {
    id: identity.id,
    slug: identity.slug,
    displayName: identity.displayName,
    provider: identity.provider,
    modelFamily: identity.modelFamily,
    modelId: identity.modelId,
    providerKey: identity.providerKey,
    style: deriveStyleLabel(trade, voice),
    avatarColor: identity.avatarColor,
    description: identity.bio,
    systemPromptSummary: buildTradeMandate(identity, trade).split("\n")[0] ?? "",
    benchmarkSymbol: identity.benchmarkSymbol,
    startingCapital: identity.startingCapital,
    status: identity.status,
    tradeConfig: trade,
    voiceConfig: voice,
  };
}

export const AGENTS: Agent[] = DEFAULT_IDENTITIES.map((identity) =>
  buildAgent(
    identity,
    defaultTradeConfig(identity.slug),
    defaultVoiceConfig(identity.slug),
  ),
);

export function getAgentBySlug(slug: string): Agent | undefined {
  return AGENTS.find((a) => a.slug === slug);
}

export function getAgentById(id: string): Agent | undefined {
  return AGENTS.find((a) => a.id === id);
}

export function buildAgentFromParts(
  identity: {
    id: string;
    slug: AgentSlug;
    displayName: string;
    provider: string;
    modelFamily: string;
    modelId: string;
    providerKey: string;
    avatarColor: string;
    bio: string;
    benchmarkSymbol: string;
    startingCapital: number;
    status: Agent["status"];
  },
  trade: AgentTradeConfig,
  voice: AgentVoiceConfig,
): Agent {
  return buildAgent(
    {
      id: identity.id,
      slug: identity.slug,
      displayName: identity.displayName,
      provider: identity.provider,
      modelFamily: identity.modelFamily,
      modelId: identity.modelId,
      providerKey: identity.providerKey,
      avatarColor: identity.avatarColor,
      bio: identity.bio,
      benchmarkSymbol: identity.benchmarkSymbol,
      startingCapital: identity.startingCapital,
      status: identity.status,
    },
    trade,
    voice,
  );
}

export function publishedPrompts(
  identity: {
    id: string;
    slug: AgentSlug;
    displayName: string;
    provider: string;
    modelFamily: string;
    modelId: string;
    providerKey: string;
    avatarColor: string;
    bio: string;
    benchmarkSymbol: string;
    startingCapital: number;
    status: Agent["status"];
  },
  trade: AgentTradeConfig,
  voice: AgentVoiceConfig,
) {
  return {
    tradeSystemPrompt: assembleTradeSystemPrompt(
      { ...identity, bio: identity.bio },
      trade,
    ),
    voiceSystemPrompt: assembleVoiceSystemPrompt(
      { ...identity, bio: identity.bio },
      voice,
    ),
  };
}
