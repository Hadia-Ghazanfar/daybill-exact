// Firebase Phone OTP for Daybill signup verification & PIN reset.
// Setup (Hadia does this once):
//  1. console.firebase.google.com → create project → Authentication → Sign-in method → enable Phone
//  2. Project Settings → Your apps → add Web app → copy the config values
//  3. Vercel → daybillofficial → Settings → Environment Variables → add each VITE_FIREBASE_* below
//  4. Firebase console → Authentication → Settings → Authorized domains → add daybillofficial.vercel.app

import { initializeApp, getApps } from "firebase/app";
import {
  getAuth,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  type ConfirmationResult,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? "",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? "",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? "",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "",
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? "",
};

export function isFirebaseConfigured(): boolean {
  return firebaseConfig.apiKey.length > 10 && firebaseConfig.projectId.length > 0;
}

let recaptcha: RecaptchaVerifier | null = null;

function getFirebaseAuth() {
  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  return getAuth(app);
}

/** Send an OTP to a phone number in E.164 format (e.g. +923001234567). */
export async function sendPhoneOtp(phoneE164: string): Promise<ConfirmationResult> {
  const auth = getFirebaseAuth();
  if (recaptcha) {
    try { recaptcha.clear(); } catch { /* ignore */ }
    recaptcha = null;
  }
  recaptcha = new RecaptchaVerifier(auth, "otp-recaptcha", { size: "invisible" });
  return signInWithPhoneNumber(auth, phoneE164, recaptcha);
}

/** Verify the 6-digit code. Returns the Firebase ID token proving the number is verified. */
export async function verifyPhoneOtp(
  confirmation: ConfirmationResult,
  code: string
): Promise<{ idToken: string; phoneNumber: string | null }> {
  const credential = await confirmation.confirm(code);
  const idToken = await credential.user.getIdToken();
  // Sign out of Firebase — we only needed the verification proof, not a Firebase session
  await getFirebaseAuth().signOut();
  return { idToken, phoneNumber: credential.user.phoneNumber };
}

/** Convert a Pakistani number like 03001234567 to E.164 (+923001234567). */
export function toE164(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("92")) return "+" + digits;
  if (digits.startsWith("0")) return "+92" + digits.slice(1);
  return "+92" + digits;
}
