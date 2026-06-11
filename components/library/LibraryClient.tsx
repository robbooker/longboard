"use client";

import { useMemo, useState } from "react";
import {
  libraryResourceTypes,
  libraryTypeLabels,
  type LibraryResource,
  type LibraryResourceType,
} from "@/lib/library/resources";

type Filter = "all" | LibraryResourceType;

type Props = {
  resources: LibraryResource[];
};

const typeOrder: Filter[] = ["all", ...libraryResourceTypes];

const typeStyles: Record<LibraryResourceType, { bg: string; fg: string; border: string }> = {
  presentation: { bg: "#fff3d9", fg: "#7a4d00", border: "#e5be6d" },
  pdf: { bg: "#f3eee4", fg: "#4e3f2c", border: "#c9bfa8" },
  indicator: { bg: "#e6f5ee", fg: "#006b41", border: "#8bc9ad" },
  video: { bg: "#e8f0ff", fg: "#244c8f", border: "#9cb7e6" },
  replay: { bg: "#fbe8e4", fg: "#8b2a20", border: "#dfaaa0" },
  worksheet: { bg: "#edf1e8", fg: "#3f5e2e", border: "#b8c7a4" },
  link: { bg: "#eeeeee", fg: "#383838", border: "#c8c8c8" },
};

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function matchResource(resource: LibraryResource, needle: string) {
  if (!needle) return true;
  const haystack = [
    resource.title,
    resource.description,
    resource.format ?? "",
    resource.sourceNote ?? "",
    libraryTypeLabels[resource.type],
    ...resource.tags,
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(needle);
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

export default function LibraryClient({ resources }: Props) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [featuredOnly, setFeaturedOnly] = useState(false);
  const normalizedQuery = normalize(query);

  const filteredResources = useMemo(() => {
    return resources
      .filter((resource) => filter === "all" || resource.type === filter)
      .filter((resource) => !featuredOnly || resource.featured)
      .filter((resource) => matchResource(resource, normalizedQuery));
  }, [resources, filter, featuredOnly, normalizedQuery]);

  const readyCount = resources.filter((resource) => resource.status === "ready").length;
  const pendingCount = resources.length - readyCount;

  return (
    <main className="library-page">
      <style>{`
        .library-page{
          --library-ink:#15120B;
          --library-paper:#F6F2E9;
          --library-card:#FFFDF7;
          --library-muted:#6D675B;
          --library-line:rgba(21,18,11,0.16);
          --library-line-strong:rgba(21,18,11,0.3);
          --library-amber:#F5A524;
          --library-green:#00824C;
          --library-red:#B94736;
          min-height:calc(100vh - 112px);
          background:var(--library-paper);
          color:var(--library-ink);
          font-family:Helvetica,Arial,sans-serif;
          letter-spacing:0;
        }
        .library-page *{box-sizing:border-box}
        .library-wrap{
          width:min(1180px,calc(100% - 40px));
          margin:0 auto;
          padding:42px 0 72px;
        }
        .library-hero{
          display:grid;
          grid-template-columns:minmax(0,1fr) 330px;
          gap:28px;
          align-items:end;
          border-bottom:1px solid var(--library-line-strong);
          padding-bottom:24px;
          margin-bottom:22px;
        }
        .library-kicker{
          font-family:'Courier New',monospace;
          font-size:11px;
          letter-spacing:2px;
          text-transform:uppercase;
          color:var(--library-green);
          font-weight:700;
          margin-bottom:10px;
        }
        .library-title{
          margin:0;
          font-family:Georgia,'Times New Roman',serif;
          font-size:clamp(38px,6vw,72px);
          line-height:0.92;
          font-weight:500;
          letter-spacing:0;
          max-width:820px;
          overflow-wrap:anywhere;
        }
        .library-deck{
          margin:14px 0 0;
          max-width:690px;
          color:var(--library-muted);
          font-size:16px;
          line-height:1.55;
        }
        .library-stats{
          display:grid;
          grid-template-columns:repeat(3,minmax(0,1fr));
          border:1px solid var(--library-line-strong);
          background:rgba(255,255,255,0.35);
        }
        .library-stat{
          padding:16px 14px;
          min-width:0;
        }
        .library-stat + .library-stat{border-left:1px solid var(--library-line)}
        .library-stat-value{
          display:block;
          font-family:'Courier New',monospace;
          font-size:24px;
          font-weight:700;
          color:var(--library-ink);
        }
        .library-stat-label{
          display:block;
          margin-top:4px;
          font-family:'Courier New',monospace;
          font-size:10px;
          letter-spacing:1.4px;
          text-transform:uppercase;
          color:var(--library-muted);
        }
        .library-toolbar{
          position:sticky;
          top:0;
          z-index:20;
          display:grid;
          grid-template-columns:minmax(240px,1fr) auto;
          gap:14px;
          align-items:center;
          padding:14px 0;
          background:rgba(246,242,233,0.92);
          backdrop-filter:saturate(140%) blur(10px);
          -webkit-backdrop-filter:saturate(140%) blur(10px);
          border-bottom:1px solid var(--library-line);
          margin-bottom:18px;
        }
        .library-search{
          display:flex;
          align-items:center;
          gap:10px;
          min-height:44px;
          border:1px solid var(--library-line-strong);
          background:var(--library-card);
          padding:0 14px;
        }
        .library-search-mark{
          color:var(--library-amber);
          font-size:18px;
          line-height:1;
        }
        .library-search input{
          min-width:0;
          width:100%;
          border:0;
          outline:0;
          background:transparent;
          color:var(--library-ink);
          font:500 14px/1.2 'Courier New',monospace;
          letter-spacing:1px;
        }
        .library-search input::placeholder{color:rgba(21,18,11,0.42)}
        .library-filter-row{
          display:flex;
          align-items:center;
          justify-content:flex-end;
          gap:8px;
          flex-wrap:wrap;
        }
        .library-filter,
        .library-toggle{
          min-height:34px;
          border:1px solid var(--library-line);
          background:rgba(255,255,255,0.35);
          color:var(--library-muted);
          cursor:pointer;
          font:700 11px/1 'Courier New',monospace;
          letter-spacing:1.2px;
          text-transform:uppercase;
          padding:0 11px;
        }
        .library-filter:hover,
        .library-toggle:hover,
        .library-filter:focus-visible,
        .library-toggle:focus-visible{
          border-color:var(--library-amber);
          color:var(--library-ink);
          outline:none;
        }
        .library-filter.active,
        .library-toggle.active{
          background:var(--library-ink);
          border-color:var(--library-ink);
          color:var(--library-paper);
        }
        .library-stream{
          display:grid;
          gap:12px;
        }
        .library-item{
          display:grid;
          grid-template-columns:112px minmax(0,1fr) auto;
          gap:18px;
          align-items:stretch;
          border:1px solid var(--library-line);
          background:var(--library-card);
          min-height:148px;
        }
        .library-date{
          border-right:1px solid var(--library-line);
          padding:18px 16px;
          font-family:'Courier New',monospace;
          color:var(--library-muted);
          display:flex;
          flex-direction:column;
          justify-content:space-between;
          gap:20px;
        }
        .library-date strong{
          color:var(--library-ink);
          font-size:22px;
          line-height:1;
        }
        .library-date span{
          font-size:10px;
          letter-spacing:1.2px;
          text-transform:uppercase;
          line-height:1.35;
        }
        .library-content{
          min-width:0;
          padding:18px 0;
        }
        .library-meta{
          display:flex;
          align-items:center;
          gap:8px;
          flex-wrap:wrap;
          margin-bottom:10px;
        }
        .library-badge{
          display:inline-flex;
          align-items:center;
          min-height:24px;
          border:1px solid;
          padding:0 8px;
          font:700 10px/1 'Courier New',monospace;
          letter-spacing:1.2px;
          text-transform:uppercase;
        }
        .library-ready{
          border-color:rgba(0,130,76,0.26);
          color:var(--library-green);
          background:rgba(0,130,76,0.08);
        }
        .library-pending{
          border-color:rgba(185,71,54,0.28);
          color:var(--library-red);
          background:rgba(185,71,54,0.08);
        }
        .library-featured{
          border-color:rgba(245,165,36,0.38);
          color:#7a4d00;
          background:rgba(245,165,36,0.12);
        }
        .library-item-title{
          margin:0;
          font-size:24px;
          line-height:1.1;
          letter-spacing:0;
          font-weight:800;
          overflow-wrap:anywhere;
        }
        .library-description{
          margin:9px 0 12px;
          color:var(--library-muted);
          font-size:14px;
          line-height:1.55;
          max-width:760px;
        }
        .library-tags{
          display:flex;
          flex-wrap:wrap;
          gap:6px;
        }
        .library-tag{
          border:1px solid var(--library-line);
          color:var(--library-muted);
          padding:5px 7px;
          font-family:'Courier New',monospace;
          font-size:10px;
          letter-spacing:0.7px;
          background:rgba(246,242,233,0.62);
        }
        .library-action{
          width:178px;
          border-left:1px solid var(--library-line);
          padding:18px;
          display:flex;
          flex-direction:column;
          justify-content:space-between;
          gap:16px;
        }
        .library-format{
          font-family:'Courier New',monospace;
          font-size:11px;
          line-height:1.45;
          letter-spacing:1px;
          text-transform:uppercase;
          color:var(--library-muted);
        }
        .library-note{
          display:block;
          margin-top:8px;
          font-family:Helvetica,Arial,sans-serif;
          font-size:11px;
          line-height:1.4;
          letter-spacing:0;
          text-transform:none;
          color:rgba(21,18,11,0.58);
        }
        .library-open,
        .library-disabled{
          display:inline-flex;
          align-items:center;
          justify-content:center;
          min-height:38px;
          border:1px solid var(--library-ink);
          font:800 12px/1 Helvetica,Arial,sans-serif;
          letter-spacing:0.5px;
          text-transform:uppercase;
          text-decoration:none;
        }
        .library-open{
          background:var(--library-ink);
          color:var(--library-paper);
        }
        .library-open:hover,
        .library-open:focus-visible{
          background:var(--library-amber);
          color:var(--library-ink);
          outline:none;
        }
        .library-disabled{
          color:rgba(21,18,11,0.46);
          background:rgba(21,18,11,0.04);
          border-color:var(--library-line);
        }
        .library-empty{
          border:1px dashed var(--library-line-strong);
          padding:34px;
          background:rgba(255,255,255,0.35);
          color:var(--library-muted);
          font-size:14px;
          line-height:1.5;
        }
        @media (max-width:920px){
          .library-hero{grid-template-columns:1fr;align-items:start}
          .library-toolbar{position:static;grid-template-columns:1fr}
          .library-filter-row{justify-content:flex-start}
          .library-item{grid-template-columns:86px minmax(0,1fr)}
          .library-action{
            grid-column:1 / -1;
            width:auto;
            border-left:0;
            border-top:1px solid var(--library-line);
            flex-direction:row;
            align-items:center;
          }
        }
        @media (max-width:560px){
          .library-wrap{width:min(100% - 24px,1180px);padding-top:28px}
          .library-stats{grid-template-columns:1fr}
          .library-stat + .library-stat{border-left:0;border-top:1px solid var(--library-line)}
          .library-item{grid-template-columns:1fr;gap:0}
          .library-date{
            border-right:0;
            border-bottom:1px solid var(--library-line);
            flex-direction:row;
            align-items:center;
            padding:14px;
          }
          .library-content{padding:16px 14px}
          .library-action{padding:14px;flex-direction:column;align-items:stretch}
          .library-item-title{font-size:21px}
        }
      `}</style>

      <div className="library-wrap">
        <section className="library-hero" aria-labelledby="library-title">
          <div>
            <div className="library-kicker">Longboard / Member Library</div>
            <h1 id="library-title" className="library-title">The resource stream.</h1>
            <p className="library-deck">
              Slides, PDFs, indicator code, replays, videos, and working files in one searchable place.
            </p>
          </div>
          <div className="library-stats" aria-label="Library status">
            <div className="library-stat">
              <span className="library-stat-value">{resources.length}</span>
              <span className="library-stat-label">Total</span>
            </div>
            <div className="library-stat">
              <span className="library-stat-value">{readyCount}</span>
              <span className="library-stat-label">Ready</span>
            </div>
            <div className="library-stat">
              <span className="library-stat-value">{pendingCount}</span>
              <span className="library-stat-label">Pending</span>
            </div>
          </div>
        </section>

        <section className="library-toolbar" aria-label="Library search and filters">
          <label className="library-search">
            <span className="library-search-mark" aria-hidden="true">⌕</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="SEARCH FILES, TAGS, TOPICS..."
              aria-label="Search library resources"
            />
          </label>

          <div className="library-filter-row">
            {typeOrder.map((type) => (
              <button
                key={type}
                type="button"
                className={`library-filter${filter === type ? " active" : ""}`}
                onClick={() => setFilter(type)}
                aria-pressed={filter === type}
              >
                {type === "all" ? "All" : libraryTypeLabels[type]}
              </button>
            ))}
            <button
              type="button"
              className={`library-toggle${featuredOnly ? " active" : ""}`}
              onClick={() => setFeaturedOnly((value) => !value)}
              aria-pressed={featuredOnly}
            >
              Start Here
            </button>
          </div>
        </section>

        <section className="library-stream" aria-label="Library resources">
          {filteredResources.length === 0 ? (
            <div className="library-empty">
              No resources match the current search. Clear the search or switch filters.
            </div>
          ) : (
            filteredResources.map((resource) => {
              const date = new Date(`${resource.date}T00:00:00Z`);
              const typeStyle = typeStyles[resource.type];

              return (
                <article key={resource.id} className="library-item">
                  <div className="library-date">
                    <strong>{String(date.getUTCDate()).padStart(2, "0")}</strong>
                    <span>{formatDate(resource.date)}</span>
                  </div>

                  <div className="library-content">
                    <div className="library-meta">
                      <span
                        className="library-badge"
                        style={{
                          background: typeStyle.bg,
                          color: typeStyle.fg,
                          borderColor: typeStyle.border,
                        }}
                      >
                        {libraryTypeLabels[resource.type]}
                      </span>
                      <span className={`library-badge library-${resource.status}`}>
                        {resource.status === "ready" ? "Ready" : "Link pending"}
                      </span>
                      {resource.featured && (
                        <span className="library-badge library-featured">Start Here</span>
                      )}
                    </div>
                    <h2 className="library-item-title">{resource.title}</h2>
                    <p className="library-description">{resource.description}</p>
                    <div className="library-tags" aria-label={`${resource.title} tags`}>
                      {resource.tags.map((tag) => (
                        <span key={tag} className="library-tag">{tag}</span>
                      ))}
                    </div>
                  </div>

                  <div className="library-action">
                    <div className="library-format">
                      {resource.format ?? libraryTypeLabels[resource.type]}
                      {resource.sourceNote && (
                        <span className="library-note">{resource.sourceNote}</span>
                      )}
                    </div>
                    {resource.href ? (
                      <a className="library-open" href={resource.href}>
                        Open
                      </a>
                    ) : (
                      <span className="library-disabled" aria-disabled="true">
                        Pending
                      </span>
                    )}
                  </div>
                </article>
              );
            })
          )}
        </section>
      </div>
    </main>
  );
}

