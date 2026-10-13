import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useVisibleChatNotifications } from "@/components/chat/hooks/useVisibleChatNotifications";
// Count observer constructions: P7 builds one per pane, not one per change.
const Native = window.IntersectionObserver;
const w = window as unknown as Record<string, unknown>;
w.observers = 0;
w.observed = 0;
window.IntersectionObserver = class extends Native {
  constructor(cb: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    super(cb, options);
    (w.observers as number)++;
  }
  observe(target: Element) {
    (w.observed as number)++;
    super.observe(target);
  }
} as typeof IntersectionObserver;
w.reads = [] as unknown[];
function Pane() {
  const container = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(20);
  const [, setTick] = useState(0);
  const ids = Array.from({ length: count }, (_, i) => `m${i + 1}`);
  w.addRows = (n: number) => setCount((c) => c + n);
  w.bell = () => setTick((t) => t + 1);
  useVisibleChatNotifications({
    container,
    enabled: true,
    scope: { kind: "room", room: "main" },
    canonicalIds: ids,
    selector: "[data-mid]",
    attribute: "data-mid",
  });
  return (
    <div ref={container} id="pane" style={{ height: 400, overflowY: "auto" }}>
      {ids.map((id) => (
        <div key={id} data-mid={id} style={{ height: 50, borderBottom: "1px solid #ccc" }}>
          {id}
        </div>
      ))}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Pane />);
