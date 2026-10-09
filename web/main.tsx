import { spaceQueryClient } from "./sdk-shim";
import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./theme.css";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("missing root element");
}

// Some in-app webviews report a tablet/desktop-sized layout viewport on a
// phone. Tag the real device form factor so CSS can keep the phone workspace
// and its floating dock even when width media queries are misleading.
type NavigatorWithUserAgentData = Navigator & { userAgentData?: { mobile?: boolean } };
const navigatorWithData = navigator as NavigatorWithUserAgentData;
const phoneUserAgent = /Android.+Mobile|iPhone|iPod|IEMobile|Opera Mini|Mobile/i.test(navigator.userAgent);
const compactTouchScreen = navigator.maxTouchPoints > 0 && Math.min(screen.width, screen.height) <= 600;
if (navigatorWithData.userAgentData?.mobile === true || phoneUserAgent || compactTouchScreen) {
  document.documentElement.classList.add("phone-layout");
}

if ("serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () => {
    const isEmbedded = window.self !== window.top;
    if (isEmbedded) {
      // Muse renders the artifact in an iframe. A service worker left behind
      // by an older build can otherwise keep serving its cached HTML on a
      // desktop browser, which makes a newly published build appear not to
      // open. The shell already owns loading/offline behavior, so remove only
      // this artifact's scoped worker and cache when embedded.
      void navigator.serviceWorker.getRegistration("./").then((registration) => registration?.unregister()).catch(() => undefined);
      if ("caches" in window) {
        void caches.keys().then((keys) => Promise.all(
          keys.filter((key) => key.startsWith("daybill-")).map((key) => caches.delete(key)),
        )).catch(() => undefined);
      }
      return;
    }

    // Keep browser/PWA installs current without relying on the HTTP cache for
    // the worker script. Installed copies still retain offline support.
    void navigator.serviceWorker.register("./pwa-worker", { scope: "./", updateViaCache: "none" })
      .then((registration) => registration.update())
      .catch(() => {
        // Some sandboxed browsers disallow registration. Daybill still works
        // online in that case.
      });
  });
}

// Keep the SDK QueryClient wrapper and both safe-area root markers: the Muse
// host uses them for notches, gesture bars, and shell chrome offsets.
createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={spaceQueryClient}>
      <div className="hatch-space-root" data-hatch-space-root>
        <App />
      </div>
    </QueryClientProvider>
  </StrictMode>,
);
