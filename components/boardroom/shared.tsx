"use client";

import React from "react";

export const font = "var(--font-labels)";

export function SectionHeader({
  title, right, action,
}: {
  title: string;
  right?: string;
  action?: React.ReactNode;
}) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "baseline",
      marginBottom: 14, paddingBottom: 8, borderBottom: "1px solid var(--border)",
    }}>
      <div style={{
        fontSize: 14, color: "var(--text-secondary)", letterSpacing: "0.1em",
        textTransform: "uppercase", fontWeight: 600,
      }}>
        {title}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        {right && <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{right}</div>}
        {action}
      </div>
    </div>
  );
}

export function Card({
  children, style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 6, padding: "14px 16px", ...style,
    }}>
      {children}
    </div>
  );
}

export function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: "var(--surface)", border: "1px dashed var(--border)",
      borderRadius: 6, padding: "20px 16px", textAlign: "center",
      fontSize: 12, color: "var(--text-secondary)", fontStyle: "italic",
    }}>
      {children}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <div style={{
        fontSize: 10, color: "var(--text-secondary)", letterSpacing: 1.5,
        textTransform: "uppercase", marginBottom: 4,
      }}>
        {label}
      </div>
      {children}
    </label>
  );
}

export function Input({
  value, onChange, type = "text", placeholder, disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      style={{
        width: "100%", background: "var(--bg)", border: "1px solid var(--border)",
        padding: "8px 10px", borderRadius: 3, color: "var(--text-primary)",
        fontFamily: font, fontSize: 13, outline: "none",
      }}
    />
  );
}

export function Textarea({
  value, onChange, rows = 3, placeholder, disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      placeholder={placeholder}
      disabled={disabled}
      style={{
        width: "100%", background: "var(--bg)", border: "1px solid var(--border)",
        padding: "8px 10px", borderRadius: 3, color: "var(--text-primary)",
        fontFamily: font, fontSize: 13, outline: "none", resize: "vertical",
        lineHeight: 1.5,
      }}
    />
  );
}

export function Select<T extends string>({
  value, options, onChange,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      style={{
        width: "100%", background: "var(--bg)", border: "1px solid var(--border)",
        padding: "8px 10px", borderRadius: 3, color: "var(--text-primary)",
        fontFamily: font, fontSize: 13, outline: "none",
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export function PublishToggle({
  value, onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-primary)" }}>
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        style={{ accentColor: "var(--accent)" }}
      />
      Published (visible to members)
    </label>
  );
}

export function PublishPill({ on }: { on: boolean }) {
  const color = on ? "var(--accent)" : "var(--text-secondary)";
  return (
    <span style={{
      fontSize: 9, padding: "2px 8px", border: `1px solid ${color}`,
      color, borderRadius: 2, textTransform: "uppercase", letterSpacing: 1, fontWeight: 600,
    }}>
      {on ? "Published" : "Draft"}
    </span>
  );
}

/** Header for a member-side /boardroom card. Optional pencil/done
 *  button on the right when isAdmin — drives the card's inline edit
 *  toggle. The `right` slot is for non-admin chrome (e.g. + Submit on
 *  FeatureRequests). */
export function CardHeader({
  title, isAdmin, editing, onToggle, right,
}: {
  title: string;
  isAdmin?: boolean;
  editing?: boolean;
  onToggle?: () => void;
  right?: React.ReactNode;
}) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "baseline",
      marginBottom: 14,
    }}>
      <div style={{
        fontSize: 10, color: "var(--text-secondary)", letterSpacing: 2,
        textTransform: "uppercase", fontWeight: 600,
      }}>
        {title}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        {right}
        {isAdmin && onToggle && (
          <button
            onClick={onToggle}
            aria-label={editing ? "Done editing" : "Edit"}
            title={editing ? "Done" : "Edit"}
            style={{
              background: "transparent",
              border: `1px solid ${editing ? "var(--accent)" : "var(--border)"}`,
              color: editing ? "var(--accent)" : "var(--text-secondary)",
              padding: "2px 8px", borderRadius: 3,
              fontSize: 11, lineHeight: 1, cursor: "pointer",
              fontFamily: font,
            }}
          >
            {editing ? "× Done" : "✎ Edit"}
          </button>
        )}
      </div>
    </div>
  );
}

export function RowActions({
  onEdit, onDelete, disabled,
}: {
  onEdit: () => void;
  onDelete: () => void;
  disabled: boolean;
}) {
  return (
    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
      <button onClick={onEdit} disabled={disabled} style={smallBtn("var(--text-secondary)")}>EDIT</button>
      <button onClick={onDelete} disabled={disabled} style={smallBtn("var(--danger)")}>DELETE</button>
    </div>
  );
}

export function BtnRow({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", gap: 8, marginTop: 12 }}>{children}</div>;
}

export function BtnAccent({
  children, onClick, disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: "var(--accent)", color: "var(--bg)", border: "none",
      padding: "6px 14px", borderRadius: 3, fontFamily: font, fontSize: 11,
      fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase",
      cursor: disabled ? "wait" : "pointer", opacity: disabled ? 0.6 : 1,
    }}>{children}</button>
  );
}

export function BtnGhost({
  children, onClick, disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: "transparent", color: "var(--text-primary)",
      border: "1px solid var(--border)",
      padding: "6px 14px", borderRadius: 3, fontFamily: font, fontSize: 11,
      fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase",
      cursor: disabled ? "wait" : "pointer", opacity: disabled ? 0.6 : 1,
    }}>{children}</button>
  );
}

export function smallBtn(color: string): React.CSSProperties {
  return {
    background: "transparent", border: `1px solid ${color}`, color,
    padding: "4px 10px", borderRadius: 3, fontFamily: font, fontSize: 10,
    fontWeight: 700, letterSpacing: 1, cursor: "pointer",
  };
}
