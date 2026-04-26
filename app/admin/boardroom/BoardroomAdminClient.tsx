"use client";

import React, { useState } from "react";
import WelcomeSection, { type WelcomeRow } from "@/components/admin/boardroom/WelcomeSection";
import EventsSection, { type EventRow } from "@/components/admin/boardroom/EventsSection";
import MeetingsSection, { type MeetingRow } from "@/components/admin/boardroom/MeetingsSection";
import AnnouncementsSection, { type AnnouncementRow } from "@/components/admin/boardroom/AnnouncementsSection";
import RoadmapSection, { type RoadmapRow } from "@/components/admin/boardroom/RoadmapSection";
import FeatureRequestsSection, { type FeatureRequestRow } from "@/components/admin/boardroom/FeatureRequestsSection";
import StatsSection, { type StatsRow } from "@/components/admin/boardroom/StatsSection";

const font = "var(--font-labels)";

export type BoardroomAdminInitialData = {
  cohort: string;
  welcome: WelcomeRow | null;
  events: EventRow[];
  meetings: MeetingRow[];
  announcements: AnnouncementRow[];
  roadmap: RoadmapRow[];
  featureRequests: FeatureRequestRow[];
  stats: StatsRow | null;
};

export default function BoardroomAdminClient({ initial }: { initial: BoardroomAdminInitialData }) {
  const [error, setError] = useState<string | null>(null);

  return (
    <div style={{
      fontFamily: font, color: "var(--text-primary)",
      padding: "32px 24px", maxWidth: 1100, margin: "0 auto",
    }}>
      <div style={{ marginBottom: 32, display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <div style={{
            fontSize: 10, color: "var(--text-secondary)", letterSpacing: 3,
            textTransform: "uppercase", marginBottom: 6,
          }}>
            LONGBOARD.AI / ADMIN
          </div>
          <div style={{ fontSize: 22, color: "var(--accent)", fontWeight: 500, letterSpacing: 1 }}>
            Boardroom · {initial.cohort}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <a href="/admin" style={subNavBtn}>← Admin</a>
          <a href="/boardroom" target="_blank" rel="noopener noreferrer" style={subNavBtn}>
            View /boardroom →
          </a>
        </div>
      </div>

      {error && (
        <div style={{
          background: "var(--danger-20)", border: "1px solid var(--danger)", color: "var(--danger)",
          padding: "10px 14px", borderRadius: 4, marginBottom: 20, fontSize: 13,
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            style={{
              background: "none", border: "none", color: "var(--danger)",
              cursor: "pointer", fontSize: 16, fontWeight: 700, padding: "0 4px",
            }}
          >
            ×
          </button>
        </div>
      )}

      <Stack>
        <WelcomeSection cohort={initial.cohort} initialRow={initial.welcome} onError={setError} />
        <EventsSection cohort={initial.cohort} initialRows={initial.events} onError={setError} />
        <MeetingsSection cohort={initial.cohort} initialRows={initial.meetings} onError={setError} />
        <AnnouncementsSection cohort={initial.cohort} initialRows={initial.announcements} onError={setError} />
        <RoadmapSection cohort={initial.cohort} initialRows={initial.roadmap} onError={setError} />
        <FeatureRequestsSection cohort={initial.cohort} initialRows={initial.featureRequests} onError={setError} />
        <StatsSection cohort={initial.cohort} initialRow={initial.stats} onError={setError} />
      </Stack>
    </div>
  );
}

function Stack({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 36 }}>{children}</div>;
}

const subNavBtn: React.CSSProperties = {
  fontSize: 11, padding: "6px 14px",
  color: "var(--text-secondary)", border: "1px solid var(--border)",
  borderRadius: 3, textDecoration: "none", letterSpacing: 1,
  textTransform: "uppercase", fontFamily: font,
};
