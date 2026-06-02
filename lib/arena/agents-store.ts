import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type {
  AgentAdminRecord,
  AgentIdentity,
  AgentTradeConfig,
  AgentVoiceConfig,
  CreateAgentInput,
  UpdateAgentIdentityInput,
} from "./config-types";
import { parseTradeConfig, parseVoiceConfig } from "./config-parse";
import {
  DEFAULT_IDENTITIES,
  defaultTradeConfig,
  defaultVoiceConfig,
  getDefaultIdentity,
} from "./defaults";
import { buildAgentFromParts, publishedPrompts, AGENTS } from "./personas";
import {
  getProviderDef,
  isArenaProviderKey,
  isValidAgentSlug,
} from "./providers";
import { assembleTradeSystemPrompt, assembleVoiceSystemPrompt } from "./prompts/assemble";
import type { Agent, AgentSlug } from "./types";

function adminSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type AgentRow = {
  id: string;
  slug: string;
  display_name: string;
  provider: string;
  provider_key: string;
  model_family: string;
  model_id: string;
  avatar_color: string;
  bio: string;
  benchmark_symbol: string;
  starting_capital: number;
  status: "active" | "paused";
  sort_order: number;
  archived_at: string | null;
};

type SettingsRow = {
  agent_id: string;
  draft_trade_config: unknown;
  draft_voice_config: unknown;
  published_trade_config: unknown | null;
  published_voice_config: unknown | null;
  published_version: number;
  trade_system_prompt: string | null;
  voice_system_prompt: string | null;
  published_at: string | null;
  updated_at: string;
};

function rowToIdentity(row: AgentRow): AgentIdentity {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    provider: row.provider,
    modelFamily: row.model_family,
    modelId: row.model_id,
    providerKey: row.provider_key,
    avatarColor: row.avatar_color,
    bio: row.bio,
    benchmarkSymbol: row.benchmark_symbol,
    startingCapital: Number(row.starting_capital),
    status: row.status,
  };
}

function mergeSettings(
  identity: AgentIdentity,
  settings: SettingsRow | null,
  row: AgentRow,
): AgentAdminRecord {
  const slug = identity.slug;
  const draftTrade =
    parseTradeConfig(settings?.draft_trade_config) ?? defaultTradeConfig(slug);
  const draftVoice =
    parseVoiceConfig(settings?.draft_voice_config) ?? defaultVoiceConfig(slug);
  const publishedTrade = settings?.published_trade_config
    ? parseTradeConfig(settings.published_trade_config)
    : null;
  const publishedVoice = settings?.published_voice_config
    ? parseVoiceConfig(settings.published_voice_config)
    : null;

  return {
    ...identity,
    draftTrade,
    draftVoice,
    publishedTrade,
    publishedVoice,
    publishedVersion: settings?.published_version ?? 0,
    publishedAt: settings?.published_at ?? null,
    tradeSystemPrompt: settings?.trade_system_prompt ?? null,
    voiceSystemPrompt: settings?.voice_system_prompt ?? null,
    updatedAt: settings?.updated_at ?? null,
    sortOrder: row.sort_order ?? 0,
    archivedAt: row.archived_at,
  };
}

function defaultAdminRecord(slug: AgentSlug): AgentAdminRecord {
  const identity = getDefaultIdentity(slug);
  const draftTrade = defaultTradeConfig(slug);
  const draftVoice = defaultVoiceConfig(slug);
  if (!identity) {
    return {
      id: `agent-${slug}`,
      slug,
      displayName: slug,
      provider: "Custom",
      modelFamily: slug,
      modelId: "",
      providerKey: "custom",
      avatarColor: "#888888",
      bio: "",
      benchmarkSymbol: "SPY",
      startingCapital: 100_000,
      status: "active",
      draftTrade,
      draftVoice,
      publishedTrade: null,
      publishedVoice: null,
      publishedVersion: 0,
      publishedAt: null,
      tradeSystemPrompt: null,
      voiceSystemPrompt: null,
      updatedAt: null,
      sortOrder: 99,
      archivedAt: null,
    };
  }
  return {
    ...identity,
    draftTrade,
    draftVoice,
    publishedTrade: null,
    publishedVoice: null,
    publishedVersion: 0,
    publishedAt: null,
    tradeSystemPrompt: null,
    voiceSystemPrompt: null,
    updatedAt: null,
    sortOrder: 0,
    archivedAt: null,
  };
}

export { isValidAgentSlug as isAgentSlug };

