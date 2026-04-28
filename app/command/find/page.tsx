import CommandFindClient from "@/components/command/CommandFindClient";

export const dynamic = "force-dynamic";

export default function CommandFindPage() {
  return (
    <>
      <div className="cc-kpi-row" style={{ marginTop: 14 }}>
        <div className="cc-kpi">
          <div className="label">Runners · +20% day</div>
          <div className="value">—</div>
          <div className="delta">auto</div>
        </div>
        <div className="cc-kpi">
          <div className="label">A/D · Small-cap</div>
          <div className="value">—</div>
          <div className="delta">auto</div>
        </div>
        <div className="cc-kpi">
          <div className="label">Tape</div>
          <div className="value">Runners</div>
          <div className="delta">hot open</div>
        </div>
        <div className="cc-kpi">
          <div className="label">Desk</div>
          <div className="value">Rob · live</div>
          <div className="delta">seat #0147</div>
        </div>
      </div>

      {/* Client UI: movers → related news → live TV */}
      <CommandFindClient />
    </>
  );
}

