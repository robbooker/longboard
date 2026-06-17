export type BugSlackInput = {
  id: string;
  title: string;
  description: string;
  pageUrl: string | null;
  reporterEmail: string | null;
  adminUrl: string;
};

export type BugSlackResult = {
  ok: boolean;
  status: number;
  error: string | null;
};

function webhookUrl() {
  return process.env.SLACK_BUGS_WEBHOOK_URL;
}

export function isBugSlackConfigured() {
  return Boolean(webhookUrl());
}

function truncate(text: string, max: number) {
  return text.length <= max ? text : `${text.slice(0, max - 1)}...`;
}

function slackText(input: BugSlackInput) {
  const reporter = input.reporterEmail || "Unknown reporter";
  const lines = [
    `:bug: *Longboard bug report:* ${input.title}`,
    `Reporter: ${reporter}`,
  ];

  if (input.pageUrl) lines.push(`Page: ${input.pageUrl}`);
  lines.push(`Report: ${truncate(input.description, 1200)}`);
  lines.push(`Review: <${input.adminUrl}|Open admin bug inbox>`);

  return lines.join("\n");
}

export async function sendBugSlackReport(input: BugSlackInput): Promise<BugSlackResult> {
  const url = webhookUrl();
  if (!url) {
    return { ok: false, status: 500, error: "SLACK_BUGS_WEBHOOK_URL not configured." };
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: slackText(input) }),
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return { ok: false, status: response.status, error: `slack webhook ${response.status}: ${text.slice(0, 200)}` };
  }

  return { ok: true, status: response.status, error: null };
}
