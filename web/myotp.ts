// MyOTP phone verification for Daybill signup & PIN reset.
// Free tier via RapidAPI — no credit card needed.
//
// Flow:
//   1. sendOtpCode(phone) → server sends 6-digit SMS via MyOTP
//   2. User types the code → passed as otp_code to createAccount / resetPin
//   3. Server verifies the code with MyOTP before creating account / resetting PIN
//
// Setup (one time):
//   1. rapidapi.com → sign up (free) → find "MyOTP.App" → subscribe to Basic (free) plan
//   2. Copy your RapidAPI key
//   3. Vercel → daybillofficial → Environment Variables → add MYOTP_API_KEY

import { api } from "./api-client";

/** Always available — the server handles the actual SMS sending. */
export function isOtpConfigured(): boolean {
  return true;
}

/** Ask the server to send a 6-digit SMS code to the phone number. */
export async function sendOtpCode(phone: string): Promise<void> {
  await api.sendOtpCode({ phone });
}
