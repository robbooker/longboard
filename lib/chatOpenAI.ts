const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

export const CHAT_NANO_MODEL = process.env.CHAT_BUDDY_OPENAI_MODEL || "gpt-4.1-nano";

type NanoChatInput = {
  instructions: string;
  input: string;
  maxTokens?: number;
};

export async function runNanoChat({ instructions, input, maxTokens = 500 }: NanoChatInput) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("chat_ai_not_configured");

  const response = await fetch(OPENAI_CHAT_URL, {
    method: "POST",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: CHAT_NANO_MODEL,
      store: false,
      max_completion_tokens: maxTokens,
      messages: [
        { role: "system", content: instructions },
        { role: "user", content: input },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`chat_ai_request_failed:${response.status}:${detail.slice(0, 160)}`);
  }

  const result = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = result.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("chat_ai_empty_response");
  return text;
}
