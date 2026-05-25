import type { RvolScannerHit } from "@/lib/scanners/rvolScanner";

export type RvolSlackResult = {
  ok: boolean;
  status: number;
  error: string | null;
};

type SendRvolSlackInput = {
  hit: RvolScannerHit;
  etDate: string;
  url: string;
};

function webhookUrl() {
  return process.env.SLACK_RVOL_WEBHOOK_URL;
}

export function isRvolSlackConfigured() {
  return Boolean(webhookUrl());
}

function signedPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function slackMessage(input: SendRvolSlackInput) {
  const { hit, etDate, url } = input;
  return (
    `:rotating_light: *RVOL print: ${hit.ticker}*\n` +
    `${hit.signalRvol.toFixed(1)}x RVOL at ${hit.signalTimeEt} ET · ` +
    `$${hit.signalPrice.toFixed(2)} · ${signedPercent(hit.changePct)}\n` +
    `Signal date: ${etDate}\n` +
    `→ <${url}|Open Longboard scanner>`
  );
}

export async function sendRvolSlackAlert(input: SendRvolSlackInput): Promise<RvolSlackResult> {
  const url = webhookUrl();
  if (!url) return { ok: false, status: 500, error: "SLACK_RVOL_WEBHOOK_URL not configured." };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: slackMessage(input) }),
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return { ok: false, status: response.status, error: `slack webhook ${response.status}: ${text.slice(0, 200)}` };
  }

  return { ok: true, status: response.status, error: null };
}
