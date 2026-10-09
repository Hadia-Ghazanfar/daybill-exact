// Daybill API dispatcher (Vercel serverless).
//
// Single function serving POST /api/<action-name> for all 20 actions.
// Keeping one dynamic route (instead of 20 files) stays under the Vercel
// Hobby function limit; the URL contract is identical: POST /api/getWorkspace,
// POST /api/createInvoice, etc.
//
// Flow per request:
//   1. ensureInit() — create tables if needed (safe on every cold start)
//   2. Validate the JSON body against the action's zod request schema
//      (400 + first issue message on failure)
//   3. Run the handler (auth errors → 401, business-rule errors → 400)
//   4. Validate the result against the response schema and return it
import { z } from "zod";
import { Actions } from "./_handlers.js";
import type { Ctx } from "./_handlers.js";
import { AuthError } from "./_auth.js";
import { blobs } from "./_blobs.js";
import { ensureInit, getDb } from "./_db.js";

type HandlerDef = {
  request: z.ZodTypeAny;
  response: z.ZodTypeAny;
  handler: (ctx: Ctx, args: any) => Promise<any>;
};

const defs = Actions as unknown as Record<string, HandlerDef>;

function serverCtx(): Ctx {
  return { db: getDb(), blobs, invalidateQueries: () => {} };
}

function zodMessage(err: z.ZodError): string {
  const first = err.issues[0];
  return first?.message || "Invalid request";
}

function asError(err: unknown): Error {
  return err instanceof Error ? err : new Error("Something went wrong");
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const name = String(req.query?.action ?? "");
  const def = defs[name];
  if (!def) return res.status(404).json({ error: "Not found" });

  try {
    await ensureInit();
  } catch (err) {
    return res.status(500).json({ error: asError(err).message });
  }

  let parsedArgs: unknown;
  try {
    parsedArgs = def.request.parse(req.body ?? {});
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: zodMessage(err) });
    return res.status(500).json({ error: asError(err).message });
  }

  let result: unknown;
  try {
    result = await def.handler(serverCtx(), parsedArgs);
  } catch (err) {
    // Handlers throw AuthError for session problems and plain Errors with
    // user-facing messages for business-rule violations — both surface
    // exactly like the artifact's action failures did.
    if (err instanceof AuthError) return res.status(401).json({ error: err.message });
    return res.status(400).json({ error: asError(err).message });
  }

  try {
    return res.status(200).json(def.response.parse(result));
  } catch (err) {
    return res.status(500).json({ error: asError(err).message });
  }
}
