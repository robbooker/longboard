// Sends a whisper transcript to Claude for Levine-voice rewrite.
// Returns the full essay markdown (frontmatter + body) as a string.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = join(__dirname, "..", "prompts", "levine-essay.md");

/** Reads the Levine prompt template and sends it + the transcript
 *  to Claude. Returns the raw markdown output (frontmatter + body).
 *
 *  The prompt file is read fresh on every call so edits to
 *  scripts/prompts/levine-essay.md take effect without restarting. */
export async function rewriteTranscript(transcript, { episode, model = "claude-sonnet-4-20250514" } = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set in environment");

  const promptTemplate = readFileSync(PROMPT_PATH, "utf8");

  const systemPrompt = promptTemplate;
  const userMessage = [
    `Episode number: ${episode}`,
    `Published date: ${new Date().toISOString().slice(0, 10)}`,
    "",
    "--- TRANSCRIPT ---",
    "",
    transcript,
  ].join("\n");

  const client = new Anthropic({ apiKey });

  process.stdout.write(`Sending transcript to Claude (${model})...\n`);

  const response = await client.messages.create({
    model,
    max_tokens: 16000,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  // Extract the text content from the response.
  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  if (!text || text.length < 200) {
    throw new Error(`Claude returned unexpectedly short response (${text.length} chars)`);
  }

  const usage = response.usage;
  process.stdout.write(
    `Claude response: ${text.length} chars, ${usage.input_tokens} input / ${usage.output_tokens} output tokens\n`,
  );

  return text;
}
