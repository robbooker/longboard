"use client";

import React, { useEffect, useRef, useState } from "react";

const font = '"IBM Plex Mono", ui-monospace, Menlo, monospace';

type Broker = "alpaca" | "tradezero";

type AlpacaView = {
  configured: boolean;
  api_key_set: boolean;
  api_secret_set: boolean;
  base_url: string | null;
  updated_at: string | null;
};

type TradeZeroView = {
  configured: boolean;
  proxy_url: string | null;
  proxy_api_key_set: boolean;
  account_id: string | null;
  updated_at: string | null;
};

type BrokerKeysGetResult = { alpaca: AlpacaView; tradezero: TradeZeroView };

type FieldKind = "secret" | "text";

type FieldConfig = {
  label: string;
  displayLabel: string;
  kind: FieldKind;
  placeholder?: string;
};

const ALPACA_FIELDS: FieldConfig[] = [
  { label: "api_key", displayLabel: "API Key", kind: "secret" },
  { label: "api_secret", displayLabel: "API Secret", kind: "secret" },
  { label: "base_url", displayLabel: "Base URL", kind: "text", placeholder: "https://paper-api.alpaca.markets/v2" },
];

const TZ_FIELDS: FieldConfig[] = [
  { label: "proxy_url", displayLabel: "Proxy URL", kind: "text", placeholder: "https://[project].supabase.co/functions/v1/tradezero-proxy" },
  { label: "proxy_api_key", displayLabel: "Proxy API Key", kind: "secret" },
  { label: "account_id", displayLabel: "Account ID", kind: "text", placeholder: "2TZ35309" },
];

function fmtTime(iso: string | null): string {
  if (!iso) return "never";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function KeysClient({ initialData }: { initialData: BrokerKeysGetResult }) {
  const [data, setData] = useState<BrokerKeysGetResult>(initialData);
  const [confirmClear, setConfirmClear] = useState<Broker | null>(null);
  const [confirmWorking, setConfirmWorking] = useState(false);

  async function refresh() {
    const res = await fetch("/api/settings/keys", { cache: "no-store" });
    if (res.ok) setData(await res.json());
  }

  async function runClear() {
    if (!confirmClear) return;
    setConfirmWorking(true);
    try {
      const res = await fetch("/api/settings/keys", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ broker: confirmClear }),
      });
      if (res.ok) setData(await res.json());
    } finally {
      setConfirmWorking(false);
      setConfirmClear(null);
    }
  }

  return (
    <div style={{ fontFamily: font, color: "var(--text-primary)", padding: "32px 24px", maxWidth: 880, margin: "0 auto" }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 10, color: "var(--text-secondary)", letterSpacing: 3, textTransform: "uppercase", marginBottom: 6 }}>
          LONGBOARD.AI
        </div>
        <div style={{ fontSize: 22, color: "var(--accent)", fontWeight: 500, letterSpacing: 1 }}>
          Broker API Keys
        </div>
      </div>

      <div style={{
        background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6,
        padding: "14px 16px", marginBottom: 24, fontSize: 13, lineHeight: 1.6, color: "var(--text-primary)",
      }}>
        Your broker API keys are encrypted at rest using Supabase Vault. They are decrypted only at the
        moment we make a request to the broker on your behalf, and are never logged or sent to the
        browser after they are saved. To use Longboard&apos;s trading dashboards, configure at least one
        broker.
      </div>

      <BrokerCard
        title="Alpaca (Paper or Live)"
        broker="alpaca"
        fields={ALPACA_FIELDS}
        view={data.alpaca}
        isConfigured={data.alpaca.configured}
        fieldStatus={{
          api_key: data.alpaca.api_key_set,
          api_secret: data.alpaca.api_secret_set,
          base_url: data.alpaca.base_url != null,
        }}
        initialTextValues={{ base_url: data.alpaca.base_url ?? "" }}
        onSaved={refresh}
        onRequestClear={() => setConfirmClear("alpaca")}
      />

      <div style={{ height: 20 }} />

      <BrokerCard
        title="TradeZero"
        broker="tradezero"
        fields={TZ_FIELDS}
        view={data.tradezero}
        isConfigured={data.tradezero.configured}
        fieldStatus={{
          proxy_url: data.tradezero.proxy_url != null,
          proxy_api_key: data.tradezero.proxy_api_key_set,
          account_id: data.tradezero.account_id != null,
        }}
        initialTextValues={{
          proxy_url: data.tradezero.proxy_url ?? "",
          account_id: data.tradezero.account_id ?? "",
        }}
        onSaved={refresh}
        onRequestClear={() => setConfirmClear("tradezero")}
      />

      {confirmClear && (
        <ConfirmClearModal
          broker={confirmClear}
          working={confirmWorking}
          onConfirm={runClear}
          onCancel={() => setConfirmClear(null)}
        />
      )}
    </div>
  );
}

