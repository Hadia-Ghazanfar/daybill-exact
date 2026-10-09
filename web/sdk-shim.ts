// Local replacements for the three @hatch/space-sdk/client imports the UI
// used. Behavior is replicated from the SDK implementation so the UI renders
// identically:
//
// - fileToBase64(file) -> { dataBase64, mimeType }: raw base64 of the file
//   bytes (no data: URL prefix), exactly like the SDK's file-encoding helper.
// - SafeAreaTopScrim: fixed top safe-area scrim with the same geometry the
//   SDK uses (gradient fade variant by default, z-index 40).
// - spaceQueryClient: the shared @tanstack/react-query QueryClient. Retry is
//   limited to transient failures (network errors / 5xx) so user-facing
//   validation errors (400/401) surface immediately, matching the space SDK's
//   permanent-action-status semantics.
import { createElement, type CSSProperties, type HTMLAttributes } from "react";
import { QueryClient } from "@tanstack/react-query";

function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export async function fileToBase64(file: Blob): Promise<{ dataBase64: string; mimeType: string }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return { dataBase64: bytesToBase64(bytes), mimeType: file.type };
}

export type SafeAreaTopScrimVariant = "gradient" | "blur" | "solid";

export interface SafeAreaTopScrimProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  variant?: SafeAreaTopScrimVariant;
  backgroundColor?: CSSProperties["backgroundColor"];
  zIndex?: CSSProperties["zIndex"];
}

const TOP_SAFE_AREA_SCRIM_HEIGHT = "calc(var(--twsa-safe-area-inset-top) + min(2rem, var(--twsa-safe-area-inset-top)))";
const TOP_SAFE_AREA_INSET_HEIGHT = "var(--twsa-safe-area-inset-top)";
const TOP_SAFE_AREA_GRADIENT_MASK =
  "linear-gradient(to bottom, rgba(0, 0, 0, 1) 0%, rgba(0, 0, 0, 0.99) 10%, rgba(0, 0, 0, 0.96) 20%, rgba(0, 0, 0, 0.90) 30%, rgba(0, 0, 0, 0.80) 40%, rgba(0, 0, 0, 0.67) 50%, rgba(0, 0, 0, 0.52) 60%, rgba(0, 0, 0, 0.36) 70%, rgba(0, 0, 0, 0.20) 80%, rgba(0, 0, 0, 0.08) 90%, rgba(0, 0, 0, 0) 100%)";

export function SafeAreaTopScrim({
  variant = "gradient",
  backgroundColor,
  zIndex = 40,
  className,
  style,
  ...props
}: SafeAreaTopScrimProps) {
  const resolvedBackgroundColor = backgroundColor ?? style?.backgroundColor ?? "var(--bg)";
  const managedStyle: CSSProperties = {
    ...style,
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    zIndex,
    pointerEvents: "none",
    height: variant === "gradient" ? TOP_SAFE_AREA_SCRIM_HEIGHT : TOP_SAFE_AREA_INSET_HEIGHT,
    backgroundColor: resolvedBackgroundColor,
  };
  if (variant === "gradient") {
    managedStyle.maskImage = TOP_SAFE_AREA_GRADIENT_MASK;
    managedStyle.WebkitMaskImage = TOP_SAFE_AREA_GRADIENT_MASK;
  } else if (variant === "blur") {
    managedStyle.backdropFilter = style?.backdropFilter ?? "blur(12px)";
    managedStyle.WebkitBackdropFilter = style?.WebkitBackdropFilter ?? "blur(12px)";
  }
  return createElement("div", {
    ...props,
    "aria-hidden": props["aria-hidden"] ?? true,
    className,
    style: managedStyle,
  });
}

function shouldRetryAction(failureCount: number, error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  // Permanent action failures (validation, auth, business-rule errors) must
  // not retry — they would just replay the same user-facing error.
  if (typeof status === "number") return status === 0 || status >= 500;
  return failureCount < 2;
}

export const spaceQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: shouldRetryAction,
    },
    mutations: {
      retry: false,
    },
  },
});
