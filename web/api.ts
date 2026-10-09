// Re-export of the HTTP action client. App.tsx imports "./api" — this keeps
// that import working unchanged while the real implementation lives in
// ./api-client.ts.
export { api, setApiSession, ApiError } from "./api-client";
export type { AccountSession, Actions, ApiRequest, ApiResponse } from "./api-client";
