// Minimal Slack incoming-webhook helper. Audit confirmed no Slack
// integration exists in the Longboard repo today; adding a
// dependency-free helper that POSTs to a pre-created webhook URL.
//
// Env var: SLACK_STRATEGIES_WEBHOOK_URL — the Incoming Webhook created
// for #longboard-strategies. Set in .env.local for local runs and in
// the OpenClaw session env for scheduled cron runs.

type SlackPayload = {
  text: string;
  /** Optional Slack block-kit blocks. Stringly-typed on purpose —
   *  callers pass whatever shape they've assembled. */
  blocks?: unknown[];
};

/** Posts a text (and optional blocks) payload to the strategies webhook.
 *  Throws on misconfig or non-2xx response. No retries; if the morning
 *  routine can't reach Slack, that's a `strat_runs.status = 'error'`
 *  state the caller handles explicitly. */
export async function postStrategiesSlack(payload: SlackPayload): Promise<void> {
  const url = process.env.SLACK_STRATEGIES_WEBHOOK_URL;
  if (!url) {
    throw new Error("SLACK_STRATEGIES_WEBHOOK_URL not configured");
  }

  const body: Record<string, unknown> = { text: payload.text };
  if (payload.blocks && payload.blocks.length > 0) {
    body.blocks = payload.blocks;
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`slack webhook ${res.status}: ${text.slice(0, 200)}`);
  }
}

/** Returns true if the webhook URL is set. Used by the morning routine's
 *  credential preflight so we can abort before burning a Claude call. */
export function slackConfigured(): boolean {
  return !!process.env.SLACK_STRATEGIES_WEBHOOK_URL;
}
