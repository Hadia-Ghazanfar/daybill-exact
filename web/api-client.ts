// HTTP action client for the Daybill Vercel deployment.
//
// This replaces the Muse space-sdk action client with plain fetch() calls to
// POST /api/<action-name>. The public interface is identical to the original
// client/src/api.ts: `api.<action>(args)` with the same argument/response
// shapes, plus `setApiSession`, `AccountSession`, `ApiResponse`, `ApiRequest`.
// Session handling (localStorage persistence, attaching account_id /
// session_token / session_kind to every call) is unchanged — that logic lives
// in App.tsx and is untouched.
//
// Offline support (see ./offline.ts): when the network fails, getWorkspace
// and invoice/purchase details are served from the IndexedDB cache, and
// queueable mutations are stored in an outbox with a stable idempotency key,
// applied optimistically, and replayed when the connection returns.
import type {
  ActionName,
  ActionRequest,
  ActionResponse,
} from "../api/_defs";
import {
  applyOptimistic,
  getCachedWorkspace,
  getTempIdMap,
  makeTempId,
  newIdem,
  notifySessionChanged,
  queueMutation,
  saveWorkspaceCache,
  serveCachedInvoice,
  serveCachedPurchase,
} from "./offline";

export type AccountSession = {
  account_id: number;
  session_token: string;
  session_kind: "user" | "admin";
  shopkeeper_name: string;
  phone: string;
};

let currentSession: AccountSession | null = null;

export function setApiSession(session: AccountSession | null) {
  currentSession = session;
  // The offline engine starts before App mounts; tell it the account is
  // known so the pending count (and a replay, if online) can run.
  notifySessionChanged();
}

export function getApiSession(): AccountSession | null {
  return currentSession;
}

