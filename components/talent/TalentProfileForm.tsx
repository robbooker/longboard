"use client";

import { FormEvent, useMemo, useState } from "react";
import type { TalentCategory, TalentCategoryId } from "@/lib/talent/categories";

export type TalentProfile = {
  categories: string[];
  otherStrengths: string;
  contributionInterests: string;
  availability: string;
  updatedAt: string | null;
};

type Props = {
  categories: TalentCategory[];
  initialProfile: TalentProfile | null;
  userEmail: string;
};

const groupLabels: Record<TalentCategory["group"], string> = {
  capital: "Capital",
  build: "Build",
  growth: "Growth",
  creative: "Creative",
  people: "People",
};

const groupOrder: TalentCategory["group"][] = ["capital", "build", "growth", "creative", "people"];

function formatUpdatedAt(value: string | null) {
  if (!value) return "Not submitted yet";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function normalizeCategories(values: string[], categories: TalentCategory[]) {
  const valid = new Set(categories.map((category) => category.id));
  return values.filter((value): value is TalentCategoryId => valid.has(value as TalentCategoryId));
}

export default function TalentProfileForm({ categories, initialProfile, userEmail }: Props) {
  const [selected, setSelected] = useState<TalentCategoryId[]>(
    normalizeCategories(initialProfile?.categories ?? [], categories)
  );
  const [otherStrengths, setOtherStrengths] = useState(initialProfile?.otherStrengths ?? "");
  const [contributionInterests, setContributionInterests] = useState(
    initialProfile?.contributionInterests ?? ""
  );
  const [availability, setAvailability] = useState(initialProfile?.availability ?? "");
  const [updatedAt, setUpdatedAt] = useState<string | null>(initialProfile?.updatedAt ?? null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const byGroup = useMemo(() => {
    return groupOrder.map((group) => ({
      group,
      categories: categories.filter((category) => category.group === group),
    }));
  }, [categories]);

  const selectedLabels = useMemo(() => {
    const labelById = new Map(categories.map((category) => [category.id, category.label]));
    return selected.map((id) => labelById.get(id)).filter((label): label is string => Boolean(label));
  }, [categories, selected]);

  function toggle(id: TalentCategoryId) {
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
    );
    setError(null);
    setNotice(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    setError(null);

    if (selected.length === 0) {
      setError("Pick at least one strength category so we can route opportunities correctly.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/talent/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categories: selected,
          otherStrengths,
          contributionInterests,
          availability,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      }

      setSelected(normalizeCategories(data.categories ?? selected, categories));
      setOtherStrengths(data.otherStrengths ?? "");
      setContributionInterests(data.contributionInterests ?? "");
      setAvailability(data.availability ?? "");
      setUpdatedAt(data.updatedAt ?? null);
      setNotice("Saved. Thank you for putting your name next to the work.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "save_failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="talent-page">
      <style>{`
        /* Hallmark · macrostructure: Workbench · tone: utilitarian · anchor hue: amber */
        .talent-page{
          --talent-paper:var(--bg);
          --talent-card:var(--surface);
          --talent-card-hi:var(--surface-hi);
          --talent-ink:var(--text-primary);
          --talent-muted:var(--text-secondary);
          --talent-faint:var(--text-tertiary);
          --talent-line:var(--border);
          --talent-accent:var(--accent);
          --talent-warm:#F5A524;
          --talent-danger:var(--danger);
          --talent-radius:6px;
          min-height:calc(100vh - 112px);
          background:var(--talent-paper);
          color:var(--talent-ink);
          font-family:var(--font-labels);
          letter-spacing:0;
        }
        .talent-page *{box-sizing:border-box}
        .talent-wrap{
          width:min(1180px,calc(100% - 40px));
          margin:0 auto;
          padding:34px 0 76px;
        }
        .talent-top{
          display:grid;
          grid-template-columns:minmax(0,1fr) minmax(220px,320px);
          gap:24px;
          align-items:end;
          border-bottom:1px solid var(--talent-line);
          padding-bottom:22px;
          margin-bottom:22px;
        }
        .talent-kicker{
          margin:0 0 9px;
          color:var(--talent-accent);
          font:700 11px/1 var(--font-mono);
          letter-spacing:2px;
          text-transform:uppercase;
        }
        .talent-title{
          margin:0;
          max-width:760px;
          font:500 clamp(36px,6vw,68px)/0.94 var(--font-serif);
          letter-spacing:0;
          overflow-wrap:anywhere;
        }
        .talent-deck{
          margin:13px 0 0;
          max-width:700px;
          color:var(--talent-muted);
          font-size:15px;
          line-height:1.6;
        }
        .talent-member{
          border:1px solid var(--talent-line);
          background:color-mix(in srgb,var(--talent-card) 72%,transparent);
          border-radius:var(--talent-radius);
          padding:16px;
          min-width:0;
        }
        .talent-member span{
          display:block;
          color:var(--talent-faint);
          font:700 10px/1.2 var(--font-mono);
          letter-spacing:1.5px;
          text-transform:uppercase;
        }
        .talent-member strong{
          display:block;
          margin-top:8px;
          color:var(--talent-ink);
          font-size:13px;
          line-height:1.35;
          overflow-wrap:anywhere;
        }
        .talent-grid{
          display:grid;
          grid-template-columns:minmax(0,1fr) 330px;
          gap:22px;
          align-items:start;
        }
        .talent-panel,
        .talent-summary{
          border:1px solid var(--talent-line);
          background:var(--talent-card);
          border-radius:var(--talent-radius);
        }
        .talent-panel{
          padding:22px;
        }
        .talent-summary{
          position:sticky;
          top:16px;
          padding:18px;
        }
        .talent-section + .talent-section{
          margin-top:26px;
          padding-top:22px;
          border-top:1px solid var(--talent-line);
        }
        .talent-section-head{
          display:flex;
          justify-content:space-between;
          gap:16px;
          align-items:flex-start;
          margin-bottom:14px;
        }
        .talent-section-title{
          margin:0;
          color:var(--talent-ink);
          font:700 13px/1.2 var(--font-mono);
          letter-spacing:1.2px;
          text-transform:uppercase;
        }
        .talent-section-note{
          margin:6px 0 0;
          max-width:620px;
          color:var(--talent-muted);
          font-size:13px;
          line-height:1.55;
        }
        .talent-count{
          min-width:78px;
          text-align:right;
          color:var(--talent-faint);
          font:700 11px/1.2 var(--font-mono);
          letter-spacing:1.1px;
          text-transform:uppercase;
        }
        .talent-groups{
          display:grid;
          gap:16px;
        }
        .talent-group-label{
          margin:0 0 8px;
          color:var(--talent-faint);
          font:700 10px/1.2 var(--font-mono);
          letter-spacing:1.5px;
          text-transform:uppercase;
        }
        .talent-options{
          display:grid;
          grid-template-columns:repeat(3,minmax(0,1fr));
          gap:8px;
        }
        .talent-option{
          min-height:46px;
          width:100%;
          border:1px solid var(--talent-line);
          border-radius:var(--talent-radius);
          background:var(--talent-card-hi);
          color:var(--talent-muted);
          cursor:pointer;
          text-align:left;
          padding:9px 10px;
          font:700 12px/1.2 var(--font-mono);
          letter-spacing:0;
          transition:transform 140ms var(--ease-out, ease-out),border-color 140ms var(--ease-out, ease-out),background 140ms var(--ease-out, ease-out),color 140ms var(--ease-out, ease-out);
        }
        .talent-option:hover{
          border-color:var(--talent-warm);
          color:var(--talent-ink);
          transform:translateY(-1px);
        }
        .talent-option:focus-visible,
        .talent-save:focus-visible{
          outline:2px solid var(--talent-warm);
          outline-offset:2px;
        }
        .talent-option[aria-pressed="true"]{
          background:var(--talent-ink);
          border-color:var(--talent-ink);
          color:var(--talent-card);
        }
        .talent-field{
          display:grid;
          gap:8px;
        }
        .talent-field + .talent-field{
          margin-top:16px;
        }
        .talent-label{
          color:var(--talent-ink);
          font:700 12px/1.2 var(--font-mono);
          letter-spacing:1px;
          text-transform:uppercase;
        }
        .talent-textarea,
        .talent-input{
          width:100%;
          border:1px solid var(--talent-line);
          border-radius:var(--talent-radius);
          background:var(--talent-card-hi);
          color:var(--talent-ink);
          font:500 14px/1.5 var(--font-labels);
          letter-spacing:0;
        }
        .talent-textarea{
          min-height:132px;
          resize:vertical;
          padding:13px 14px;
        }
        .talent-input{
          min-height:44px;
          padding:0 14px;
        }
        .talent-textarea::placeholder,
        .talent-input::placeholder{color:color-mix(in srgb,var(--talent-muted) 62%,transparent)}
        .talent-textarea:focus,
        .talent-input:focus{
          outline:none;
          border-color:var(--talent-warm);
          box-shadow:0 0 0 3px color-mix(in srgb,var(--talent-warm) 22%,transparent);
        }
        .talent-actions{
          display:flex;
          justify-content:space-between;
          gap:14px;
          align-items:center;
          margin-top:24px;
          padding-top:18px;
          border-top:1px solid var(--talent-line);
        }
        .talent-status{
          color:var(--talent-muted);
          font-size:13px;
          line-height:1.45;
        }
        .talent-status.error{color:var(--talent-danger)}
        .talent-status.success{color:var(--talent-accent)}
        .talent-save{
          min-height:42px;
          border:1px solid var(--talent-ink);
          border-radius:var(--talent-radius);
          background:var(--talent-ink);
          color:var(--talent-card);
          cursor:pointer;
          padding:0 18px;
          font:800 12px/1 var(--font-mono);
          letter-spacing:1.4px;
          text-transform:uppercase;
          white-space:nowrap;
        }
        .talent-save:hover{background:var(--talent-accent);border-color:var(--talent-accent)}
        .talent-save:disabled{
          cursor:not-allowed;
          opacity:0.58;
          transform:none;
        }
        .talent-summary-title{
          margin:0 0 12px;
          color:var(--talent-ink);
          font:700 12px/1.2 var(--font-mono);
          letter-spacing:1.2px;
          text-transform:uppercase;
        }
        .talent-summary-line{
          border-top:1px solid var(--talent-line);
          padding-top:14px;
          margin-top:14px;
        }
        .talent-summary-line span{
          display:block;
          color:var(--talent-faint);
          font:700 10px/1.2 var(--font-mono);
          letter-spacing:1.4px;
          text-transform:uppercase;
          margin-bottom:7px;
        }
        .talent-summary-line p{
          margin:0;
          color:var(--talent-muted);
          font-size:13px;
          line-height:1.5;
          overflow-wrap:anywhere;
        }
        .talent-chip-list{
          display:flex;
          flex-wrap:wrap;
          gap:7px;
        }
        .talent-chip{
          border:1px solid var(--talent-line);
          background:var(--talent-card-hi);
          border-radius:999px;
          color:var(--talent-ink);
          padding:5px 8px;
          font:700 11px/1.2 var(--font-mono);
          letter-spacing:0;
        }
        @media (max-width:920px){
          .talent-top,
          .talent-grid{grid-template-columns:1fr}
          .talent-summary{position:static}
          .talent-options{grid-template-columns:repeat(2,minmax(0,1fr))}
        }
        @media (max-width:560px){
          .talent-wrap{width:min(100% - 28px,1180px);padding-top:24px}
          .talent-panel{padding:16px}
          .talent-title{font-size:38px}
          .talent-options{grid-template-columns:1fr}
          .talent-section-head,
          .talent-actions{display:grid}
          .talent-count{text-align:left}
          .talent-save{width:100%}
        }
        @media (prefers-reduced-motion:reduce){
          .talent-option{transition:none}
          .talent-option:hover{transform:none}
        }
      `}</style>

      <div className="talent-wrap">
        <section className="talent-top" aria-labelledby="talent-title">
          <div>
            <p className="talent-kicker">Longboard / Boardroom talent</p>
            <h1 id="talent-title" className="talent-title">
              Put your strengths on the map.
            </h1>
            <p className="talent-deck">
              Bets had the right instinct: Longboard should know who can help with what.
              Choose any categories that fit, then add the specific ways you would like to
              contribute.
            </p>
          </div>
          <aside className="talent-member" aria-label="Member profile status">
            <span>Signed in as</span>
            <strong>{userEmail}</strong>
            <span style={{ marginTop: 14 }}>Last saved</span>
            <strong>{formatUpdatedAt(updatedAt)}</strong>
          </aside>
        </section>

        <div className="talent-grid">
          <form className="talent-panel" onSubmit={submit}>
            <section className="talent-section">
              <div className="talent-section-head">
                <div>
                  <h2 className="talent-section-title">Strength categories</h2>
                  <p className="talent-section-note">
                    Pick as many as apply. This is intentionally broad so opportunities can
                    find the right people fast.
                  </p>
                </div>
                <div className="talent-count">{selected.length} selected</div>
              </div>

              <div className="talent-groups">
                {byGroup.map(({ group, categories: groupCategories }) => (
                  <div key={group}>
                    <p className="talent-group-label">{groupLabels[group]}</p>
                    <div className="talent-options">
                      {groupCategories.map((category) => {
                        const active = selected.includes(category.id);
                        return (
                          <button
                            key={category.id}
                            type="button"
                            className="talent-option"
                            aria-pressed={active}
                            onClick={() => toggle(category.id)}
                          >
                            {category.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="talent-section">
              <div className="talent-section-head">
                <div>
                  <h2 className="talent-section-title">Specific strengths</h2>
                  <p className="talent-section-note">
                    Add anything the categories miss: tools, industries, networks, hard-won
                    experience, favorite kinds of problems.
                  </p>
                </div>
              </div>
              <label className="talent-field">
                <span className="talent-label">What are you especially good at?</span>
                <textarea
                  className="talent-textarea"
                  value={otherStrengths}
                  onChange={(event) => setOtherStrengths(event.target.value)}
                  maxLength={5000}
                  placeholder="Example: closing enterprise deals, designing onboarding flows, building React apps, reviewing financial models..."
                />
              </label>
              <label className="talent-field">
                <span className="talent-label">How would you like to contribute?</span>
                <textarea
                  className="talent-textarea"
                  value={contributionInterests}
                  onChange={(event) => setContributionInterests(event.target.value)}
                  maxLength={5000}
                  placeholder="Example: introduce Longboard to partners, review product ideas, mentor members, help with design, advise on pricing..."
                />
              </label>
              <label className="talent-field">
                <span className="talent-label">Availability or boundaries</span>
                <input
                  className="talent-input"
                  value={availability}
                  onChange={(event) => setAvailability(event.target.value)}
                  maxLength={1000}
                  placeholder="Example: one intro a month, async feedback only, open to a working group..."
                />
              </label>
            </section>

            <div className="talent-actions">
              <div className={`talent-status${error ? " error" : ""}${notice ? " success" : ""}`} aria-live="polite">
                {error ?? notice ?? "Your answers are saved to your Boardroom talent profile."}
              </div>
              <button className="talent-save" type="submit" disabled={saving}>
                {saving ? "Saving..." : "Save Profile"}
              </button>
            </div>
          </form>

          <aside className="talent-summary" aria-label="Talent profile summary">
            <h2 className="talent-summary-title">Your current profile</h2>
            <div className="talent-chip-list">
              {selectedLabels.length > 0 ? (
                selectedLabels.map((label) => (
                  <span key={label} className="talent-chip">
                    {label}
                  </span>
                ))
              ) : (
                <span className="talent-chip">No categories yet</span>
              )}
            </div>
            <div className="talent-summary-line">
              <span>Strengths</span>
              <p>{otherStrengths.trim() || "Add the concrete strengths Longboard should know about."}</p>
            </div>
            <div className="talent-summary-line">
              <span>Contribution</span>
              <p>{contributionInterests.trim() || "Describe the ways you would enjoy helping the business."}</p>
            </div>
            <div className="talent-summary-line">
              <span>Availability</span>
              <p>{availability.trim() || "Optional, but useful when the team follows up."}</p>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
