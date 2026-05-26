export type OneSignalPushSubscriptionChange = {
  current?: {
    id?: string | null;
    token?: string | null;
    optedIn?: boolean;
  };
};

export type OneSignalBrowserClient = {
  setConsentGiven(given: boolean): void;
  login(externalId: string): Promise<void>;
  logout(): Promise<void>;
  Notifications: {
    isPushSupported(): boolean;
    permission: boolean;
    requestPermission(): Promise<void> | void;
  };
  User: {
    PushSubscription: {
      id: string | null;
      token: string | null;
      optedIn: boolean;
      addEventListener?(
        event: "change",
        callback: (event: OneSignalPushSubscriptionChange) => void,
      ): void;
      removeEventListener?(
        event: "change",
        callback: (event: OneSignalPushSubscriptionChange) => void,
      ): void;
      optIn(): Promise<void> | void;
      optOut(): Promise<void> | void;
    };
  };
};

export async function waitForOneSignalPushSubscription(
  OneSignal: OneSignalBrowserClient,
) {
  const subscription = OneSignal.User.PushSubscription;
  if (subscription.optedIn && subscription.id && subscription.token) return;

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let pollingId: number | null = null;
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(
        new Error(
          "Longboard is still waiting for your browser to finish registering push alerts. Refresh this page and try Browser Push again. If it keeps happening, use Chrome or Safari outside of private browsing and make sure ad blockers are off for Longboard.",
        ),
      );
    }, 15_000);

    const done = () => {
      cleanup();
      resolve();
    };

    const hasSubscription = () => {
      const current = OneSignal.User.PushSubscription;
      return Boolean(current.optedIn && current.id && current.token);
    };

    const onChange = (event: OneSignalPushSubscriptionChange) => {
      const current = event.current;
      if ((current?.optedIn && current.id && current.token) || hasSubscription()) {
        done();
      }
    };

    const cleanup = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      if (pollingId !== null) window.clearInterval(pollingId);
      subscription.removeEventListener?.("change", onChange);
    };

    subscription.addEventListener?.("change", onChange);
    pollingId = window.setInterval(() => {
      if (hasSubscription()) done();
    }, 500);

    if (hasSubscription()) done();
  });
}
