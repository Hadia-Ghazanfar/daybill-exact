// Auth helpers for the Daybill Vercel API.
//
// Verbatim port of the helpers from the canonical artifact
// server/src/actions.ts: same PIN hashing (SHA-256 of salt:pin), same admin
// password hashing (PBKDF2-SHA256, 210k iterations), same session-token
// validation and error messages.
import { and, eq } from "drizzle-orm";
import { getDb } from "./_db.js";
import * as schema from "./_schema.js";

// Legacy SHA-256 (for verifying old hashes during migration)
export async function hashPinLegacy(pin: string, salt: string) {
  const bytes = new TextEncoder().encode(`${salt}:${pin}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// New: PBKDF2 with 210k iterations (same as admin passwords)
// Works with any salt string (UUID or hex)
export async function hashPin(pin: string, salt: string) {
  const saltBytes = new TextEncoder().encode(salt);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: saltBytes, iterations: 210_000, hash: "SHA-256" }, key, 256);
  return Array.from(new Uint8Array(bits), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function randomSalt() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashAdminPassword(password: string, saltHex: string) {
  const pairs = saltHex.match(/.{2}/g) ?? [];
  const salt = Uint8Array.from(pairs, (pair) => Number.parseInt(pair, 16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 210_000, hash: "SHA-256" }, key, 256);
  return Array.from(new Uint8Array(bits), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function secureEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export type SessionKind = "user" | "admin";

export interface AuthArgs {
  account_id: number;
  session_token: string;
  session_kind: SessionKind;
}

/** Thrown for authentication/authorization failures (→ HTTP 401). */
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export async function requireAccount(_ctx: unknown, args: AuthArgs) {
  const db = getDb();
  const tokenColumn = args.session_kind === "admin" ? schema.accounts.adminSessionToken : schema.accounts.sessionToken;
  const rows = await db.select().from(schema.accounts).where(and(
    eq(schema.accounts.id, args.account_id),
    eq(tokenColumn, args.session_token),
  )).limit(1);
  const account = rows[0];
  if (!account) throw new AuthError("Your session has expired. Please log in again.");
  if (args.session_kind === "user" && !account.claimed) throw new AuthError("Your session has expired. Please log in again.");
  if (args.session_kind === "admin" && (!account.isOwner || !account.adminEmail)) throw new AuthError("Administrator access is required.");
  return account;
}

export async function requireAdminAccount(ctx: unknown, args: AuthArgs) {
  if (args.session_kind !== "admin") throw new AuthError("Administrator access is required.");
  return requireAccount(ctx, args);
}

export async function requireUserAccount(ctx: unknown, args: AuthArgs) {
  if (args.session_kind !== "user") throw new AuthError("Shop workspace access requires a user account.");
  return requireAccount(ctx, args);
}
