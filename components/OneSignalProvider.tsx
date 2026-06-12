"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

declare global {
  interface Window {
    OneSignalDeferred?: Array<(OneSignal: OneSignalSdk) => void | Promise<void>>;
    __longboardOneSignalInit?: boolean;
  }
}

type OneSignalSdk = {
  setConsentRequired(required: boolean): void;
  setConsentGiven(given: boolean): void;
  init(options: {
    appId: string;
    safari_web_id?: string;
    serviceWorkerPath?: string;
    serviceWorkerParam?: { scope: string };
    promptOptions?: { slidedown?: { prompts: Array<{ type: "push"; autoPrompt: boolean }> } };
    welcomeNotification?: { disable: boolean };
  }): Promise<void>;
  login(externalId: string): Promise<void>;
  logout(): Promise<void>;
  Notifications: {
    setDefaultUrl(url: string): void;
    isPushSupported(): boolean;
    permission: boolean;
    requestPermission(): Promise<void> | void;
  };
  User: {
    PushSubscription: {
      id: string | null;
      token: string | null;
      optedIn: boolean;
      optIn(): Promise<void> | void;
      optOut(): Promise<void> | void;
    };
  };
};

const APP_ID = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
const SAFARI_WEB_ID = process.env.NEXT_PUBLIC_ONESIGNAL_SAFARI_WEB_ID;
const SDK_SRC = "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js";
const HIDDEN_PATHS = ["/charts"];

function loadOneSignalScript() {
  if (document.querySelector(`script[src="${SDK_SRC}"]`)) return;

  const script = document.createElement("script");
  script.src = SDK_SRC;
  script.defer = true;
  document.head.appendChild(script);
}

export default function OneSignalProvider() {
  const pathname = usePathname();

  useEffect(() => {
    if (!APP_ID) return;
    if (HIDDEN_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) return;
    if (window.__longboardOneSignalInit) return;
    window.__longboardOneSignalInit = true;

    window.OneSignalDeferred = window.OneSignalDeferred || [];
    loadOneSignalScript();

    window.OneSignalDeferred.push(async (OneSignal) => {
      OneSignal.setConsentRequired(true);
      await OneSignal.init({
        appId: APP_ID,
        ...(SAFARI_WEB_ID ? { safari_web_id: SAFARI_WEB_ID } : {}),
        promptOptions: { slidedown: { prompts: [{ type: "push", autoPrompt: false }] } },
        welcomeNotification: { disable: true },
      });
      OneSignal.Notifications.setDefaultUrl(`${window.location.origin}/scanner`);

      try {
        const preferenceResponse = await fetch("/api/notifications/rvol/preference", { cache: "no-store" });
        if (preferenceResponse.ok) {
          const preference = await preferenceResponse.json();
          if (preference?.browserPushEnabled !== true) {
            OneSignal.setConsentGiven(false);
            return;
          }

          const userResponse = await fetch("/api/auth/me", { cache: "no-store" });
          if (!userResponse.ok) {
            OneSignal.setConsentGiven(false);
            return;
          }

          const user = await userResponse.json();
          if (typeof user?.id === "string" && user.id) {
            OneSignal.setConsentGiven(true);
            await OneSignal.login(user.id);
            if (OneSignal.Notifications.permission) {
              await OneSignal.User.PushSubscription.optIn();
            }
            return;
          }
        }
      } catch {
        // OneSignal identity is best-effort; auth failures should not affect page load.
      }

      OneSignal.setConsentGiven(false);
      await OneSignal.logout();
    });
  }, [pathname]);

  return null;
}
