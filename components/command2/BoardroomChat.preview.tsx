import { TradingViewPreviewStateDemo } from "@/components/command2/BoardroomChat";
import { tradingViewSnapshotFromText } from "@/lib/boardroomChatLinks";

export default function BoardroomChatPreview() {
  const snapshot = tradingViewSnapshotFromText("https://www.tradingview.com/x/G4bHTjTX/");

  return (
    <div aria-label="Boardroom Chat interactive state preview">
      {snapshot ? <TradingViewPreviewStateDemo snapshot={snapshot} /> : null}
    </div>
  );
}
