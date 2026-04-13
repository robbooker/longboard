"use client";

import React from "react";

const font = '"IBM Plex Mono", ui-monospace, Menlo, monospace';

type BrokerCardProps = {
  broker: "alpaca_paper" | "tradezero_live";
  label: string;
  accountId: string;
  source: "env" | "user";
  status: "ok" | "error" | "loading";
  equity?: number;
  buyingPower?: number;
  errorMessage?: string;
  isLive?: boolean;
  onTestConnection: () => void;
};

export default function BrokerCard({
  label,
  accountId,
  source,
  status,
  equity,
  buyingPower,
  errorMessage,
  isLive,
  onTestConnection,
}: BrokerCardProps) {
  const statusColor = status === "ok" ? "var(--accent)" : status === "error" ? "var(--danger)" : "var(--text-secondary)";
  const sourceLabel = source === "env" ? "Configured via environment" : "Configured by user";

  return (
    <div style={{
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: 6,
      padding: 20,
      fontFamily: font,
      display: "flex",
      flexDirection: "column",
      gap: 14,
    }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 8, height: 8, borderRadius: "50%",
            background: statusColor,
            boxShadow: status === "ok" ? "0 0 6px var(--accent)" : undefined,
          }} />
          <span style={{ fontSize: 18, color: "var(--text-primary)", fontWeight: 500, letterSpacing: 0.5 }}>
            {label}
          </span>
        </div>
        {isLive && (
          <span style={{
            fontSize: 9, padding: "2px 8px", border: "1px solid var(--live)",
            color: "var(--live)", borderRadius: 2, textTransform: "uppercase",
            letterSpacing: 1, fontWeight: 600,
          }}>
            LIVE
          </span>
        )}
      </div>

      {/* Account ID */}
      <div>
        <div style={{ fontSize: 12, color: "var(--text-secondary)", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 4 }}>
          Account
        </div>
        <div style={{ fontSize: 16, color: "var(--text-primary)", fontWeight: 500, letterSpacing: 0.5 }}>
          {accountId}
        </div>
      </div>

      {/* Equity / Buying Power */}
      {status === "ok" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 4 }}>
              Equity
            </div>
            <div style={{ fontSize: 16, color: "var(--accent)", fontWeight: 500 }}>
              ${equity?.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? "\u2014"}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 4 }}>
              Buying Power
            </div>
            <div style={{ fontSize: 16, color: "var(--text-primary)", fontWeight: 500 }}>
              ${buyingPower?.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? "\u2014"}
            </div>
          </div>
        </div>
      )}

      {/* Loading state */}
      {status === "loading" && (
        <div style={{ fontSize: 12, color: "var(--text-secondary)", fontStyle: "italic" }}>
          Connecting...
        </div>
      )}

      {/* Error state */}
      {status === "error" && (
        <div style={{
          background: "var(--danger-15)", border: "1px solid var(--danger-30)",
          borderRadius: 4, padding: "8px 12px", fontSize: 11,
          color: "var(--danger)", lineHeight: 1.5,
        }}>
          {errorMessage || "Connection failed"}
        </div>
      )}

      {/* Test Connection button */}
      <button
        onClick={onTestConnection}
        disabled={status === "loading"}
        style={{
          background: "transparent",
          border: "1px solid var(--text-secondary)",
          color: "var(--text-secondary)",
          fontFamily: font,
          fontSize: 13,
          padding: "10px 16px",
          borderRadius: 3,
          cursor: status === "loading" ? "wait" : "pointer",
          letterSpacing: 1,
          textTransform: "uppercase",
          alignSelf: "flex-start",
          opacity: status === "loading" ? 0.5 : 1,
          transition: "all 150ms",
        }}
      >
        Test Connection
      </button>

      {/* Source badge */}
      <div style={{
        fontSize: 9, color: "var(--text-secondary)", letterSpacing: 1,
        paddingTop: 8, borderTop: "1px solid var(--border)",
      }}>
        {sourceLabel}
      </div>
    </div>
  );
}