export async function getPublishedAgent(slug: string): Promise<Agent | undefined> {
  if (!isValidAgentSlug(slug)) return undefined;

  const codeIdentity = getDefaultIdentity(slug);
  const fallback = buildAgentFromParts(
    codeIdentity ?? {
      id: `agent-${slug}`,
      slug,
      displayName: slug,
      provider: "Custom",
      modelFamily: slug,
      modelId: "",
      providerKey: "custom",
      avatarColor: "#888",
      bio: "",
      benchmarkSymbol: "SPY",
      startingCapital: 100_000,
      status: "active",
    },
    defaultTradeConfig(slug),
    defaultVoiceConfig(slug),
  );

  const supabase = adminSupabase();
  if (!supabase) return fallback;

  const { data: agentRow, error: agentErr } = await supabase
    .from("arena_agents")
    .select("*")
    .eq("slug", slug)
    .is("archived_at", null)
    .maybeSingle();

  if (agentErr || !agentRow) return fallback;

  const identity = rowToIdentity(agentRow as AgentRow);
  const { data: settingsRow } = await supabase
    .from("arena_agent_settings")
    .select("*")
    .eq("agent_id", identity.id)
    .maybeSingle();

  const settings = settingsRow as SettingsRow | null;
  const trade =
    (settings?.published_trade_config
      ? parseTradeConfig(settings.published_trade_config)
      : null) ?? defaultTradeConfig(slug);
  const voice =
    (settings?.published_voice_config
      ? parseVoiceConfig(settings.published_voice_config)
      : null) ?? defaultVoiceConfig(slug);

  return buildAgentFromParts(identity, trade, voice);
}

export async function listArenaAdminAgents(includeArchived = false): Promise<AgentAdminRecord[]> {
  const supabase = adminSupabase();
  if (!supabase) {
    return DEFAULT_IDENTITIES.map((i) => defaultAdminRecord(i.slug));
  }

  let query = supabase.from("arena_agents").select("*").order("sort_order");
  if (!includeArchived) query = query.is("archived_at", null);

  const { data: agents, error } = await query;
  if (error || !agents?.length) {
    return DEFAULT_IDENTITIES.map((i) => defaultAdminRecord(i.slug));
  }

  const ids = agents.map((a) => a.id);
  const { data: settingsRows } = await supabase
    .from("arena_agent_settings")
    .select("*")
    .in("agent_id", ids);

  const settingsByAgent = new Map(
    (settingsRows ?? []).map((s) => [s.agent_id, s as SettingsRow]),
  );

  return (agents as AgentRow[]).map((row) =>
    mergeSettings(rowToIdentity(row), settingsByAgent.get(row.id) ?? null, row),
  );
}

export async function getArenaAdminAgent(slug: string): Promise<AgentAdminRecord | null> {
  if (!isValidAgentSlug(slug)) return null;
  const supabase = adminSupabase();
  if (!supabase) return defaultAdminRecord(slug);

  const { data: agentRow, error } = await supabase
    .from("arena_agents")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  if (error || !agentRow) return defaultAdminRecord(slug);

  const row = agentRow as AgentRow;
  const identity = rowToIdentity(row);
  const { data: settingsRow } = await supabase
    .from("arena_agent_settings")
    .select("*")
    .eq("agent_id", identity.id)
    .maybeSingle();

  return mergeSettings(identity, (settingsRow as SettingsRow | null) ?? null, row);
}

export async function createArenaAgent(
  input: CreateAgentInput,
  userId: string,
): Promise<{ ok: true; record: AgentAdminRecord } | { ok: false; error: string }> {
  if (!isValidAgentSlug(input.slug)) return { ok: false, error: "invalid_slug" };
  if (!isArenaProviderKey(input.providerKey)) return { ok: false, error: "invalid_provider" };

  const supabase = adminSupabase();
  if (!supabase) return { ok: false, error: "db_unavailable" };

  const providerDef = getProviderDef(input.providerKey)!;
  const id = `agent-${input.slug}`;
  const now = new Date().toISOString();
  const trade = defaultTradeConfig(input.slug);
  const voice = defaultVoiceConfig(input.slug);

  const { error: agentErr } = await supabase.from("arena_agents").insert({
    id,
    slug: input.slug,
    display_name: input.displayName.trim(),
    provider: providerDef.displayName,
    provider_key: input.providerKey,
    model_family: input.modelFamily?.trim() || input.displayName.trim(),
    model_id: input.modelId.trim() || providerDef.defaultModelId,
    avatar_color: input.avatarColor?.trim() || "#6366f1",
    bio: input.bio?.trim() || "",
    status: "active",
    sort_order: 50,
    updated_at: now,
  });

  if (agentErr) {
    if (agentErr.code === "23505") return { ok: false, error: "slug_exists" };
    return { ok: false, error: agentErr.message };
  }

  const { error: settingsErr } = await supabase.from("arena_agent_settings").insert({
    agent_id: id,
    draft_trade_config: trade,
    draft_voice_config: voice,
    updated_at: now,
    updated_by: userId,
  });

  if (settingsErr) return { ok: false, error: settingsErr.message };

  const record = await getArenaAdminAgent(input.slug);
  if (!record) return { ok: false, error: "reload_failed" };
  return { ok: true, record };
}

