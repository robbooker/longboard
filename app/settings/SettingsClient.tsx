"use client";

import React, { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import BrokerCard from "@/components/BrokerCard";
import KillSwitchToggle from "@/components/KillSwitchToggle";

const font = "Helvetica, Arial, sans-serif";
const mono = "'Courier New', Courier, monospace";

type ServerInfo = {
  supabaseProjectId: string | null;
  vercelUrl: string | null;
  gitSha: string | null;
  appVersion: string;
  disableOrderSubmission: boolean;
};

type BrokerStatus = {
  status: "ok" | "error";
  accountId?: string;
  equity?: number;
  buyingPower?: number;
  errorMessage?: string;
};

type ProviderStatus = {
  status: "ok" | "configured" | "missing" | "error";
  errorMessage?: string;
};

type StatusResponse = {
  alpaca_paper: BrokerStatus;
  tradezero_live: BrokerStatus;
  polygon: ProviderStatus;
  exa: ProviderStatus;
  perplexity: ProviderStatus;
  anthropic: ProviderStatus;
};

type Props = {
  currentUserId: string | null;
  email: string;
  lastSignIn: string | null;
  serverInfo: ServerInfo;
};

type Theme = "dark" | "light" | "statement";
const THEMES: readonly Theme[] = ["light", "dark", "statement"];
const ONE_SIGNAL_APP_ID = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
const ALERT_PREF_KEY = "longboard:rvol-browser-alerts-enabled";

type BrowserAlertPermission = NotificationPermission | "unsupported";

type NotificationPreference = {
  browserPushEnabled: boolean;
  emailEnabled: boolean;
  oneSignalConfigured: boolean;
  emailChannelConfigured: boolean;
  email: string;
};

type RvolHistoryAlert = {
  alertKey: string;
  etDate: string;
  ticker: string;
  signalTimeEt: string;
  signalRvol: number;
  signalPrice: number;
  changePct: number;
  recipientsCount: number;
  browserPushRecipientsCount: number;
  emailRecipientsCount: number;
  status: "pending" | "sent" | "skipped" | "failed";
  error: string | null;
  createdAt: string;
};

type OneSignalClient = {
  setConsentGiven(given: boolean): void;
  login(externalId: string): Promise<void>;
  logout(): Promise<void>;
  Notifications: {
    isPushSupported(): boolean;
    permission: boolean;
    requestPermission(): Promise<void> | void;
  };
  User: {
    PushSubscription: {
      optIn(): Promise<void> | void;
      optOut(): Promise<void> | void;
    };
  };
};

function withOneSignal<T>(callback: (OneSignal: OneSignalClient) => Promise<T> | T): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const win = window as Window & {
      OneSignalDeferred?: Array<(OneSignal: OneSignalClient) => void | Promise<void>>;
    };
    win.OneSignalDeferred = win.OneSignalDeferred || [];
    win.OneSignalDeferred.push(async (OneSignal) => {
      try {
        resolve(await callback(OneSignal));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function isTheme(v: string | null): v is Theme {
  return v === "light" || v === "dark" || v === "statement";
}

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const attr = document.documentElement.getAttribute("data-theme");
  if (isTheme(attr)) return attr;
  const stored = localStorage.getItem("longboard-theme");
  if (isTheme(stored)) return stored;
  return "light";
}

export default function SettingsClient({ currentUserId, email, lastSignIn, serverInfo }: Props) {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [notificationPreference, setNotificationPreference] = useState<NotificationPreference | null>(null);
  const [notificationLoading, setNotificationLoading] = useState(true);
  const [notificationSaving, setNotificationSaving] = useState<"browser" | "email" | null>(null);
  const [notificationMessage, setNotificationMessage] = useState<string | null>(null);
  const [rvolHistory, setRvolHistory] = useState<RvolHistoryAlert[]>([]);
  const [rvolHistoryLoading, setRvolHistoryLoading] = useState(true);
  const [rvolHistoryError, setRvolHistoryError] = useState<string | null>(null);
  const [browserAlertPermission, setBrowserAlertPermission] = useState<BrowserAlertPermission>("default");
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ password: "", confirm: "" });
  const [passwordStatus, setPasswordStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [passwordLoading, setPasswordLoading] = useState(false);

  useLayoutEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const applyTheme = (next: Theme) => {
    setTheme(next);
    localStorage.setItem("longboard-theme", next);
    document.documentElement.setAttribute("data-theme", next);
  };

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/status");
      if (!res.ok) throw new Error("Failed to fetch");
      const data: StatusResponse = await res.json();
      setStatus(data);
    } catch {
      // Keep existing status on refetch error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30_000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const fetchNotificationPreference = useCallback(async () => {
    setNotificationLoading(true);
    try {
      if (typeof window !== "undefined" && !ONE_SIGNAL_APP_ID) {
        setBrowserAlertPermission("unsupported");
      } else if (typeof window !== "undefined" && "Notification" in window) {
        setBrowserAlertPermission(window.Notification.permission);
      } else {
        setBrowserAlertPermission("unsupported");
      }

      const res = await fetch("/api/notifications/rvol/preference", { cache: "no-store" });
      if (!res.ok) throw new Error("Unable to load notification preferences.");
      const data: NotificationPreference = await res.json();
      setNotificationPreference(data);
    } catch (error) {
      setNotificationMessage(error instanceof Error ? error.message : "Unable to load notification preferences.");
    } finally {
      setNotificationLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNotificationPreference();
  }, [fetchNotificationPreference]);

  const fetchRvolHistory = useCallback(async () => {
    setRvolHistoryError(null);
    try {
      const res = await fetch("/api/notifications/rvol/history?limit=20", { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(typeof json?.message === "string" ? json.message : "Unable to load RVOL alert history.");
      }
      setRvolHistory(Array.isArray(json?.alerts) ? json.alerts : []);
    } catch (error) {
      setRvolHistoryError(error instanceof Error ? error.message : "Unable to load RVOL alert history.");
    } finally {
      setRvolHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRvolHistory();
    const interval = setInterval(fetchRvolHistory, 60_000);
    return () => clearInterval(interval);
  }, [fetchRvolHistory]);

  async function saveNotificationPreference(update: { browserPushEnabled?: boolean; emailEnabled?: boolean }) {
    const response = await fetch("/api/notifications/rvol/preference", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
    });

    const json = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(typeof json?.error === "string" ? json.error : "Unable to save notification preference.");
    }

    setNotificationPreference(json);
    return json as NotificationPreference;
  }

  async function toggleBrowserAlerts() {
    setNotificationMessage(null);

    if (!currentUserId) {
      setNotificationMessage("Sign in to enable RVOL alerts.");
      return;
    }

    if (!ONE_SIGNAL_APP_ID || !("Notification" in window)) {
      setBrowserAlertPermission("unsupported");
      setNotificationMessage("Browser push is not configured for this environment.");
      return;
    }

    setNotificationSaving("browser");
    try {
      const enabled = notificationPreference?.browserPushEnabled === true;
      if (enabled) {
        await withOneSignal(async (OneSignal) => {
          await OneSignal.User.PushSubscription.optOut();
          await OneSignal.logout();
          OneSignal.setConsentGiven(false);
        }).catch(() => undefined);
        await saveNotificationPreference({ browserPushEnabled: false });
        void fetchRvolHistory();
        window.localStorage.setItem(ALERT_PREF_KEY, "false");
        setNotificationMessage("Browser RVOL alerts are off.");
        return;
      }

      await withOneSignal(async (OneSignal) => {
        OneSignal.setConsentGiven(true);
        if (!OneSignal.Notifications.isPushSupported()) {
          setBrowserAlertPermission("unsupported");
          throw new Error("This browser does not support web push.");
        }

        await OneSignal.login(currentUserId);
        await OneSignal.Notifications.requestPermission();
        await OneSignal.User.PushSubscription.optIn();
        const permission = window.Notification.permission;
        setBrowserAlertPermission(permission);

        if (permission !== "granted" || !OneSignal.Notifications.permission) {
          throw new Error("Notification permission was not granted.");
        }
      });

      await saveNotificationPreference({ browserPushEnabled: true });
      void fetchRvolHistory();
      window.localStorage.setItem(ALERT_PREF_KEY, "true");
      setNotificationMessage("Browser RVOL alerts are on.");
    } catch (error) {
      setNotificationMessage(error instanceof Error ? error.message : "Unable to update browser alerts.");
    } finally {
      setNotificationSaving(null);
    }
  }

  async function toggleEmailAlerts() {
    setNotificationMessage(null);
    setNotificationSaving("email");
    try {
      const next = notificationPreference?.emailEnabled !== true;
      await saveNotificationPreference({ emailEnabled: next });
      void fetchRvolHistory();
      setNotificationMessage(next ? "Email RVOL alerts are on." : "Email RVOL alerts are off.");
    } catch (error) {
      const message = error instanceof Error && error.message === "email_channel_not_configured"
        ? "Email alerts need RESEND_API_KEY and RVOL_ALERTS_FROM_EMAIL configured first."
        : error instanceof Error
          ? error.message
          : "Unable to update email alerts.";
      setNotificationMessage(message);
    } finally {
      setNotificationSaving(null);
    }
  }

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordStatus(null);

    if (passwordForm.password !== passwordForm.confirm) {
      setPasswordStatus({ type: "error", message: "Passwords do not match" });
      return;
    }
    if (passwordForm.password.length < 8) {
      setPasswordStatus({ type: "error", message: "Password must be at least 8 characters" });
      return;
    }

    setPasswordLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password: passwordForm.password });

    if (error) {
      setPasswordStatus({ type: "error", message: error.message });
    } else {
      setPasswordStatus({ type: "success", message: "Password updated successfully" });
      setPasswordForm({ password: "", confirm: "" });
    }
    setPasswordLoading(false);
  };

  const alpaca = status?.alpaca_paper;
  const tz = status?.tradezero_live;

  const providers: { name: string; key: keyof Pick<StatusResponse, "polygon" | "exa" | "perplexity" | "anthropic"> }[] = [
    { name: "Polygon", key: "polygon" },
    { name: "Exa", key: "exa" },
    { name: "Perplexity", key: "perplexity" },
    { name: "Anthropic", key: "anthropic" },
  ];

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "10px 12px", background: "var(--surface)",
    border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-primary)",
    fontFamily: font, fontSize: 14, outline: "none", boxSizing: "border-box",
  };

  return (
    <>
      <div className="settings-v2">
        <style>{`
          .settings-v2{
            --bg:#F6F2E9;
            --surface:#FBF8F0;
            --surface-hi:#EFEADD;
            --border:rgba(21,18,11,0.16);
            --text-primary:#15120B;
            --text-secondary:rgba(21,18,11,0.58);
            --text-tertiary:rgba(21,18,11,0.42);
            --accent:#B8860B;
            --accent-10:rgba(245,165,36,0.12);
            --accent-15:rgba(245,165,36,0.16);
            --accent-20:rgba(245,165,36,0.22);
            --danger:#C8283D;
            --danger-15:rgba(200,40,61,0.12);
            --danger-20:rgba(200,40,61,0.16);
            --danger-30:rgba(200,40,61,0.24);
            --danger-40:rgba(200,40,61,0.38);
            --live:#C8283D;
            --warning:#B8860B;
            --warning-10:rgba(184,134,11,0.12);
            min-height:calc(100vh - 124px);
            background:var(--bg);
            color:var(--text-primary);
            font-family:${font};
            -webkit-font-smoothing:antialiased;
          }
          .settings-v2 *{box-sizing:border-box}
          .settings-shell{max-width:1180px;margin:0 auto;padding:34px 28px 72px}
          .settings-crumb{
            font-family:${mono};font-size:11px;letter-spacing:1.8px;
            color:var(--accent);font-weight:700;margin-bottom:14px;
            text-transform:uppercase;
          }
          .settings-crumb span{color:var(--text-secondary);margin:0 8px}
          .settings-page-head{
            display:flex;align-items:flex-end;justify-content:space-between;gap:24px;flex-wrap:wrap;
            border-bottom:2px solid #F5A524;padding-bottom:22px;margin-bottom:28px;
          }
          .settings-title{margin:0;font-size:60px;line-height:.94;letter-spacing:-2.2px;font-weight:800}
          .settings-title em{font-family:Georgia,'Times New Roman',serif;font-weight:500;color:var(--accent)}
          .settings-sub{font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:18px;color:rgba(21,18,11,.72);margin-top:12px;max-width:680px;line-height:1.45}
          .settings-theme-toggle{
            display:flex;gap:4px;padding:4px;background:var(--surface);
            border:1px solid var(--border);
          }
          @media (max-width:720px){
            .settings-shell{padding:28px 16px 56px}
            .settings-title{font-size:44px;letter-spacing:-1.4px}
            .settings-page-head{align-items:flex-start}
            .settings-theme-toggle{width:100%;overflow:auto}
          }
        `}</style>

        <main className="settings-shell">
          {/* Page header */}
          <div className="settings-crumb">LONGBOARD.AI <span>/</span> OPERATIONS</div>
          <div className="settings-page-head">
            <div>
              <h1 className="settings-title">Settings <em>Desk</em></h1>
              <div className="settings-sub">
                Account access, broker connections, provider status, and the order-submission kill switch.
              </div>
            </div>
            <div className="settings-theme-toggle" aria-label="Site theme preference">
            {THEMES.map((t) => {
              const active = theme === t;
              return (
                <button
                  key={t}
                  onClick={() => applyTheme(t)}
                  style={{
                    background: active ? "#15120B" : "transparent",
                    color: active ? "#F5A524" : "var(--text-secondary)",
                    border: "none",
                    padding: "8px 12px",
                    fontFamily: mono, fontSize: 10, letterSpacing: 1.4,
                    textTransform: "uppercase", fontWeight: 500,
                    cursor: active ? "default" : "pointer",
                    transition: "all 150ms",
                  }}
                >
                  {t}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── 1. Account ── */}
        <Section title="Account">
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 4 }}>
                  Email
                </div>
                <div style={{ fontSize: 16, color: "var(--text-primary)", fontWeight: 500 }}>{email}</div>
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 4 }}>
                  Last Sign In
                </div>
                <div style={{ fontSize: 16, color: "var(--text-primary)", fontWeight: 500 }}>
                  {lastSignIn ? new Date(lastSignIn).toLocaleString() : "\u2014"}
                </div>
              </div>
              <span style={{
                fontSize: 9, padding: "3px 10px", border: "1px solid var(--accent)",
                color: "var(--accent)", borderRadius: 2, textTransform: "uppercase",
                letterSpacing: 1, fontWeight: 600, background: "var(--accent-10)",
              }}>
                ON ALLOWLIST
              </span>
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => setShowPasswordModal(true)}
                style={{
                  background: "transparent", border: "1px solid var(--text-secondary)", color: "var(--text-secondary)",
                  fontFamily: font, fontSize: 13, padding: "10px 16px", borderRadius: 3,
                  cursor: "pointer", letterSpacing: 1, textTransform: "uppercase",
                  transition: "all 150ms",
                }}
              >
                Change Password
              </button>
              <button
                onClick={handleSignOut}
                style={{
                  background: "transparent", border: "1px solid var(--danger-40)", color: "var(--danger)",
                  fontFamily: font, fontSize: 13, padding: "10px 16px", borderRadius: 3,
                  cursor: "pointer", letterSpacing: 1, textTransform: "uppercase",
                  transition: "all 150ms",
                }}
              >
                Sign Out
              </button>
            </div>
          </div>
        </Section>

        {/* ── 2. Signal Alerts ── */}
        <Section title="Signal Alerts">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
            <AlertChannelCard
              title="Browser Push"
              description={
                browserAlertPermission === "denied"
                  ? "Chrome is blocking notifications for Longboard. Re-enable them in Chrome site settings."
                  : "RVOL prints can follow you across browser tabs after Chrome permission is granted."
              }
              status={browserAlertPermission === "denied" ? "Blocked in Chrome" : notificationPreference?.browserPushEnabled ? "On" : "Off"}
              enabled={notificationPreference?.browserPushEnabled === true}
              disabled={notificationLoading || notificationSaving !== null || browserAlertPermission === "unsupported"}
              loading={notificationSaving === "browser"}
              onToggle={toggleBrowserAlerts}
            />
            <AlertChannelCard
              title="Email"
              description={
                notificationPreference?.emailChannelConfigured
                  ? `Send RVOL prints to ${notificationPreference.email || email}.`
                  : "Email delivery is wired for Resend and needs provider env vars before users can enable it."
              }
              status={notificationPreference?.emailChannelConfigured ? (notificationPreference?.emailEnabled ? "On" : "Off") : "Needs provider"}
              enabled={notificationPreference?.emailEnabled === true}
              disabled={notificationLoading || notificationSaving !== null || !notificationPreference?.emailChannelConfigured}
              loading={notificationSaving === "email"}
              onToggle={toggleEmailAlerts}
            />
          </div>
          {notificationMessage && (
            <div style={{
              marginTop: 12, fontFamily: mono, fontSize: 10, letterSpacing: 1,
              color: "var(--text-secondary)", textTransform: "uppercase",
            }}>
              {notificationMessage}
            </div>
          )}
        </Section>

        {/* ── 3. RVOL Notification History ── */}
        <Section title="RVOL Notification History">
          <RvolHistoryPanel
            alerts={rvolHistory}
            loading={rvolHistoryLoading}
            error={rvolHistoryError}
            onRefresh={() => {
              setRvolHistoryLoading(true);
              void fetchRvolHistory();
            }}
          />
        </Section>

        {/* ── 4. Connected Brokers ── */}
        <Section title="Connected Brokers">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 16 }}>
            <BrokerCard
              broker="alpaca_paper"
              label="Alpaca Paper"
              accountId={alpaca?.accountId ?? "\u2014"}
              source="env"
              status={loading ? "loading" : (alpaca?.status ?? "error")}
              equity={alpaca?.equity}
              buyingPower={alpaca?.buyingPower}
              errorMessage={alpaca?.errorMessage}
              onTestConnection={fetchStatus}
            />
            <BrokerCard
              broker="tradezero_live"
              label="TradeZero Live"
              accountId={tz?.accountId ?? "\u2014"}
              source="env"
              status={loading ? "loading" : (tz?.status ?? "error")}
              equity={tz?.equity}
              buyingPower={tz?.buyingPower}
              errorMessage={tz?.errorMessage}
              isLive
              onTestConnection={fetchStatus}
            />
          </div>
        </Section>

        {/* ── 5. Data Providers ── */}
        <Section title="Data Providers">
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            {providers.map(({ name, key }) => {
              const p = status?.[key];
              const isOk = p?.status === "ok" || p?.status === "configured";
              return (
                <div key={key} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 0", borderBottom: "1px solid var(--border)",
                }}>
                  <div style={{
                    width: 6, height: 6, borderRadius: "50%",
                    background: loading ? "var(--text-secondary)" : isOk ? "var(--accent)" : "var(--text-secondary)",
                    boxShadow: !loading && isOk ? "0 0 4px var(--accent)" : undefined,
                    flexShrink: 0,
                  }} />
                  <span style={{ fontSize: 14, color: "var(--text-primary)", flex: 1 }}>{name}</span>
                  <span style={{ fontSize: 10, color: "var(--text-secondary)", letterSpacing: 0.5 }}>
                    {loading
                      ? "checking..."
                      : p?.status === "ok"
                        ? "connected"
                        : p?.status === "configured"
                          ? "api key set"
                          : "not configured"}
                  </span>
                </div>
              );
            })}
          </div>
        </Section>

        {/* ── 6. Session Info ── */}
        <Section title="Session Info">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            <InfoItem label="Supabase Project" value={serverInfo.supabaseProjectId ?? "\u2014"} />
            <InfoItem label="Deploy URL" value={serverInfo.vercelUrl ?? "localhost"} />
            <InfoItem label="Git SHA" value={serverInfo.gitSha ?? "dev"} />
            <InfoItem label="App Version" value={`v${serverInfo.appVersion}`} />
          </div>
        </Section>

        {/* ── Broker API Keys link ── */}
        <Link
          href="/settings/keys"
          style={{
            display: "block", marginTop: 32, padding: 20,
            background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6,
            textDecoration: "none", color: "inherit",
            transition: "border-color 150ms",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{
                fontSize: 14, color: "var(--text-primary)", letterSpacing: "0.05em",
                fontWeight: 600, marginBottom: 6,
              }}>
                Broker API Keys
              </div>
              <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                Configure Alpaca and TradeZero credentials.
              </div>
            </div>
            <div style={{ fontSize: 18, color: "var(--text-secondary)" }}>→</div>
          </div>
        </Link>

        {/* ── Danger Zone ── */}
        <div style={{
          marginTop: 24, padding: 20, background: "var(--surface)",
          border: "1px solid var(--danger-30)", borderRadius: 6,
        }}>
          <div style={{
            fontSize: 14, color: "var(--danger)", letterSpacing: "0.1em", textTransform: "uppercase",
            fontWeight: 600, marginBottom: 14,
          }}>
            Danger Zone
          </div>
          <KillSwitchToggle />
        </div>

        {/* ── Change Password Modal ── */}
        {showPasswordModal && (
          <div
            style={{
              position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
              display: "flex", alignItems: "center", justifyContent: "center",
              zIndex: 1000,
            }}
            onClick={(e) => { if (e.target === e.currentTarget) setShowPasswordModal(false); }}
          >
            <div style={{
              background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6,
              padding: 28, width: "100%", maxWidth: 380, fontFamily: font,
            }}>
              <div style={{
                fontSize: 16, color: "var(--accent)", fontWeight: 500,
                marginBottom: 20, letterSpacing: 0.5,
              }}>
                Change Password
              </div>

              <form onSubmit={handleChangePassword} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {passwordStatus && (
                  <div style={{
                    padding: "8px 12px", borderRadius: 4, fontSize: 11,
                    ...(passwordStatus.type === "error"
                      ? { background: "var(--danger-20)", border: "1px solid var(--danger)", color: "var(--danger)" }
                      : { background: "var(--accent-20)", border: "1px solid var(--accent)", color: "var(--accent)" }),
                  }}>
                    {passwordStatus.message}
                  </div>
                )}

                <div>
                  <label style={{
                    fontSize: 12, color: "var(--text-secondary)", letterSpacing: 1.5, textTransform: "uppercase",
                    display: "block", marginBottom: 6,
                  }}>
                    New Password
                  </label>
                  <input
                    type="password"
                    value={passwordForm.password}
                    onChange={(e) => setPasswordForm(f => ({ ...f, password: e.target.value }))}
                    required
                    autoFocus
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label style={{
                    fontSize: 12, color: "var(--text-secondary)", letterSpacing: 1.5, textTransform: "uppercase",
                    display: "block", marginBottom: 6,
                  }}>
                    Confirm Password
                  </label>
                  <input
                    type="password"
                    value={passwordForm.confirm}
                    onChange={(e) => setPasswordForm(f => ({ ...f, confirm: e.target.value }))}
                    required
                    style={inputStyle}
                  />
                </div>

                <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
                  <button
                    type="submit"
                    disabled={passwordLoading}
                    style={{
                      background: "transparent", border: "1px solid var(--accent)", color: "var(--accent)",
                      fontFamily: font, fontSize: 13, padding: "10px 16px", borderRadius: 3,
                      cursor: passwordLoading ? "wait" : "pointer", letterSpacing: 1.5,
                      textTransform: "uppercase", fontWeight: 600,
                      opacity: passwordLoading ? 0.6 : 1,
                    }}
                  >
                    {passwordLoading ? "Updating..." : "Update"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowPasswordModal(false);
                      setPasswordStatus(null);
                      setPasswordForm({ password: "", confirm: "" });
                    }}
                    style={{
                      background: "transparent", border: "1px solid var(--text-secondary)", color: "var(--text-secondary)",
                      fontFamily: font, fontSize: 13, padding: "10px 16px", borderRadius: 3,
                      cursor: "pointer", letterSpacing: 1.5, textTransform: "uppercase",
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
        </main>
      </div>
    </>
  );
}

/* ── Helper components ── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 30 }}>
      <div style={{
        fontFamily: mono, fontSize: 11, color: "var(--accent)", letterSpacing: "0.16em", textTransform: "uppercase",
        fontWeight: 700, marginBottom: 14, paddingBottom: 10,
        borderBottom: "1px solid var(--border)",
      }}>
        {title}
      </div>
      {children}
    </section>
  );
}

function AlertChannelCard({
  title,
  description,
  status,
  enabled,
  disabled,
  loading,
  onToggle,
}: {
  title: string;
  description: string;
  status: string;
  enabled: boolean;
  disabled: boolean;
  loading: boolean;
  onToggle: () => void;
}) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", padding: 16 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14 }}>
        <div>
          <div style={{
            fontFamily: mono, fontSize: 10, color: "var(--accent)", letterSpacing: 1.5,
            textTransform: "uppercase", marginBottom: 7, fontWeight: 700,
          }}>
            {title}
          </div>
          <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.45, maxWidth: 420 }}>
            {description}
          </div>
        </div>
        <button
          type="button"
          onClick={onToggle}
          disabled={disabled}
          aria-pressed={enabled}
          style={{
            width: 58, height: 28, flexShrink: 0, padding: 3,
            border: `1px solid ${enabled ? "var(--accent)" : "var(--border)"}`,
            background: enabled ? "var(--accent-15)" : "var(--surface-hi)",
            opacity: disabled ? 0.58 : 1,
            cursor: disabled ? "not-allowed" : "pointer",
            display: "flex", alignItems: "center",
            justifyContent: enabled ? "flex-end" : "flex-start",
            transition: "all 150ms",
          }}
        >
          <span style={{
            display: "block", width: 20, height: 20, borderRadius: "50%",
            background: enabled ? "var(--accent)" : "var(--text-tertiary)",
            boxShadow: enabled ? "0 0 8px var(--accent-20)" : undefined,
          }} />
        </button>
      </div>
      <div style={{
        marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--border)",
        display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center",
        fontFamily: mono, fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase",
      }}>
        <span style={{ color: "var(--text-tertiary)" }}>Status</span>
        <span style={{ color: enabled ? "var(--accent)" : "var(--text-secondary)" }}>
          {loading ? "Saving..." : status}
        </span>
      </div>
    </div>
  );
}

function formatSignedPercent(value: number) {
  const prefix = value >= 0 ? "+" : "";
  return `${prefix}${value.toFixed(1)}%`;
}

function formatDollar(value: number) {
  return `$${value.toFixed(2)}`;
}

function formatHistoryTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "\u2014";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function statusColor(status: RvolHistoryAlert["status"]) {
  if (status === "sent") return "var(--accent)";
  if (status === "failed") return "var(--danger)";
  if (status === "pending") return "var(--warning)";
  return "var(--text-secondary)";
}

function RvolHistoryPanel({
  alerts,
  loading,
  error,
  onRefresh,
}: {
  alerts: RvolHistoryAlert[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  const renderedAlerts = loading && alerts.length === 0
    ? Array.from({ length: 3 }).map((_, index) => ({
        alertKey: `loading-${index}`,
        etDate: "\u2014",
        ticker: "\u2014",
        signalTimeEt: "\u2014",
        signalRvol: 0,
        signalPrice: 0,
        changePct: 0,
        recipientsCount: 0,
        browserPushRecipientsCount: 0,
        emailRecipientsCount: 0,
        status: "pending" as const,
        error: null,
        createdAt: "",
      }))
    : alerts;

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 14, padding: "14px 16px", borderBottom: "1px solid var(--border)",
      }}>
        <div>
          <div style={{
            fontFamily: mono, fontSize: 10, color: "var(--accent)", letterSpacing: 1.5,
            textTransform: "uppercase", marginBottom: 5, fontWeight: 700,
          }}>
            Recent RVOL Prints
          </div>
          <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.45 }}>
            A running ledger of RVOL alerts Longboard processed for push and email delivery.
          </div>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          style={{
            background: "transparent", border: "1px solid var(--border)", color: "var(--text-secondary)",
            fontFamily: mono, fontSize: 10, padding: "8px 10px", letterSpacing: 1.3,
            textTransform: "uppercase", cursor: loading ? "wait" : "pointer", flexShrink: 0,
            opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? "Refreshing" : "Refresh"}
        </button>
      </div>

      {error && (
        <div style={{
          padding: "12px 16px", borderBottom: "1px solid var(--border)",
          color: "var(--danger)", fontSize: 12,
        }}>
          {error}
        </div>
      )}

      {renderedAlerts.length === 0 ? (
        <div style={{ padding: 18, color: "var(--text-secondary)", fontSize: 13 }}>
          No RVOL alerts have been logged yet.
        </div>
      ) : (
        <div style={{ display: "grid" }}>
          {renderedAlerts.map((alert) => {
            const isPlaceholder = alert.alertKey.startsWith("loading-");
            return (
              <div
                key={alert.alertKey}
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                  gap: 14,
                  alignItems: "center",
                  padding: "14px 16px",
                  borderTop: "1px solid var(--border)",
                  opacity: isPlaceholder ? 0.45 : 1,
                }}
              >
                <div>
                  <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.6 }}>{alert.ticker}</div>
                  <div style={{ fontFamily: mono, fontSize: 10, color: "var(--text-tertiary)", letterSpacing: 1 }}>
                    {alert.etDate}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>
                    {isPlaceholder ? "\u2014" : `${alert.signalRvol.toFixed(1)}x RVOL at ${alert.signalTimeEt} ET`}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>
                    {isPlaceholder
                      ? "Loading alert history..."
                      : `${formatDollar(alert.signalPrice)} / ${formatSignedPercent(alert.changePct)}`}
                  </div>
                </div>
                <div style={{ fontFamily: mono, fontSize: 10, color: "var(--text-secondary)", letterSpacing: 1 }}>
                  <div>PUSH {alert.browserPushRecipientsCount}</div>
                  <div style={{ marginTop: 4 }}>EMAIL {alert.emailRecipientsCount}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{
                    fontFamily: mono, fontSize: 10, color: statusColor(alert.status), letterSpacing: 1.3,
                    textTransform: "uppercase", fontWeight: 700,
                  }}>
                    {alert.status}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 5 }}>
                    {isPlaceholder ? "\u2014" : formatHistoryTimestamp(alert.createdAt)}
                  </div>
                  {alert.error && (
                    <div style={{ fontSize: 10, color: "var(--danger)", marginTop: 5 }}>
                      {alert.error}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", padding: 16 }}>
      <div style={{
        fontFamily: mono, fontSize: 10, color: "var(--accent)", letterSpacing: 1.5, textTransform: "uppercase",
        marginBottom: 4,
      }}>
        {label}
      </div>
      <div style={{ fontSize: 18, color: "var(--text-primary)", fontWeight: 800, letterSpacing: -0.3, wordBreak: "break-all" }}>
        {value}
      </div>
    </div>
  );
}