/** Error thrown for failed action calls. Carries the HTTP status so the
 *  query client can decide whether a retry makes sense (5xx/network only). */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function callActionRaw<N extends ActionName>(
  name: N,
  args: Record<string, unknown>,
): Promise<ActionResponse<N>> {
  let res: Response;
  try {
    res = await fetch(`/api/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(args),
    });
  } catch (cause) {
    throw new ApiError(0, cause instanceof Error ? cause.message : "Network request failed");
  }
  const text = await res.text();
  let data: { error?: string } | null = null;
  try {
    data = text ? (JSON.parse(text) as { error?: string }) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const message =
      data && typeof data.error === "string" && data.error.length > 0
        ? data.error
        : `Request failed (${res.status})`;
    throw new ApiError(res.status, message);
  }
  return data as ActionResponse<N>;
}

/**
 * Raw POST used by the offline sync engine: same endpoint and session
 * handling, but no offline interception (it must never re-queue a replay).
 * The caller supplies the args as stored in the outbox (already carrying
 * the stable __idem); the current session is attached here.
 */
export async function rawPostAction<N extends ActionName>(
  name: N,
  args: Record<string, unknown>,
): Promise<ActionResponse<N>> {
  return callActionRaw(
    name,
    currentSession
      ? {
          ...args,
          account_id: currentSession.account_id,
          session_token: currentSession.session_token,
          session_kind: currentSession.session_kind,
        }
      : args,
  );
}

/** Mutations that are safe to queue offline and replay later. Everything
 *  else — auth actions, reads, and the logo upload — fails normally. */
const QUEUEABLE_ACTIONS: ReadonlySet<string> = new Set([
  "createInvoice",
  "createPurchaseInvoice",
  "setInvoicePaymentStatus",
  "setPurchasePaymentStatus",
  "markPurchaseDelivered",
  "saveProduct",
  "archiveProduct",
  "adjustStock",
  "saveContact",
  "archiveContact",
  "saveCategory",
  "deleteCategory",
  "saveSettings",
  "trashInvoice",
  "trashPurchase",
  "restoreInvoice",
  "restorePurchase",
  "deleteInvoiceForever",
  "deletePurchaseForever",
  "submitFeedback",
  "markNotificationRead",
  "markAllNotificationsRead",
]);

/** Queueable actions whose response carries the created record's id. */
const CREATES_WITH_ID: ReadonlySet<string> = new Set([
  "createInvoice",
  "createPurchaseInvoice",
  "saveProduct",
  "saveContact",
  "saveCategory",
]);

/** What an offline-queued mutation resolves with, so the UI can carry on
 *  exactly as if the server had answered. */
async function syntheticResult(
  name: string,
  tempId: number | undefined,
  userArgs: Record<string, unknown>,
  accountId: number,
): Promise<unknown> {
  switch (name) {
    case "createInvoice":
      return { id: tempId ?? -1, invoice_number: `TMP-${Math.abs(tempId ?? 1)}` };
    case "createPurchaseInvoice":
      return { id: tempId ?? -1, purchase_number: `TMP-${Math.abs(tempId ?? 1)}` };
    case "saveProduct":
    case "saveContact":
    case "saveCategory":
      return { id: tempId ?? -1 };
    case "adjustStock": {
      const ws = await getCachedWorkspace(accountId);
      const product = ws?.products?.find((p: any) => p.id === userArgs.product_id);
      return { ok: true, new_stock: product?.stock_quantity ?? 0 };
    }
    case "markPurchaseDelivered":
      return { ok: true, already_delivered: false };
    default:
      return { ok: true };
  }
}

async function callAction<N extends ActionName>(
  name: N,
  args: Record<string, unknown>,
): Promise<ActionResponse<N>> {
  const accountId = typeof args.account_id === "number" ? (args.account_id as number) : null;
  const isQueueable = QUEUEABLE_ACTIONS.has(name);
  // Every queueable mutation carries a stable idempotency key, online or
  // off, so a lost response followed by a retry can never double-apply.
  const idem = isQueueable ? newIdem() : null;
  const sendArgs = idem ? { ...args, __idem: idem } : args;

  let result: ActionResponse<N>;
  try {
    result = await callActionRaw(name, sendArgs);
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 0) throw err;
    // Network failure — the device is offline (or the server unreachable).
    if (name === "getWorkspace" && accountId !== null) {
      const cached = await getCachedWorkspace(accountId);
      if (cached) return cached as ActionResponse<N>;
      throw err;
    }
    if ((name === "getInvoice" || name === "getPurchaseInvoice") && typeof args.id === "number" && accountId !== null) {
      const id = args.id as number;
      if (id < 0) {
        // Already synced under a real id? Fetch that instead.
        const map = await getTempIdMap(accountId);
        const realId = map[String(id)];
        if (realId !== undefined) {
          try {
            return await rawPostAction(name, { id: realId });
          } catch {
            // Fall through to the cached copy below.
          }
        }
      }
      const served =
        name === "getInvoice"
          ? await serveCachedInvoice(accountId, id)
          : await serveCachedPurchase(accountId, id);
      if (served) return served as ActionResponse<N>;
      throw err;
    }
    if (isQueueable && idem && accountId !== null) {
      const { account_id: _accountId, session_token: _sessionToken, session_kind: _sessionKind, ...userArgs } = args;
      const tempId = CREATES_WITH_ID.has(name) ? makeTempId() : undefined;
      await queueMutation({ action: name, args: userArgs, idem, tempId, accountId });
      await applyOptimistic(name, userArgs, accountId, tempId);
      return (await syntheticResult(name, tempId, userArgs, accountId)) as ActionResponse<N>;
    }
    throw err;
  }

  if (name === "getWorkspace" && accountId !== null) {
    // Fresh server data: keep the offline cache current.
    try {
      await saveWorkspaceCache(accountId, result);
    } catch {
      // The cache is best-effort; never break a live call on it.
    }
  }
  return result;
}

export type Actions = {
  [N in ActionName]: (args: ActionRequest<N>) => Promise<ActionResponse<N>>;
};

type AuthenticatedClient<T> = {
  [K in keyof T]: T[K] extends (args: infer A) => infer R
    ? (args: Omit<A & object, "account_id" | "session_token" | "session_kind">) => R
    : T[K];
};

const rawApi = new Proxy({} as Actions, {
  get(_target, property) {
    if (typeof property !== "string") return undefined;
    const name = property as ActionName;
    return (args: Record<string, unknown> = {}) =>
      callAction(
        name,
        currentSession
          ? {
              ...args,
              account_id: currentSession.account_id,
              session_token: currentSession.session_token,
              session_kind: currentSession.session_kind,
            }
          : args,
      );
  },
});

export const api = rawApi as AuthenticatedClient<Actions>;

export type ApiResponse<
  C extends Record<string, (args: never) => Promise<unknown>>,
  K extends keyof C,
> = Awaited<ReturnType<C[K]>>;

export type ApiRequest<
  C extends Record<string, (args: never) => Promise<unknown>>,
  K extends keyof C,
> = Parameters<C[K]>[0];