type BrokerView = AlpacaView | TradeZeroView;

function BrokerCard({
  title,
  broker,
  fields,
  view,
  isConfigured,
  fieldStatus,
  initialTextValues,
  onSaved,
  onRequestClear,
}: {
  title: string;
  broker: Broker;
  fields: FieldConfig[];
  view: BrokerView;
  isConfigured: boolean;
  fieldStatus: Record<string, boolean>;
  initialTextValues: Record<string, string>;
  onSaved: () => Promise<void>;
  onRequestClear: () => void;
}) {
  // Build initial form values each render based on the latest view. We
  // seed non-secret fields with their decrypted stored value and secrets
  // with empty. Dirty is tracked separately — resetting to initial on save.
  const buildInitial = React.useCallback((): Record<string, string> => {
    const init: Record<string, string> = {};
    for (const f of fields) {
      init[f.label] = f.kind === "text" ? (initialTextValues[f.label] ?? "") : "";
    }
    return init;
  }, [fields, initialTextValues]);

  const [values, setValues] = useState<Record<string, string>>(buildInitial);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // When the server view changes (e.g. after save or after Clear All), reset
  // the form to the new initial state and clear dirty tracking.
  useEffect(() => {
    setValues(buildInitial());
    setDirty(new Set());
    setRevealed(new Set());
  }, [buildInitial]);

  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  function onFieldChange(label: string, value: string) {
    setValues((v) => ({ ...v, [label]: value }));
    setDirty((d) => {
      const next = new Set(d);
      next.add(label);
      return next;
    });
    setError(null);
  }

  function toggleReveal(label: string) {
    setRevealed((r) => {
      const next = new Set(r);
      if (next.has(label)) next.delete(label); else next.add(label);
      return next;
    });
  }

  async function onSave() {
    const payload: Record<string, string> = {};
    for (const f of fields) {
      if (!dirty.has(f.label)) continue;
      const v = values[f.label] ?? "";
      if (v.length === 0) {
        setError(`${f.displayLabel} cannot be empty. Use "Clear All Keys" to remove values.`);
        return;
      }
      payload[f.label] = v;
    }
    if (Object.keys(payload).length === 0) return;

    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ broker, values: payload }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? data.error ?? `HTTP ${res.status}`);
        return;
      }
      await onSaved();
      const now = new Date().toLocaleTimeString();
      setSavedFlash(`Saved at ${now}`);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setSavedFlash(null), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "save_failed");
    } finally {
      setSaving(false);
    }
  }

  const dirtyCount = dirty.size;

  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6,
      padding: 20,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <div style={{ fontSize: 16, color: "var(--text-primary)", fontWeight: 600, letterSpacing: 0.5 }}>
          {title}
        </div>
        <StatusPill configured={isConfigured} />
      </div>
      <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 18 }}>
        Last updated {fmtTime(view.updated_at)}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {fields.map((f) => (
          <FieldRow
            key={f.label}
            field={f}
            value={values[f.label] ?? ""}
            revealed={revealed.has(f.label)}
            stored={fieldStatus[f.label] ?? false}
            onChange={(v) => onFieldChange(f.label, v)}
            onToggleReveal={() => toggleReveal(f.label)}
          />
        ))}
      </div>

      {error && (
        <div style={{
          marginTop: 14, background: "var(--danger-20)", border: "1px solid var(--danger)",
          color: "var(--danger)", padding: "8px 12px", borderRadius: 4, fontSize: 12,
        }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 20 }}>
        <button
          onClick={onSave}
          disabled={saving || dirtyCount === 0}
          style={{
            background: "transparent", border: "1px solid var(--accent)", color: "var(--accent)",
            padding: "8px 16px", borderRadius: 3, fontFamily: font, fontSize: 11,
            fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase",
            cursor: saving || dirtyCount === 0 ? "not-allowed" : "pointer",
            opacity: saving || dirtyCount === 0 ? 0.4 : 1,
          }}
        >
          {saving ? "Saving…" : dirtyCount === 0 ? "No changes" : `Save (${dirtyCount})`}
        </button>

        {savedFlash && (
          <span style={{
            fontSize: 11, color: "var(--accent)", letterSpacing: 0.5,
            transition: "opacity 500ms",
          }}>
            ✓ {savedFlash}
          </span>
        )}

        <div style={{ flex: 1 }} />

        <button
          onClick={onRequestClear}
          disabled={!isConfigured && !fields.some((f) => fieldStatus[f.label])}
          style={{
            background: "transparent", border: "1px solid var(--danger)", color: "var(--danger)",
            padding: "6px 12px", borderRadius: 3, fontFamily: font, fontSize: 10,
            fontWeight: 700, letterSpacing: 1, textTransform: "uppercase",
            cursor: "pointer",
          }}
        >
          Clear All Keys
        </button>
      </div>
    </div>
  );
}