export async function updateArenaAgentIdentity(
  slug: string,
  patch: UpdateAgentIdentityInput,
  userId: string,
): Promise<{ ok: true; record: AgentAdminRecord } | { ok: false; error: string }> {
  if (!isValidAgentSlug(slug)) return { ok: false, error: "invalid_slug" };
  const supabase = adminSupabase();
  if (!supabase) return { ok: false, error: "db_unavailable" };

  const existing = await getArenaAdminAgent(slug);
  if (!existing) return { ok: false, error: "not_found" };

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.displayName !== undefined) updates.display_name = patch.displayName.trim();
  if (patch.modelId !== undefined) updates.model_id = patch.modelId.trim();
  if (patch.modelFamily !== undefined) updates.model_family = patch.modelFamily.trim();
  if (patch.avatarColor !== undefined) updates.avatar_color = patch.avatarColor.trim();
  if (patch.bio !== undefined) updates.bio = patch.bio.trim();
  if (patch.status !== undefined) updates.status = patch.status;
  if (patch.sortOrder !== undefined) updates.sort_order = patch.sortOrder;
  if (patch.providerKey !== undefined) {
    if (!isArenaProviderKey(patch.providerKey)) return { ok: false, error: "invalid_provider" };
    const def = getProviderDef(patch.providerKey)!;
    updates.provider_key = patch.providerKey;
    updates.provider = def.displayName;
  }

  const { error } = await supabase
    .from("arena_agents")
    .update(updates)
    .eq("slug", slug);

  if (error) return { ok: false, error: error.message };

  await supabase
    .from("arena_agent_settings")
    .update({ updated_at: new Date().toISOString(), updated_by: userId })
    .eq("agent_id", existing.id);

  const record = await getArenaAdminAgent(slug);
  if (!record) return { ok: false, error: "reload_failed" };
  return { ok: true, record };
}

export async function archiveArenaAgent(
  slug: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isValidAgentSlug(slug)) return { ok: false, error: "invalid_slug" };
  const supabase = adminSupabase();
  if (!supabase) return { ok: false, error: "db_unavailable" };

  const { error } = await supabase
    .from("arena_agents")
    .update({
      archived_at: new Date().toISOString(),
      status: "paused",
      updated_at: new Date().toISOString(),
    })
    .eq("slug", slug);

  if (error) return { ok: false, error: error.message };
  void userId;
  return { ok: true };
}

export async function saveArenaAgentDraft(
  slug: string,
  trade: AgentTradeConfig,
  voice: AgentVoiceConfig,
  userId: string,
): Promise<{ ok: true; record: AgentAdminRecord } | { ok: false; error: string }> {
  if (!isValidAgentSlug(slug)) return { ok: false, error: "invalid_slug" };
  const supabase = adminSupabase();
  if (!supabase) return { ok: false, error: "db_unavailable" };

  const record = await getArenaAdminAgent(slug);
  if (!record) return { ok: false, error: "not_found" };

  const now = new Date().toISOString();
  const { error } = await supabase.from("arena_agent_settings").upsert(
    {
      agent_id: record.id,
      draft_trade_config: trade,
      draft_voice_config: voice,
      updated_at: now,
      updated_by: userId,
    },
    { onConflict: "agent_id" },
  );

  if (error) return { ok: false, error: error.message };

  const updated = await getArenaAdminAgent(slug);
  if (!updated) return { ok: false, error: "reload_failed" };
  return { ok: true, record: updated };
}

