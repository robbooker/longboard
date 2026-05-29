/** Known LLM vendors for the arena. Agents pick a provider + model_id; keys are per-provider. */
export type ArenaProviderKey =
  | "anthropic"
  | "openai"
  | "google"
  | "xai"
  | "deepseek"
  | "custom";

export type ArenaProviderDef = {
  key: ArenaProviderKey;
  displayName: string;
  /** Env var fallback when no vault key is stored (server-side only). */
  envFallback: string | null;
  defaultModelId: string;
  modelHint: string;
};

export const ARENA_PROVIDERS: ArenaProviderDef[] = [
  {
    key: "anthropic",
    displayName: "Anthropic",
    envFallback: "ANTHROPIC_API_KEY",
    defaultModelId: "claude-sonnet-4-20250514",
    modelHint: "e.g. claude-sonnet-4-20250514",
  },
  {
    key: "openai",
    displayName: "OpenAI",
    envFallback: "OPENAI_API_KEY",
    defaultModelId: "gpt-4.1",
    modelHint: "e.g. gpt-4.1, gpt-4o",
  },
  {
    key: "google",
    displayName: "Google",
    envFallback: "GOOGLE_API_KEY",
    defaultModelId: "gemini-2.5-pro",
    modelHint: "e.g. gemini-2.5-pro, gemma-3-27b-it",
  },
  {
    key: "xai",
    displayName: "xAI",
    envFallback: "XAI_API_KEY",
    defaultModelId: "grok-3",
    modelHint: "e.g. grok-3",
  },
  {
    key: "deepseek",
    displayName: "DeepSeek",
    envFallback: "DEEPSEEK_API_KEY",
    defaultModelId: "deepseek-chat",
    modelHint: "e.g. deepseek-chat",
  },
  {
    key: "custom",
    displayName: "Custom (OpenAI-compatible)",
    envFallback: null,
    defaultModelId: "",
    modelHint: "Model id for your compatible endpoint",
  },
];

export function getProviderDef(key: string): ArenaProviderDef | undefined {
  return ARENA_PROVIDERS.find((p) => p.key === key);
}

export function isArenaProviderKey(key: string): key is ArenaProviderKey {
  return ARENA_PROVIDERS.some((p) => p.key === key);
}

/** Slug for new agents: lowercase alphanumeric + hyphens. */
export function isValidAgentSlug(slug: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(slug);
}

export function slugFromDisplayName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "agent";
}
