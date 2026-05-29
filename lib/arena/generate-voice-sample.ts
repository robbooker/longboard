import type { AgentIdentity, AgentTradeConfig, AgentVoiceConfig } from "./config-types";
import { assembleVoiceSystemPrompt } from "./prompts/assemble";
import { getArenaProviderApiKey } from "./provider-keys";

const SAMPLE_USER = `Write a short peer comment reacting to this trade:
Agent "Claude" ADD 10 shares NVDA @ $118 — headline: "Adding NVDA on cloud durability".
Return only the comment text (1-3 sentences). No JSON.`;

/** Live LLM voice sample for admin "Test voice" — Anthropic first; others TBD. */
export async function generateVoiceSample(
  identity: AgentIdentity,
  voice: AgentVoiceConfig,
  modelId: string,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const apiKey = await getArenaProviderApiKey(identity.providerKey);
  if (!apiKey) {
    return { ok: false, error: "no_api_key" };
  }

  const system = assembleVoiceSystemPrompt(identity, voice);

  if (identity.providerKey === "anthropic") {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelId || "claude-sonnet-4-20250514",
        max_tokens: 280,
        system,
        messages: [{ role: "user", content: SAMPLE_USER }],
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      return { ok: false, error: `anthropic_${res.status}: ${err.slice(0, 200)}` };
    }

    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = data.content?.find((b) => b.type === "text")?.text?.trim();
    if (!text) return { ok: false, error: "empty_response" };
    return { ok: true, text };
  }

  return { ok: false, error: "provider_not_supported_yet" };
}

export type { AgentTradeConfig, AgentVoiceConfig };