function FieldRow({
  field, value, revealed, stored, onChange, onToggleReveal,
}: {
  field: FieldConfig;
  value: string;
  revealed: boolean;
  stored: boolean;
  onChange: (v: string) => void;
  onToggleReveal: () => void;
}) {
  const isSecret = field.kind === "secret";
  const placeholder = isSecret
    ? (stored ? "•••••••• (already set — type to replace)" : "Enter value")
    : (field.placeholder ?? "");

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <label style={{ fontSize: 10, color: "var(--text-secondary)", letterSpacing: 1.5, textTransform: "uppercase" }}>
          {field.displayLabel}
          {stored && <span style={{ marginLeft: 8, color: "var(--accent)", fontSize: 9 }}>● stored</span>}
        </label>
        {isSecret && (
          <button
            type="button"
            onClick={onToggleReveal}
            style={{
              background: "transparent", border: "none", color: "var(--text-secondary)",
              fontFamily: font, fontSize: 10, cursor: "pointer", letterSpacing: 1,
              textTransform: "uppercase",
            }}
          >
            {revealed ? "hide" : "show"}
          </button>
        )}
      </div>
      <input
        type={isSecret && !revealed ? "password" : "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        style={{
          width: "100%", padding: "8px 10px",
          background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 3,
          color: "var(--text-primary)", fontFamily: font, fontSize: 13, outline: "none",
          boxSizing: "border-box",
        }}
      />
    </div>
  );
}

function StatusPill({ configured }: { configured: boolean }) {
  const color = configured ? "var(--accent)" : "var(--warning)";
  return (
    <span style={{
      fontSize: 10, padding: "2px 8px", border: `1px solid ${color}`,
      color, borderRadius: 2, textTransform: "uppercase", letterSpacing: 1, fontWeight: 600,
    }}>
      {configured ? "Configured" : "Not Configured"}
    </span>
  );
}

function ConfirmClearModal({
  broker, working, onConfirm, onCancel,
}: {
  broker: Broker;
  working: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
    >
      <div style={{
        background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6,
        padding: 24, minWidth: 380, maxWidth: 480, fontFamily: font,
      }}>
        <div style={{ fontSize: 11, color: "var(--text-secondary)", letterSpacing: 2, textTransform: "uppercase", marginBottom: 10 }}>
          Confirm
        </div>
        <div style={{ fontSize: 16, color: "var(--text-primary)", fontWeight: 500, marginBottom: 12 }}>
          Clear all {broker === "alpaca" ? "Alpaca" : "TradeZero"} keys?
        </div>
        <div style={{ fontSize: 13, color: "var(--text-primary)", lineHeight: 1.5, marginBottom: 20 }}>
          This removes every stored secret for {broker === "alpaca" ? "Alpaca" : "TradeZero"} from the
          vault. The relevant dashboard will stop working until you re-enter credentials.
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            disabled={working}
            onClick={onConfirm}
            style={{
              background: "var(--danger)", color: "var(--bg)", border: "none",
              padding: "10px 18px", borderRadius: 3, fontFamily: font, fontSize: 12,
              fontWeight: 700, letterSpacing: 1.5, cursor: working ? "wait" : "pointer",
              opacity: working ? 0.6 : 1,
            }}
          >
            {working ? "…" : "CONFIRM CLEAR"}
          </button>
          <button
            disabled={working}
            onClick={onCancel}
            style={{
              background: "transparent", color: "var(--text-primary)", border: "1px solid var(--border)",
              padding: "10px 18px", borderRadius: 3, fontFamily: font, fontSize: 12,
              fontWeight: 700, letterSpacing: 1.5, cursor: "pointer",
            }}
          >
            CANCEL
          </button>
        </div>
      </div>
    </div>
  );
}
