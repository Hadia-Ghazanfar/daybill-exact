// Verifies Firebase Phone Auth ID tokens without the Admin SDK.
// Firebase publishes its public signing keys as X.509 certificates (NOT a JWKS),
// so we fetch the cert map and import the matching cert with jose's importX509.

import { importX509, jwtVerify } from "jose";

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? "";
const CERT_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

let certCache: { certs: Record<string, string>; fetchedAt: number } | null = null;

async function getPublicKey(kid: string) {
  if (!certCache || Date.now() - certCache.fetchedAt > 3_600_000) {
    const res = await fetch(CERT_URL);
    if (!res.ok) throw new Error("Could not fetch verification keys");
    certCache = { certs: (await res.json()) as Record<string, string>, fetchedAt: Date.now() };
  }
  const pem = certCache.certs[kid];
  if (!pem) throw new Error("Unknown signing key — please try again");
  return importX509(pem, "RS256");
}

/**
 * Verify a Firebase ID token from phone auth.
 * Returns the verified phone number in E.164 format (e.g. +923001234567).
 * Throws if the token is invalid, expired, or not from phone auth.
 */
export async function verifyPhoneToken(idToken: string): Promise<string> {
  if (!PROJECT_ID) throw new Error("Phone verification is not configured on the server");
  if (!idToken || idToken.length > 8192 || idToken.split(".").length !== 3) {
    throw new Error("Invalid verification token");
  }
  let kid: string;
  try {
    const headerJson = Buffer.from(idToken.split(".")[0], "base64url").toString();
    kid = (JSON.parse(headerJson) as { kid?: string }).kid ?? "";
  } catch {
    throw new Error("Invalid verification token");
  }
  if (!kid) throw new Error("Invalid verification token");
  const key = await getPublicKey(kid);
  const { payload } = await jwtVerify(idToken, key, {
    issuer: `https://securetoken.google.com/${PROJECT_ID}`,
    audience: PROJECT_ID,
  });
  const phone = (payload as Record<string, unknown>).phone_number;
  if (typeof phone !== "string" || !phone.startsWith("+")) {
    throw new Error("This verification is not linked to a phone number");
  }
  // Token must be fresh (issued within the last 15 minutes) to prevent replay
  const iat = (payload as Record<string, unknown>).iat;
  if (typeof iat !== "number" || Date.now() / 1000 - iat > 900) {
    throw new Error("Verification expired — please request a new code");
  }
  return phone;
}

/** Normalize a verified E.164 phone (+923001234567) to local format (03001234567). */
export function e164ToLocal(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  if (digits.startsWith("92")) return "0" + digits.slice(2);
  return digits;
}