export async function publishArenaAgentConfig(
  slug: string,
  userId: string,
): Promise<{ ok: true; record: AgentAdminRecord; version: number } | { ok: false; error: string }> {
  if (!isValidAgentSlug(slug)) return { ok: false, error: "invalid_slug" };
  const supabase = adminSupabase();
  if (!supabase) return { ok: false, error: "db_unavailable" };

  const record = await getArenaAdminAgent(slug);
  if (!record) return { ok: false, error: "not_found" };

  const identity: AgentIdentity = {
    id: record.id,
    slug: record.slug,
    displayName: record.displayName,
    provider: record.provider,
    modelFamily: record.modelFamily,
    modelId: record.modelId,
    providerKey: record.providerKey,
    avatarColor: record.avatarColor,
    bio: record.bio,
    benchmarkSymbol: record.benchmarkSymbol,
    startingCapital: record.startingCapital,
    status: record.status,
  };

  const prompts = publishedPrompts(identity, record.draftTrade, record.draftVoice);
  const version = record.publishedVersion + 1;
  const now = new Date().toISOString();

  const { error: histErr } = await supabase.from("arena_agent_config_history").insert({
    agent_id: record.id,
    version,
    trade_config: record.draftTrade,
    voice_config: record.draftVoice,
    trade_system_prompt: prompts.tradeSystemPrompt,
    voice_system_prompt: prompts.voiceSystemPrompt,
    published_at: now,
    published_by: userId,
  });

  if (histErr) return { ok: false, error: histErr.message };

  const { error: settingsErr } = await supabase.from("arena_agent_settings").upsert(
    {
      agent_id: record.id,
      draft_trade_config: record.draftTrade,
      draft_voice_config: record.draftVoice,
      published_trade_config: record.draftTrade,
      published_voice_config: record.draftVoice,
      published_version: version,
      trade_system_prompt: prompts.tradeSystemPrompt,
      voice_system_prompt: prompts.voiceSystemPrompt,
      published_at: now,
      published_by: userId,
      updated_at: now,
      updated_by: userId,
    },
    { onConflict: "agent_id" },
  );

  if (settingsErr) return { ok: false, error: settingsErr.message };

  const updated = await getArenaAdminAgent(slug);
  if (!updated) return { ok: false, error: "reload_failed" };
  return { ok: true, record: updated, version };
}

export function previewFromDraft(record: AgentAdminRecord) {
  const identity: AgentIdentity = {
    id: record.id,
    slug: record.slug,
    displayName: record.displayName,
    provider: record.provider,
    modelFamily: record.modelFamily,
    modelId: record.modelId,
    providerKey: record.providerKey,
    avatarColor: record.avatarColor,
    bio: record.bio,
    benchmarkSymbol: record.benchmarkSymbol,
    startingCapital: record.startingCapital,
    status: record.status,
  };
  return {
    tradeSystemPrompt: assembleTradeSystemPrompt(identity, record.draftTrade),
    voiceSystemPrompt: assembleVoiceSystemPrompt(identity, record.draftVoice),
  };
}

/** Active agents for public arena pages — DB roster or code fallback. */
export async function listPublishedArenaAgents(): Promise<Agent[]> {
  try {
    const supabase = adminSupabase();
    if (!supabase) return AGENTS;

    const { data: rows, error } = await supabase
      .from("arena_agents")
      .select("*")
      .is("archived_at", null)
      .order("sort_order");

    if (error || !rows?.length) return AGENTS;

    const agents: Agent[] = [];
    for (const row of rows as AgentRow[]) {
      if (row.status !== "active") continue;
      const agent = await getPublishedAgent(row.slug);
      if (agent) agents.push(agent);
    }

    return agents.length > 0 ? agents : AGENTS;
  } catch {
    return AGENTS;
  }
}

export async function revertArenaAgentDraft(
  slug: string,
  userId: string,
): Promise<{ ok: true; record: AgentAdminRecord } | { ok: false; error: string }> {
  if (!isValidAgentSlug(slug)) return { ok: false, error: "invalid_slug" };
  const supabase = adminSupabase();
  if (!supabase) return { ok: false, error: "db_unavailable" };

  const record = await getArenaAdminAgent(slug);
  if (!record) return { ok: false, error: "not_found" };
  if (!record.publishedTrade || !record.publishedVoice) {
    return { ok: false, error: "nothing_published" };
  }

  const now = new Date().toISOString();
  const { error } = await supabase.from("arena_agent_settings").upsert(
    {
      agent_id: record.id,
      draft_trade_config: record.publishedTrade,
      draft_voice_config: record.publishedVoice,
      updated_at: now,
      updated_by: userId,
    },
    { onConflict: "agent_id" },
  );

  if (error) return { ok: false, error: error.message };

  const updated = await getArenaAdminAgent(slug);
  if (!updated) return { ok: false, error: "reload_failed" };
  return { ok: true, record: updated };
}
