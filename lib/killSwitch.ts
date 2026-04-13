import { createClient } from "@supabase/supabase-js";

export type KillSwitchReason = "env_override" | "soft_disabled";

export type KillSwitchState = {
  orderSubmissionEnabled: boolean;
  envOverride: boolean;
  effectiveEnabled: boolean;
  updatedByEmail: string | null;
  updatedAt: string | null;
};

export type IsEnabledResult = {
  enabled: boolean;
  reason?: KillSwitchReason;
};

function getServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Kill switch missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function getEnvOverride(): boolean {
  return process.env.DISABLE_ORDER_SUBMISSION === "true";
}

export async function getKillSwitchState(): Promise<KillSwitchState> {
  const envOverride = getEnvOverride();
  const supabase = getServiceRoleClient();

  const { data, error } = await supabase
    .from("app_settings")
    .select("order_submission_enabled, updated_by_email, updated_at")
    .eq("id", 1)
    .single();

  if (error || !data) {
    return {
      orderSubmissionEnabled: false,
      envOverride,
      effectiveEnabled: false,
      updatedByEmail: null,
      updatedAt: null,
    };
  }

  const orderSubmissionEnabled = !!data.order_submission_enabled;
  return {
    orderSubmissionEnabled,
    envOverride,
    effectiveEnabled: orderSubmissionEnabled && !envOverride,
    updatedByEmail: data.updated_by_email ?? null,
    updatedAt: data.updated_at ?? null,
  };
}

export async function isOrderSubmissionEnabled(): Promise<IsEnabledResult> {
  const state = await getKillSwitchState();
  if (state.envOverride) return { enabled: false, reason: "env_override" };
  if (!state.orderSubmissionEnabled) return { enabled: false, reason: "soft_disabled" };
  return { enabled: true };
}
