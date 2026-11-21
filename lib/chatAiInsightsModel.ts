// #482: the one place AI Insights calls Claude (ANTHROPIC_API_KEY, already set in Vercel). Tests pass
// their own AiInsightsModel instead, so they never reach the API.
import Anthropic from "@anthropic-ai/sdk";
import { AI_INSIGHTS_MODEL } from "@/lib/chatAiInsights";

export type AiInsightsRequest = {
  /** Stable instructions, cached. */
  system: string;
  /** Large context shared by several requests (the day's chat), cached after the instructions. */
  context?: string;
  user: string;
  kind: "writeup" | "answer";
};

export type AiInsightsModel = (request: AiInsightsRequest) => Promise<string>;

export class AiInsightsModelError extends Error {}

export const claudeAiInsightsModel: AiInsightsModel = async (request) => {
  if (!process.env.ANTHROPIC_API_KEY) throw new AiInsightsModelError("anthropic_not_configured");
  const writeup = request.kind === "writeup";
  // The write-up runs in a 300-second cron; an answer runs after a chat send (60 seconds).
  const client = new Anthropic({ timeout: writeup ? 240_000 : 45_000, maxRetries: writeup ? 1 : 0 });
  const system: Anthropic.TextBlockParam[] = [
    {
      type: "text",
      text: request.system,
      ...(request.context ? {} : { cache_control: { type: "ephemeral" as const } }),
    },
    ...(request.context
      ? [{ type: "text" as const, text: request.context, cache_control: { type: "ephemeral" as const } }]
      : []),
  ];
  const response = await client.messages.create({
    model: AI_INSIGHTS_MODEL,
    max_tokens: writeup ? 16_000 : 4_000,
    // Thinking is always on for this model; effort sets how much. The write-up is worth a careful read.
    output_config: { effort: writeup ? "high" : "low" },
    system,
    messages: [{ role: "user", content: request.user }],
  });
  if (response.stop_reason === "refusal") throw new AiInsightsModelError("model_refused");
  if (response.stop_reason === "max_tokens") throw new AiInsightsModelError("model_cut_off");
  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
  if (!text) throw new AiInsightsModelError("model_empty");
  return text;
};
