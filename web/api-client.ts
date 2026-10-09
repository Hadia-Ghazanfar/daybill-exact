// HTTP action client for the Daybill Vercel deployment.
//
// This replaces the Muse space-sdk action client with plain fetch() calls to
// POST /api/<action-name>. The public interface is identical to the original
// client/src/api.ts: `api.<action>(args)` with the same argument/response
// shapes, plus `setApiSession`, `AccountSession`, `ApiResponse`, `ApiRequest`.
// Session handling (localStorage persistence, attaching account_id /
// session_token / session_kind to every call) is unchanged — that logic lives
// in App.tsx and is untouched.
import type {
  ActionName,
  ActionRequest,
  ActionResponse,
} from "../api/_defs";

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

async function callAction<N extends ActionName>(
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
