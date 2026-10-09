// MyOTP.App client via RapidAPI — free phone OTP verification, no credit card.
// Docs: https://rapidapi.com (MyOTP.App 2FA SMS listing)
//
// Flow:
//   1. sendOtp(phone) -> { messageId, expiresAt } — server calls MyOTP, SMS goes out
//   2. verifyOtp(phone, messageId, code) -> true/false — server checks the code
//
// Phone format: digits only, country code first, no plus, no leading zero.
// e.g. "0343-8502246" -> "923438502246"

const API_KEY = process.env.MYOTP_API_KEY ?? "";
const HOST = "myotp-app-2fa-sms.p.rapidapi.com";
const BASE = `https://${HOST}`;

// In-memory store: phone -> { messageId, expiresAt, attempts }
// (Vercel serverless: works per-instance; good enough for low-volume OTP)
const pending = new Map<string, { messageId: string; expiresAt: number; attempts: number }>();

function cleanPhone(raw: string): string {
  const digits = (raw || "").replace(/\D/g, "").replace(/^0+/, "");
  if (!/^[1-9][0-9]{6,14}$/.test(digits)) throw new Error("Invalid phone number");
  return digits;
}

function headers() {
  if (!API_KEY) throw new Error("Phone verification is not set up yet");
  return {
    "Content-Type": "application/json",
    "x-rapidapi-key": API_KEY,
    "x-rapidapi-host": HOST,
  };
}

export interface OtpSent {
  messageId: string;
  expiresAt: string;
}

/** Send a 6-digit OTP via SMS. Returns messageId for the verify step. */
export async function sendOtp(rawPhone: string): Promise<OtpSent> {
  const phone = cleanPhone(rawPhone);

  // Rate limit: 1 send per 60s per phone
  const existing = pending.get(phone);
  if (existing && Date.now() < existing.expiresAt - 4 * 60 * 1000) {
    throw new Error("Please wait before requesting a new code");
  }

  const res = await fetch(`${BASE}/generate_otp`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ phone_number: phone, channel: "sms", otp_length: 6, otp_validity: 300 }),
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok || data.status !== "accepted") {
    throw new Error((data.message as string) || "Could not send verification code");
  }

  const messageId = data.message_id as string;
  const expiresAt = new Date((data.expires_at as string) + "Z").getTime();
  pending.set(phone, { messageId, expiresAt, attempts: 0 });
  return { messageId, expiresAt: data.expires_at as string };
}

/**
 * Verify the code the user typed. Returns the verified phone in local
 * format (0300-0000000) on success. Throws on invalid/expired.
 */
export async function verifyOtp(rawPhone: string, code: string): Promise<string> {
  const phone = cleanPhone(rawPhone);
  const entry = pending.get(phone);
  if (!entry) throw new Error("No verification code was sent to this number");
  if (Date.now() > entry.expiresAt) {
    pending.delete(phone);
    throw new Error("Code expired — please request a new one");
  }
  if (entry.attempts >= 5) {
    pending.delete(phone);
    throw new Error("Too many wrong attempts — please request a new code");
  }
  if (!/^\d{3,8}$/.test(code)) throw new Error("Invalid code");

  const res = await fetch(`${BASE}/verify_otp`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ phone_number: phone, message_id: entry.messageId, otp: code }),
  });
  const data = (await res.json()) as Record<string, unknown>;

  if (data.status === "success") {
    pending.delete(phone);
    // Return local format: 923438502246 -> 0343-8502246
    const local = "0" + phone.slice(2);
    return local.slice(0, 4) + "-" + local.slice(4);
  }

  entry.attempts++;
  const reason = data.reason as string;
  if (reason === "expired") {
    pending.delete(phone);
    throw new Error("Code expired — please request a new one");
  }
  throw new Error("Wrong code — please try again");
}
