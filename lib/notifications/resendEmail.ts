export type ResendEmailResult = {
  ok: boolean;
  id: string | null;
  status: number;
  error: string | null;
};

type SendRvolEmailInput = {
  recipients: string[];
  ticker: string;
  resolution?: "1m" | "5m";
  signalRvol: number;
  signalTimeEt: string;
  signalPrice: number;
  changePct: number;
  url: string;
};

export function isRvolEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.RVOL_ALERTS_FROM_EMAIL);
}

function uniqueEmails(recipients: string[]) {
  return Array.from(new Set(recipients.map((email) => email.trim().toLowerCase()).filter(Boolean)));
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function sendRvolAlertEmail(input: SendRvolEmailInput): Promise<ResendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RVOL_ALERTS_FROM_EMAIL;
  const to = uniqueEmails(input.recipients);

  if (!apiKey || !from) {
    return { ok: false, id: null, status: 500, error: "RVOL email alerts are not configured." };
  }

  if (to.length === 0) {
    return { ok: true, id: null, status: 200, error: null };
  }

  const changePrefix = input.changePct >= 0 ? "+" : "";
  const label = input.resolution === "5m" ? "RVOL 5m print" : "RVOL 1m print";
  const subject = `${input.ticker} ${label}`;
  const summary = `${input.signalRvol.toFixed(1)}x RVOL at ${input.signalTimeEt} ET / $${input.signalPrice.toFixed(2)} / ${changePrefix}${input.changePct.toFixed(1)}%`;
  const safeTicker = escapeHtml(input.ticker);
  const safeSummary = escapeHtml(summary);

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      text: `${input.ticker} ${label}\n\n${summary}\n\nOpen scanner: ${input.url}`,
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.45;color:#15120b">
          <p style="margin:0 0 12px;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#b8860b">Longboard RVOL Alert</p>
          <h1 style="margin:0 0 8px;font-size:24px">${safeTicker} ${escapeHtml(label)}</h1>
          <p style="margin:0 0 18px;font-size:16px">${safeSummary}</p>
          <p style="margin:0"><a href="${escapeHtml(input.url)}">Open the RVOL scanner</a></p>
        </div>
      `,
      tags: [{ name: "signal", value: "rvol" }],
    }),
  });

  const payload = await response.json().catch(() => null);
  const id = typeof payload?.id === "string" ? payload.id : null;

  return {
    ok: response.ok && !payload?.error,
    id,
    status: response.status,
    error: response.ok ? (payload?.error ? JSON.stringify(payload.error) : null) : JSON.stringify(payload),
  };
}
