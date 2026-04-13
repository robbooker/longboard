"use client";

import React, { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import BrokerCard from "@/components/BrokerCard";
import KillSwitchToggle from "@/components/KillSwitchToggle";

const font = '"IBM Plex Mono", ui-monospace, Menlo, monospace';

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
  email: string;
  lastSignIn: string | null;
  serverInfo: ServerInfo;
};

function getInitialTheme(): "dark" | "light" {
  if (typeof window === "undefined") return "dark";
  return (localStorage.getItem("longboard-theme") as "dark" | "light") || "dark";
}

export default function SettingsClient({ email, lastSignIn, serverInfo }: Props) {
  const [theme, setTheme] = useState<"dark" | "light">(getInitialTheme);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ password: "", confirm: "" });
  const [passwordStatus, setPasswordStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [passwordLoading, setPasswordLoading] = useState(false);

  useLayoutEffect(() => {
    const el = document.getElementById("settings-page");
    if (el) el.dataset.theme = theme;
  }, [theme]);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("longboard-theme", next);
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
      <div style={{
        fontFamily: font, color: "var(--text-primary)", padding: "32px 24px",
        maxWidth: 960, margin: "0 auto",
      }}>
        {/* Page header */}
        <div style={{ marginBottom: 32, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 10, color: "var(--text-secondary)", letterSpacing: 3, textTransform: "uppercase", marginBottom: 6 }}>
              LONGBOARD.AI
            </div>
            <div style={{ fontSize: 22, color: "var(--accent)", fontWeight: 500, letterSpacing: 1 }}>
              Settings
            </div>
          </div>
          <button
            onClick={toggleTheme}
            style={{
              background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: 4, padding: "6px 12px", cursor: "pointer",
              fontFamily: font, fontSize: 11, letterSpacing: 1,
              color: "var(--text-secondary)", textTransform: "uppercase",
              display: "flex", alignItems: "center", gap: 6,
              transition: "all 150ms",
            }}
          >
            {theme === "dark" ? "\u2600" : "\u263E"}{" "}
            {theme === "dark" ? "LIGHT" : "DARK"}
          </button>
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

        {/* ── 2. Connected Brokers ── */}
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

        {/* ── 3. Data Providers ── */}
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

        {/* ── 4. Session Info ── */}
        <Section title="Session Info">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            <InfoItem label="Supabase Project" value={serverInfo.supabaseProjectId ?? "\u2014"} />
            <InfoItem label="Deploy URL" value={serverInfo.vercelUrl ?? "localhost"} />
            <InfoItem label="Git SHA" value={serverInfo.gitSha ?? "dev"} />
            <InfoItem label="App Version" value={`v${serverInfo.appVersion}`} />
          </div>
        </Section>

        {/* ── 5. Danger Zone ── */}
        <div style={{
          marginTop: 32, padding: 20, background: "var(--surface)",
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
      </div>
    </>
  );
}

/* ── Helper components ── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 32 }}>
      <div style={{
        fontSize: 14, color: "var(--text-secondary)", letterSpacing: "0.1em", textTransform: "uppercase",
        fontWeight: 600, marginBottom: 14, paddingBottom: 8,
        borderBottom: "1px solid var(--border)",
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{
        fontSize: 12, color: "var(--text-secondary)", letterSpacing: 1.5, textTransform: "uppercase",
        marginBottom: 4,
      }}>
        {label}
      </div>
      <div style={{ fontSize: 16, color: "var(--text-primary)", fontWeight: 500, wordBreak: "break-all" }}>
        {value}
      </div>
    </div>
  );
}
