export type OneSignalPushResult = {
  ok: boolean;
  id: string | null;
  status: number;
  error: string | null;
  warnings: unknown;
};

type SendOneSignalPushInput = {
  userIds: string[];
  heading: string;
  content: string;
  url: string;
  data?: Record<string, string | number | boolean | null>;
  name?: string;
  topic?: string;
};

export function isOneSignalConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID && process.env.ONESIGNAL_REST_API_KEY);
}

export async function sendOneSignalPush(input: SendOneSignalPushInput): Promise<OneSignalPushResult> {
  const appId = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_REST_API_KEY;

  if (!appId || !apiKey) {
    return {
      ok: false,
      id: null,
      status: 500,
      error: "OneSignal is not configured.",
      warnings: null,
    };
  }

  const userIds = Array.from(new Set(input.userIds.filter(Boolean)));
  if (userIds.length === 0) {
    return {
      ok: true,
      id: null,
      status: 200,
      error: null,
      warnings: "No opted-in users.",
    };
  }

  const response = await fetch("https://api.onesignal.com/notifications?c=push", {
    method: "POST",
    headers: {
      "Authorization": `Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      app_id: appId,
      target_channel: "push",
      include_aliases: { external_id: userIds },
      headings: { en: input.heading },
      contents: { en: input.content },
      web_url: input.url,
      name: input.name,
      web_push_topic: input.topic,
      data: input.data,
    }),
  });

  const payload = await response.json().catch(() => null);
  const id = typeof payload?.id === "string" ? payload.id : null;

  return {
    ok: response.ok && !payload?.errors,
    id,
    status: response.status,
    error: response.ok ? (payload?.errors ? JSON.stringify(payload.errors) : null) : JSON.stringify(payload),
    warnings: payload?.warnings ?? null,
  };
}
