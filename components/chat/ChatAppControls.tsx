"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CHAT_AUTO_REFRESH_KEY, shouldAutoRefresh } from "@/lib/chatAutoRefresh";
import styles from "./ChatAppControls.module.css";
export default function ChatAppControls({ version }: { version: string }) {
  const [available, setAvailable] = useState(false),
    [notice, setNotice] = useState("");
  const registration = useRef<ServiceWorkerRegistration | null>(null),
    lastCheck = useRef(0),
    prompted = useRef("");
  const refreshing = useRef(false);
  const readyVersion = useRef<string | null>(null),
    lastInput = useRef(Date.now());
  /** Resolves true once a reload has started. Silent refreshes never show notices. */
  const refresh = useCallback(async (silent = false): Promise<boolean> => {
    if (refreshing.current) return false;
    if (!window.dispatchEvent(new Event("chat-before-refresh", { cancelable: true }))) {
      if (!silent)
        setNotice(
          "Finish or remove attachments, recordings, and unsent messages before refreshing. If this persists, browser storage may be unavailable.",
        );
      return false;
    }
    if (!navigator.onLine) {
      if (!silent) setNotice("Connect to the internet before refreshing.");
      return false;
    }
    refreshing.current = true;
    try {
      const waiting = registration.current?.waiting;
      if (waiting) {
        await new Promise<void>((resolve, reject) => {
          const changed = () => {
            clearTimeout(timer);
            navigator.serviceWorker.removeEventListener("controllerchange", changed);
            resolve();
          };
          const timer = setTimeout(() => {
            navigator.serviceWorker.removeEventListener("controllerchange", changed);
            reject(Error("Update is still preparing. Please try Refresh app again."));
          }, 8000);
          navigator.serviceWorker.addEventListener("controllerchange", changed);
          waiting.postMessage({ type: "CHAT_ACTIVATE_UPDATE" });
        });
      }
      if (!window.dispatchEvent(new Event("chat-before-refresh", { cancelable: true }))) {
        refreshing.current = false;
        if (!silent)
          setNotice("Finish or remove attachments, recordings, and unsent messages before refreshing.");
        return false;
      }
      window.location.reload();
      return true;
    } catch (e) {
      refreshing.current = false;
      if (!silent) setNotice(e instanceof Error ? e.message : "Could not refresh. Please try again.");
      return false;
    }
  }, []);
  // Speed and safety fixes only reach a window after it reloads, so apply ready updates when
  // that can't interrupt anyone: background tab, just returned, or idle. Never mid-use.
  const autoRefresh = useCallback(
    async (returning = false) => {
      let attempted: string | null = null;
      try {
        attempted = window.sessionStorage.getItem(CHAT_AUTO_REFRESH_KEY);
      } catch {
        return; // Without storage we can't prevent a reload loop; leave it to the notice.
      }
      const target = readyVersion.current;
      if (
        !shouldAutoRefresh({
          readyVersion: target,
          attemptedVersion: attempted,
          hidden: document.hidden,
          returning,
          idleMs: Date.now() - lastInput.current,
          online: navigator.onLine,
        })
      )
        return;
      try {
        window.sessionStorage.setItem(CHAT_AUTO_REFRESH_KEY, target!);
      } catch {
        return;
      }
      // Blocked by unsent work: forget the attempt so a later quiet moment can retry.
      if (!(await refresh(true)))
        try {
          window.sessionStorage.removeItem(CHAT_AUTO_REFRESH_KEY);
        } catch {}
    },
    [refresh],
  );
  useEffect(() => {
    let stopped = false;
    if ("serviceWorker" in navigator)
      void navigator.serviceWorker
        .register("/chat-sw.js", { scope: "/chat", updateViaCache: "none" })
        .then((r) => {
          if (!stopped) registration.current = r;
        })
        .catch(() => {});
    // Background tabs check too; browsers already throttle their timers.
    const check = async () => {
      if (Date.now() - lastCheck.current < 30000) return;
      lastCheck.current = Date.now();
      try {
        void registration.current?.update().catch(() => {});
        const response = await fetch("/api/chat/version", { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json();
        if (
          !stopped &&
          typeof data.version === "string" &&
          data.version !== version &&
          data.version !== "development"
        ) {
          setAvailable(true);
          readyVersion.current = data.version;
          if (prompted.current !== data.version) {
            prompted.current = data.version;
            setNotice("A chat update is ready.");
          }
        }
      } catch {}
    };
    void check();
    const timer = setInterval(() => void check().then(() => autoRefresh()), 120000);
    // Coming back to the tab is the best moment: reload before the person starts typing.
    const resume = () => void check().then(() => autoRefresh(!document.hidden)),
      request = () => void refresh(),
      input = () => {
        lastInput.current = Date.now();
      };
    const inputs = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    inputs.forEach((name) => window.addEventListener(name, input, { capture: true, passive: true }));
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("chat-refresh-app", request);
    return () => {
      stopped = true;
      clearInterval(timer);
      inputs.forEach((name) => window.removeEventListener(name, input, { capture: true }));
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("chat-refresh-app", request);
    };
  }, [version, refresh, autoRefresh]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 8000);
    return () => clearTimeout(timer);
  }, [notice]);
  return notice
    ? createPortal(
        <div className={styles.notice} role="status">
          <span>{notice}</span>
          {available && notice === "A chat update is ready." && (
            <button onClick={() => void refresh()}>Refresh</button>
          )}
          <button aria-label="Dismiss update notice" onClick={() => setNotice("")}>
            ×
          </button>
        </div>,
        document.body,
      )
    : null;
}
