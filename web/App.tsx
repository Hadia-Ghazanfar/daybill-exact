import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, Legend, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fileToBase64, SafeAreaTopScrim } from "./sdk-shim";
import { api, setApiSession, type AccountSession, type ApiResponse } from "./api";
import daybillLogoDark from "./assets/daybill-logo-dark.png";
import daybillLogoWhite from "./assets/daybill-logo-white.png";
import daybillIcon from "./assets/brand/daybill-app-icon.png";
import welcomeShopkeeper from "./assets/approved/welcome-shopkeeper-cropped.png";
import welcomeSlideBilling from "./assets/approved/welcome-slide-billing.png";
import welcomeSlideSharing from "./assets/approved/welcome-slide-sharing.png";
import desktopShopkeeper from "./assets/approved/desktop-shopkeeper-3d.png";
import lostMonster from "./assets/approved/404-monster.png";
import QRCode from "qrcode";
import { jsPDF } from "jspdf";
import avatar1 from "./assets/avatars/avatar-1.png";
import avatar2 from "./assets/avatars/avatar-2.png";
import avatar3 from "./assets/avatars/avatar-3.png";
import avatar4 from "./assets/avatars/avatar-4.png";
import avatar5 from "./assets/avatars/avatar-5.png";
import avatar6 from "./assets/avatars/avatar-6.png";
import avatar7 from "./assets/avatars/avatar-7.png";
import avatar8 from "./assets/avatars/avatar-8.png";
import avatar9 from "./assets/avatars/avatar-9.png";
import avatar10 from "./assets/avatars/avatar-10.png";
import avatar11 from "./assets/avatars/avatar-11.png";
import avatar12 from "./assets/avatars/avatar-12.png";
import mascotAvatar from "./assets/mascot.png";
import { sendOtpCode } from "./myotp";
import { answerQuestion, QUICK_CHIPS } from "./chatbot";
import type { ChatContext } from "./chatbot";

type Workspace = ApiResponse<typeof api, "getWorkspace">;
type Product = Workspace["products"][number];
type Contact = Workspace["contacts"][number];
type Invoice = ApiResponse<typeof api, "getInvoice">["invoice"];
type Purchase = ApiResponse<typeof api, "getPurchaseInvoice">["purchase"];
type AdminDashboard = ApiResponse<typeof api, "getAdminDashboard">;
type RegisteredAccount = AdminDashboard["accounts"][number];
type UserFeedback = AdminDashboard["feedback"][number];
type Tab = "dashboard" | "create" | "products" | "contacts" | "history" | "profile";
type Line = { key: number; productId: number | null; quantity: string };
type PurchaseLine = { key: number; productId: number | null; quantity: string; unitCost: string };
type PurchaseDocumentType = "purchase_order" | "delivered_purchase";
type PurchaseDraft = {
  purchase_number: string;
  supplier_id: number | null;
  supplier_name: string;
  supplier_phone: string;
  supplier_address: string;
  issue_date: string;
  due_date: string | null;
  document_type: PurchaseDocumentType;
  delivery_status: "pending" | "delivered";
  payment_status: "pending" | "paid";
  payment_method: "card" | "cash" | "transfer" | "credit";
  supplier_reference: string;
  notes: string;
  total: number;
  currency: string;
  items: Purchase["items"];
};
type Language = "en" | "ur";
type Theme = "light" | "dark";
type LaunchPhase = "splash" | "welcome" | "auth" | "open";

const SESSION_STORAGE_KEY = "hisaab-account-session-v1";
const THEME_STORAGE_KEY = "hisaab-theme-v1";
const MOBILE_BILLS_RETURN_KEY = "daybill-mobile-return-to-bills-v1";
const MOBILE_DETAIL_HISTORY_KEY = "daybillMobileDetail";

function isMobileAppLayout() {
  return window.matchMedia("(max-width: 759px)").matches || document.documentElement.classList.contains("phone-layout");
}

function readAccountSession(): AccountSession | null {
  try {
    const saved = localStorage.getItem(SESSION_STORAGE_KEY) ?? sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!saved) return null;
    const parsed: unknown = JSON.parse(saved);
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Partial<AccountSession>;
    if (!Number.isInteger(record.account_id) || typeof record.session_token !== "string" || typeof record.shopkeeper_name !== "string" || typeof record.phone !== "string") return null;
    return { ...record, session_kind: record.session_kind === "admin" ? "admin" : "user" } as AccountSession;
  } catch {
    return null;
  }
}

function saveAccountSession(session: AccountSession, remember = true) {
  const target = remember ? localStorage : sessionStorage;
  const other = remember ? sessionStorage : localStorage;
  other.removeItem(SESSION_STORAGE_KEY);
  target.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  setApiSession(session);
}

type LanguageContextValue = { language: Language; setLanguage: (language: Language) => void };
const LanguageContext = createContext<LanguageContextValue>({ language: "en", setLanguage: () => undefined });
type ThemeContextValue = { theme: Theme; setTheme: (theme: Theme) => void };
const ThemeContext = createContext<ThemeContextValue>({ theme: "light", setTheme: () => undefined });

const urduUi: Record<string, string> = {
  "Daybill": "ڈے بل",
  "Roz ka karobar, ab asaan": "روز کا کاروبار، اب آسان",
  "Your daily trade, simplified": "آپ کا روزانہ کاروبار، مزید آسان",
  "Welcome to Daybill!": "ڈے بل میں خوش آمدید!",
  "Roz ka karobar, ab asaan — your daily trade, simplified": "روز کا کاروبار، اب آسان — آپ کا روزانہ کاروبار، مزید آسان",
  "Access Your Account": "اپنے اکاؤنٹ تک رسائی حاصل کریں",
  "Don’t have an account? Signup": "اکاؤنٹ نہیں ہے؟ سائن اپ کریں",
  "Oops, I think we’re lost": "اوہ، لگتا ہے ہم راستہ بھول گئے ہیں",
  "Let’s get you back somewhere familiar…": "آئیں آپ کو واپس مانوس جگہ لے چلیں…",
  "Back to home": "ہوم پر واپس جائیں",
  "+12% this month": "+12% اس ماہ",
  "8 paid today": "8 آج ادا ہوئیں",
  "Opening the ledger…": "کھاتہ کھولا جا رہا ہے…",
  "Couldn’t open your records": "آپ کا ریکارڈ نہیں کھل سکا",
  "Try again": "دوبارہ کوشش کریں",
  "Home": "ہوم",
  "Create": "بنائیں",
  "Stock": "اسٹاک",
  "Contacts": "رابطے",
  "Bills": "بل",
  "Profile": "پروفائل",
  "Registered Accounts": "رجسٹرڈ اکاؤنٹس",
  "User Feedback": "صارفین کی رائے",
  "Feedback": "رائے",
  "Share feedback": "رائے دیں",
  "Help us improve Daybill": "ڈے بل کو بہتر بنانے میں ہماری مدد کریں",
  "Tell us what is working, what needs fixing, or what you would like us to add.": "ہمیں بتائیں کہ کیا اچھا چل رہا ہے، کیا درست کرنے کی ضرورت ہے، یا آپ کیا شامل کروانا چاہتے ہیں۔",
  "Category": "قسم",
  "Choose a category (optional)": "قسم منتخب کریں (اختیاری)",
  "Bug": "خرابی",
  "Suggestion": "تجویز",
  "Other": "دیگر",
  "Message": "پیغام",
  "Write your feedback": "اپنی رائے لکھیں",
  "Send feedback": "رائے بھیجیں",
  "Sending…": "بھیجی جا رہی ہے…",
  "Thank you for your feedback.": "آپ کی رائے کا شکریہ۔",
  "Your message has been sent to the Daybill team.": "آپ کا پیغام ڈے بل ٹیم کو بھیج دیا گیا ہے۔",
  "Send another response": "مزید رائے دیں",
  "Close feedback form": "رائے کا فارم بند کریں",
  "Messages from shop accounts, newest first.": "دکان کے اکاؤنٹس سے پیغامات، نئے پہلے۔",
  "No feedback yet": "ابھی کوئی رائے نہیں",
  "Feedback submitted by users will appear here.": "صارفین کی بھیجی گئی رائے یہاں نظر آئے گی۔",
  "Sender & phone": "بھیجنے والا اور فون",
  "Subject / category": "موضوع / قسم",
  "Date": "تاریخ",
  "No category": "کوئی قسم نہیں",
  "Admin Dashboard": "ایڈمن ڈیش بورڈ",
  "Platform overview": "پلیٹ فارم کا جائزہ",
  "Total Registered Accounts": "کل رجسٹرڈ اکاؤنٹس",
  "Total Invoices Generated": "کل بنائی گئی رسیدیں",
  "Total Customers": "کل گاہک",
  "Total Suppliers": "کل سپلائرز",
  "Across all user accounts": "تمام صارف اکاؤنٹس میں",
  "Account holder & phone": "اکاؤنٹ ہولڈر اور فون",
  "ADMIN PROFILE": "ایڈمن پروفائل",
  "Oversight access only": "صرف نگرانی کی رسائی",
  "Choose how to sign in": "لاگ اِن کا طریقہ منتخب کریں",
  "Welcome back": "خوش آمدید",
  "Sign in to continue to your business.": "اپنے کاروبار کو جاری رکھنے کے لیے لاگ اِن کریں۔",
  "Shop accounts and administrator access stay separate.": "دکان کے اکاؤنٹس اور ایڈمن رسائی الگ رہتی ہے۔",
  "User": "صارف",
  "Admin": "ایڈمن",
  "User Login": "صارف لاگ اِن",
  "Admin Login": "ایڈمن لاگ اِن",
  "Remember me": "مجھے یاد رکھیں",
  "Pause slideshow": "سلائیڈ شو روکیں",
  "Play slideshow": "سلائیڈ شو چلائیں",
  "Create Invoices Faster and Easier": "رسیدیں زیادہ تیزی اور آسانی سے بنائیں",
  "Build polished sales and supplier invoices in a few simple steps.": "چند آسان مراحل میں عمدہ فروخت اور سپلائر رسیدیں بنائیں۔",
  "Know Your Dues and Stock": "اپنے واجبات اور اسٹاک سے باخبر رہیں",
  "See revenue, profit, pending payments and inventory at a glance.": "آمدن، منافع، زیرِ التوا ادائیگیاں اور انوینٹری ایک نظر میں دیکھیں۔",
  "Share Clearly on WhatsApp": "واٹس ایپ پر واضح طور پر شیئر کریں",
  "Save a clean invoice image and open the right customer chat.": "صاف رسید کی تصویر محفوظ کریں اور درست گاہک کی چیٹ کھولیں۔",
  "Phone number + 4-digit PIN": "فون نمبر + 4 ہندسوں کا پن",
  "Email + secure password": "ای میل + محفوظ پاس ورڈ",
  "Regular users can create separate shop accounts after choosing User Login. Administrator access has no registration option.": "عام صارفین صارف لاگ اِن منتخب کرنے کے بعد الگ دکان اکاؤنٹ بنا سکتے ہیں۔ ایڈمن رسائی کے لیے رجسٹریشن کا کوئی اختیار نہیں۔",
  "ADMIN ACCESS": "ایڈمن رسائی",
  "Set admin password": "ایڈمن پاس ورڈ مقرر کریں",
  "Create the administrator password for this account. It will be stored only as a secure salted hash.": "اس اکاؤنٹ کے لیے ایڈمن پاس ورڈ بنائیں۔ یہ صرف محفوظ سالٹڈ ہیش کی صورت میں محفوظ ہوگا۔",
  "Sign in to view the owner-only registered accounts database.": "صرف مالک کے رجسٹرڈ اکاؤنٹس ڈیٹا بیس کو دیکھنے کے لیے لاگ اِن کریں۔",
  "Admin email": "ایڈمن ای میل",
  "Checking administrator account…": "ایڈمن اکاؤنٹ چیک کیا جا رہا ہے…",
  "Set password": "پاس ورڈ مقرر کریں",
  "Password": "پاس ورڈ",
  "Admin password": "ایڈمن پاس ورڈ",
  "Use at least 10 characters.": "کم از کم 10 حروف استعمال کریں۔",
  "Confirm password": "پاس ورڈ کی تصدیق کریں",
  "Confirm admin password": "ایڈمن پاس ورڈ کی تصدیق کریں",
  "Enter a valid email address.": "درست ای میل درج کریں۔",
  "Passwords do not match.": "پاس ورڈز ایک جیسے نہیں ہیں۔",
  "Set password & sign in": "پاس ورڈ مقرر کریں اور لاگ اِن ہوں",
  "There is one administrator account. New administrator accounts cannot be created here.": "صرف ایک ایڈمن اکاؤنٹ ہے۔ یہاں نیا ایڈمن اکاؤنٹ نہیں بنایا جا سکتا۔",
  "USER LOGIN": "صارف لاگ اِن",
  "NEW USER ACCOUNT": "نیا صارف اکاؤنٹ",
  "Enter the same phone number and 4-digit PIN you used for this shop account.": "اس دکان اکاؤنٹ کے لیے استعمال کیا گیا فون نمبر اور 4 ہندسوں کا پن درج کریں۔",
  "New here? Create user account": "نئے ہیں؟ صارف اکاؤنٹ بنائیں",
  "Already have a user account? Log in": "صارف اکاؤنٹ پہلے سے ہے؟ لاگ اِن کریں",
  "User accounts use a phone number and 4-digit PIN. Administrator access is available separately from the welcome screen.": "صارف اکاؤنٹس فون نمبر اور 4 ہندسوں کا پن استعمال کرتے ہیں۔ ایڈمن رسائی ابتدائی اسکرین پر الگ دستیاب ہے۔",
  "Log in to an existing shop account or create a separate one.": "موجودہ دکان کے اکاؤنٹ میں لاگ اِن کریں یا الگ اکاؤنٹ بنائیں۔",
  "Existing account? Log in with the same phone number and PIN to access its shop records.": "موجودہ اکاؤنٹ ہے؟ دکان کا ریکارڈ کھولنے کے لیے اسی فون نمبر اور پن سے لاگ اِن کریں۔",
  "Accounts and shop records are stored in Daybill’s database. Only the login session is kept on this device; no SMS or OTP is used.": "اکاؤنٹس اور دکان کا ریکارڈ ڈے بل کے ڈیٹا بیس میں محفوظ ہوتا ہے۔ اس ڈیوائس پر صرف لاگ اِن سیشن رکھا جاتا ہے؛ ایس ایم ایس یا او ٹی پی استعمال نہیں ہوتا۔",
  "Account holder": "اکاؤنٹ ہولڈر",
  "Administrator session": "ایڈمن سیشن",
  "Signed in as": "لاگ اِن صارف",
  "Signed in account": "لاگ اِن اکاؤنٹ",
  "Logout / Switch account": "لاگ آؤٹ / اکاؤنٹ تبدیل کریں",
  "Shop name": "دکان کا نام",
  "Created": "بنایا گیا",
  "ADMIN": "ایڈمن",
  "Owner database": "مالک کا ڈیٹا بیس",
  "Every account created in Daybill, newest first.": "ڈے بل میں بنائے گئے تمام اکاؤنٹس، نئے اکاؤنٹس پہلے۔",
  "View registered accounts": "رجسٹرڈ اکاؤنٹس دیکھیں",
  "Hide registered accounts": "رجسٹرڈ اکاؤنٹس چھپائیں",
  "No registered accounts": "کوئی رجسٹرڈ اکاؤنٹ نہیں",
  "New accounts will appear here as soon as they are created.": "نئے اکاؤنٹس بنتے ہی یہاں نظر آئیں گے۔",
  "Couldn’t load registered accounts": "رجسٹرڈ اکاؤنٹس لوڈ نہیں ہو سکے",
  "Not provided": "فراہم نہیں کیا گیا",
  "SALES INVOICE": "فروخت کی رسید",
  "SUPPLIER INVOICE": "سپلائر کی رسید",
  "Ready to send": "بھیجنے کے لیے تیار",
  "Make the bill": "بل بنائیں",
  "Purchase recorded": "خریداری محفوظ ہو گئی",
  "Record new stock": "نیا اسٹاک درج کریں",
  "Sales invoice": "فروخت کی رسید",
  "Supplier invoice": "سپلائر کی رسید",
  "Supplier document ready": "سپلائر دستاویز تیار ہے",
  "Create supplier document": "سپلائر دستاویز بنائیں",
  "Purchase Order": "خریداری کا آرڈر",
  "Purchase Orders": "خریداری کے آرڈرز",
  "Supplier document type filter": "سپلائر دستاویز کی قسم کا فلٹر",
  "Delivered Purchase": "موصول شدہ خریداری",
  "Choose supplier invoice type": "سپلائر رسید کی قسم منتخب کریں",
  "Order stock from a supplier without adding it to inventory yet.": "سپلائر سے اسٹاک آرڈر کریں، ابھی انوینٹری میں شامل کیے بغیر۔",
  "Record stock that has already arrived and add it to inventory now.": "پہنچ چکا اسٹاک درج کریں اور اسے ابھی انوینٹری میں شامل کریں۔",
  "Pending delivery": "ترسیل کا انتظار",
  "Delivered": "موصول ہو گیا",
  "Mark delivered & add to stock": "موصول شدہ نشان لگائیں اور اسٹاک میں شامل کریں",
  "Marking delivered adds every item to inventory once and moves the amount into supplier payables.": "موصول شدہ نشان لگانے سے ہر آئٹم ایک بار انوینٹری میں شامل ہو گا اور رقم سپلائر واجبات میں چلی جائے گی۔",
  "Purchase order saved. Inventory has not changed yet.": "خریداری کا آرڈر محفوظ ہو گیا۔ انوینٹری ابھی تبدیل نہیں ہوئی۔",
  "Purchase order": "خریداری کا آرڈر",
  "Stock arrives later": "اسٹاک بعد میں آئے گا",
  "Stock received now": "اسٹاک ابھی موصول ہوا",
  "Qty ordered": "آرڈر کی گئی تعداد",
  "What stock do you need?": "کون سا اسٹاک درکار ہے؟",
  "Who should deliver the stock?": "اسٹاک کس نے پہنچانا ہے؟",
  "Check and send order": "آرڈر چیک کریں اور بھیجیں",
  "Save purchase order": "خریداری کا آرڈر محفوظ کریں",
  "Record delivered purchase": "موصول شدہ خریداری درج کریں",
  "PURCHASE ORDER PREVIEW": "خریداری کے آرڈر کا پیش نظارہ",
  "Stock changes only when marked delivered": "اسٹاک صرف موصول شدہ نشان لگانے پر بدلے گا",
  "Inventory and supplier payables will not change until this order is marked delivered.": "جب تک آرڈر موصول شدہ نشان نہیں لگتا، انوینٹری اور سپلائر واجبات تبدیل نہیں ہوں گے۔",
  "Order total": "آرڈر کی کل رقم",
  "Please deliver the listed stock.": "براہِ کرم درج شدہ اسٹاک فراہم کریں۔",
  "Stock received and recorded.": "اسٹاک موصول اور درج ہو گیا۔",
  "Send purchase order image": "خریداری کے آرڈر کی تصویر بھیجیں",
  "Share supplier document image": "سپلائر دستاویز کی تصویر شیئر کریں",
  "Supplier document image sent to the phone share sheet.": "سپلائر دستاویز کی تصویر فون کے شیئر مینو میں بھیج دی گئی ہے۔",
  "Add the supplier’s WhatsApp number, including the country code, then try again.": "سپلائر کا واٹس ایپ نمبر ملکی کوڈ سمیت شامل کریں، پھر دوبارہ کوشش کریں۔",
  "Customer": "گاہک",
  "Supplier": "سپلائر",
  "Back to contacts": "رابطوں پر واپس",
  "Contact not found": "رابطہ نہیں ملا",
  "This contact is no longer available.": "یہ رابطہ اب دستیاب نہیں ہے۔",
  "No address saved": "پتہ محفوظ نہیں",
  "Contact billing summary": "رابطے کی بلنگ کا خلاصہ",
  "Total billed": "کل بل",
  "Paid": "ادا شدہ",
  "Pending": "زیرِ التوا",
  "Last transaction": "آخری لین دین",
  "No transactions yet": "ابھی کوئی لین دین نہیں",
  "One transaction": "ایک لین دین",
  "About every": "تقریباً ہر",
  "days": "دن",
  "invoice": "رسید",
  "invoices": "رسیدیں",
  "COMPLETE HISTORY": "مکمل تاریخ",
  "Invoice history": "رسیدوں کی تاریخ",
  "No invoice history": "رسیدوں کی کوئی تاریخ نہیں",
  "Invoices for this customer will appear here.": "اس گاہک کی رسیدیں یہاں نظر آئیں گی۔",
  "Orders and purchases for this supplier will appear here.": "اس سپلائر کے آرڈر اور خریداریاں یہاں نظر آئیں گی۔",
  "Items": "اشیاء",
  "Preview": "پیش نظارہ",
  "Review": "جائزہ",
  "SAVED": "محفوظ",
  "STOCKED": "اسٹاک شامل",
  "Mark as paid": "ادا شدہ نشان لگائیں",
  "Mark supplier paid": "سپلائر کو ادا شدہ نشان لگائیں",
  "Paid · mark pending": "ادا شدہ · زیرِ التوا کریں",
  "Share invoice image": "رسید کی تصویر شیئر کریں",
  "Save invoice image": "رسید کی تصویر محفوظ کریں",
  "Preparing image…": "تصویر تیار ہو رہی ہے…",
  "Preparing…": "تیار ہو رہا ہے…",
  "Create another invoice": "ایک اور رسید بنائیں",
  "Record another purchase": "ایک اور خریداری درج کریں",
  "Who are you billing?": "بل کس کے نام ہے؟",
  "Add customer": "گاہک شامل کریں",
  "Select customer": "گاہک منتخب کریں",
  "Choose avatar": "اوتار منتخب کریں",
  "Pick a profile picture — or upload your logo above.": "پروفائل تصویر منتخب کریں — یا اوپر اپنا لوگو اپ لوڈ کریں۔",
  "Scan to pay": "ادائیگی کے لیے اسکین کریں",
  "Payment account": "ادائیگی اکاؤنٹ",
  "Add your bank details — the app creates a scannable QR for your invoices.": "اپنے بینک کی تفصیلات شامل کریں — ایپ آپ کی رسیدوں کے لیے اسکین ہونے والا کیو آر بنائے گی۔",
  "Bank name": "بینک کا نام",
  "Account title": "اکاؤنٹ کا عنوان",
  "Account number": "اکاؤنٹ نمبر",
  "IBAN": "آئی بین",
  "New": "نیا",
  "Search products…": "مصنوعات تلاش کریں…",
  "SAVED CATALOG": "محفوظ کیٹلاگ",
  "Products": "مصنوعات",
  "Prices added here fill invoices automatically.": "یہاں شامل کردہ قیمتیں رسیدوں میں خودکار بھری جاتی ہیں۔",
  "Edit product": "پروڈکٹ میں ترمیم",
  "New product": "نیا پروڈکٹ",
  "Product image": "پروڈکٹ کی تصویر",
  "Brand": "برانڈ",
  "Type": "قسم",
  "Shelf code": "شیلف کوڈ",
  "Unit": "یونٹ",
  "Selling price": "فروخت قیمت",
  "Cost price": "لاگت قیمت",
  "Stock count": "اسٹاک تعداد",
  "Supplier": "سپلائر",
  "No supplier": "کوئی سپلائر نہیں",
  "Save product": "پروڈکٹ محفوظ کریں",
  "Image": "تصویر",
  "Count": "تعداد",
  "Edit": "ترمیم",
  "Delete": "حذف کریں",
  "No products here": "یہاں کوئی پروڈکٹ نہیں",
  "Add products to fill invoices automatically.": "رسیدیں خودکار بھرنے کے لیے پروڈکٹس شامل کریں۔",
  "Help": "مدد",
  "Logout": "لاگ آؤٹ",
  "Toggle theme": "تھیم تبدیل کریں",
  "in stock": "اسٹاک میں",
  "Category": "قسم",
  "Sizes": "سائز",
  "e.g. Cables, Chargers": "مثلاً کیبلز، چارجرز",
  "e.g. S, M, L or 250g, 500g": "مثلاً S، M، L یا 250g، 500g",
  "Featured product": "نمایاں پروڈکٹ",
  "Show in special section": "خصوصی سیکشن میں دکھائیں",
  "All": "تمام",
  "Featured": "نمایاں",
  "Choose a customer": "گاہک چُنیں",
  "No phone saved": "فون نمبر محفوظ نہیں",
  "Select a customer to unlock Step 2.": "مرحلہ 2 کھولنے کے لیے گاہک منتخب کریں۔",
  "No customers yet": "ابھی کوئی گاہک نہیں",
  "Save a customer first, then return here to make their invoice.": "پہلے گاہک محفوظ کریں، پھر اس کی رسید بنانے کے لیے واپس آئیں۔",
  "Invoice date": "رسید کی تاریخ",
  "Payment due": "ادائیگی کی آخری تاریخ",
  "Continue to items": "اشیاء کی طرف جائیں",
  "What did they buy?": "انہوں نے کیا خریدا؟",
  "Add product": "پروڈکٹ شامل کریں",
  "Choose product": "پروڈکٹ چُنیں",
  "Qty": "تعداد",
  "Add another line": "ایک اور شے شامل کریں",
  "Payment method": "ادائیگی کا طریقہ",
  "Card": "کارڈ",
  "Cash": "نقد",
  "Transfer": "بینک ٹرانسفر",
  "Credit": "ادھار",
  "Discount": "رعایت",
  "No discount": "کوئی رعایت نہیں",
  "Percentage": "فیصد",
  "Fixed amount": "مقررہ رقم",
  "Discount percent": "رعایت کا فیصد",
  "Note": "نوٹ",
  "optional": "اختیاری",
  "Payment terms or a short thank-you": "ادائیگی کی شرائط یا مختصر شکریہ",
  "Your product list is empty": "آپ کی پروڈکٹ فہرست خالی ہے",
  "Save products with their prices so you can add them to invoices in one tap.": "قیمتوں کے ساتھ پروڈکٹس محفوظ کریں تاکہ رسید میں فوراً شامل ہو سکیں۔",
  "Check and save": "جائزہ لیں اور محفوظ کریں",
  "Edit items": "اشیاء میں ترمیم کریں",
  "Invoice not saved.": "رسید محفوظ نہیں ہوئی۔",
  "LIVE PREVIEW": "براہِ راست پیش نظارہ",
  "Updates as you type": "لکھتے ہی اپ ڈیٹ ہوتا ہے",
  "INVOICE": "رسید",
  "Issued": "جاری شدہ",
  "Due": "واجب الادا",
  "BILL TO": "بل بنام",
  "Select a customer": "گاہک منتخب کریں",
  "PAYMENT METHOD": "ادائیگی کا طریقہ",
  "Item": "شے",
  "Amount": "رقم",
  "Add products to see them here.": "پروڈکٹس شامل کریں، وہ یہاں نظر آئیں گی۔",
  "Subtotal": "ذیلی کل",
  "Total": "کل رقم",
  "Thank you for your business.": "آپ کے کاروبار کا شکریہ۔",
  "PAY ONLINE": "آن لائن ادائیگی",
  "Demo QR": "نمونہ کیو آر",
  "Purchase invoice creation steps": "خریداری کی رسید بنانے کے مراحل",
  "Who supplied the stock?": "اسٹاک کس نے فراہم کیا؟",
  "Add supplier": "سپلائر شامل کریں",
  "Select supplier": "سپلائر منتخب کریں",
  "Choose a supplier": "سپلائر چُنیں",
  "Select a supplier to unlock Step 2.": "مرحلہ 2 کھولنے کے لیے سپلائر منتخب کریں۔",
  "No suppliers yet": "ابھی کوئی سپلائر نہیں",
  "Add a supplier first, then record stock bought from them.": "پہلے سپلائر شامل کریں، پھر اس سے خریدا گیا اسٹاک درج کریں۔",
  "Purchase date": "خریداری کی تاریخ",
  "Supplier bill / reference": "سپلائر بل / حوالہ",
  "Continue to stock": "اسٹاک کی طرف جائیں",
  "What stock arrived?": "کون سا اسٹاک آیا؟",
  "Qty received": "موصولہ تعداد",
  "Unit cost": "فی یونٹ لاگت",
  "Add another stock item": "ایک اور اسٹاک آئٹم شامل کریں",
  "Payment status": "ادائیگی کی حالت",
  "Pay later": "بعد میں ادائیگی",
  "Already paid": "پہلے سے ادا شدہ",
  "No products yet": "ابھی کوئی پروڈکٹ نہیں",
  "Add the product first, then record the quantity and actual supplier cost.": "پہلے پروڈکٹ شامل کریں، پھر تعداد اور اصل سپلائر لاگت درج کریں۔",
  "Check and record": "جائزہ لیں اور درج کریں",
  "Edit stock": "اسٹاک میں ترمیم کریں",
  "PURCHASE PREVIEW": "خریداری کا پیش نظارہ",
  "Stock increases when saved": "محفوظ کرنے پر اسٹاک بڑھے گا",
  "STOCK PURCHASE": "اسٹاک کی خریداری",
  "SUPPLIER": "سپلائر",
  "Total purchase": "کل خریداری",
  "Business overview": "کاروباری جائزہ",
  "Your shop": "آپ کی دکان",
  "Total revenue": "کل آمدن",
  "All invoices": "تمام رسیدیں",
  "Profit": "منافع",
  "Revenue": "آمدن",
  "Cost": "لاگت",
  "Pending dues": "زیرِ التوا واجبات",
  "Revenue, cost & profit": "آمدن، لاگت اور منافع",
  "7 days": "7 دن",
  "1 month": "1 ماہ",
  "3 months": "3 ماہ",
  "6 months": "6 ماہ",
  "9 months": "9 ماہ",
  "1 year": "1 سال",
  "Lifetime": "تمام مدت",
  "MENU": "مینو",
  "FINANCIAL": "مالی",
  "TOOLS": "ٹولز",
  "Customer dues": "گاہکوں کے بقایا جات",
  "Supplier payables": "سپلائر کی واجب الادا رقم",
  "New sale": "نئی فروخت",
  "Buy stock": "اسٹاک خریدیں",
  "Inventory": "انوینٹری",
  "Cost of goods sold": "فروخت شدہ مال کی لاگت",
  "Actual recorded cost attached to sold stock": "فروخت شدہ اسٹاک کی اصل درج شدہ لاگت",
  "Gross profit": "مجموعی منافع",
  "Revenue minus actual product cost": "آمدن منفی اصل پروڈکٹ لاگت",
  "Stock purchased": "خریدا گیا اسٹاک",
  "Total value of supplier invoices": "سپلائر رسیدوں کی کل مالیت",
  "SALES ACTIVITY": "فروخت کی سرگرمی",
  "Last 7 days": "گزشتہ 7 دن",
  "CUSTOMER DUES": "گاہکوں کے بقایا جات",
  "Overdue reminders": "واجب الادا یاد دہانیاں",
  "Send Reminder on WhatsApp": "واٹس ایپ پر یاد دہانی بھیجیں",
  "WhatsApp number missing": "واٹس ایپ نمبر موجود نہیں",
  "Each reminder opens WhatsApp with the invoice number, amount and due date already filled in. You stay in control of sending it.": "ہر یاد دہانی واٹس ایپ میں رسید نمبر، رقم اور واجب الادا تاریخ کے ساتھ تیار کھلتی ہے۔ بھیجنے کا اختیار آپ کے پاس رہتا ہے۔",
  "SUPPLIER PAYABLES": "سپلائر کی واجب الادا رقم",
  "Payments overdue": "ادائیگیاں تاخیر کا شکار",
  "Review the supplier bill and mark it paid when settled.": "سپلائر کا بل دیکھیں اور ادائیگی کے بعد ادا شدہ نشان لگائیں۔",
  "Open purchase": "خریداری کھولیں",
  "Recent invoices": "حالیہ رسیدیں",
  "Create new": "نئی بنائیں",
  "No invoices yet": "ابھی کوئی رسید نہیں",
  "Create your first invoice to start tracking revenue.": "آمدن کی نگرانی شروع کرنے کے لیے پہلی رسید بنائیں۔",
  "Recent purchases": "حالیہ خریداریاں",
  "Record stock": "اسٹاک درج کریں",
  "No purchases yet": "ابھی کوئی خریداری نہیں",
  "Record a supplier invoice to increase stock and track payables.": "اسٹاک بڑھانے اور واجبات دیکھنے کے لیے سپلائر رسید درج کریں۔",
  "View all": "سب دیکھیں",
  "No stock yet": "ابھی کوئی اسٹاک نہیں",
  "Add products with starting units to track inventory.": "انوینٹری کی نگرانی کے لیے ابتدائی تعداد کے ساتھ پروڈکٹس شامل کریں۔",
  "ONE-TIME SETUP": "ایک بار کی ترتیب",
  "Put your shop on the invoice": "رسید پر اپنی دکان کی تفصیل لگائیں",
  "Add the business name, currency, optional logo, and contact details that should appear on every bill.": "کاروبار کا نام، کرنسی، اختیاری لوگو اور رابطے کی تفصیل شامل کریں جو ہر بل پر نظر آئے۔",
  "Set up shop details": "دکان کی تفصیل ترتیب دیں",
  "SHOP PROFILE": "دکان کی پروفائل",
  "No address added": "پتہ شامل نہیں",
  "Phone / WhatsApp": "فون / واٹس ایپ",
  "Not added": "شامل نہیں",
  "Currency": "کرنسی",
  "Invoice accent": "رسید کا رنگ",
  "Edit shop details": "دکان کی تفصیل میں ترمیم کریں",
  "Language": "زبان",
  "How to use": "استعمال کا طریقہ",
  "SHOP DETAILS": "دکان کی تفصیل",
  "Invoice identity": "رسید کی شناخت",
  "Shop logo": "دکان کا لوگو",
  "Optional · PNG or JPEG": "اختیاری · PNG یا JPEG",
  "Replace logo": "لوگو بدلیں",
  "Upload logo": "لوگو اپ لوڈ کریں",
  "Business / shop name": "کاروبار / دکان کا نام",
  "Phone": "فون",
  "Address": "پتہ",
  "Save shop details": "دکان کی تفصیل محفوظ کریں",
  "SAVED CATALOG": "محفوظ کیٹلاگ",
  "Products": "پروڈکٹس",
  "Prices added here fill invoices automatically.": "یہاں شامل قیمتیں رسید میں خود بخود آ جاتی ہیں۔",
  "Add": "شامل کریں",
  "Edit product": "پروڈکٹ میں ترمیم",
  "New product": "نئی پروڈکٹ",
  "Product name": "پروڈکٹ کا نام",
  "Selling price": "فروخت کی قیمت",
  "Cost price": "لاگت کی قیمت",
  "Unit": "یونٹ",
  "Units in stock": "اسٹاک میں تعداد",
  "No supplier linked": "کوئی سپلائر منسلک نہیں",
  "Add a supplier under Contacts, then return here to link it with this item.": "رابطوں میں سپلائر شامل کریں، پھر اسے اس آئٹم سے منسلک کرنے کے لیے واپس آئیں۔",
  "Save product": "پروڈکٹ محفوظ کریں",
  "No products saved": "کوئی پروڈکٹ محفوظ نہیں",
  "Add the items you sell and their usual prices.": "فروخت کی جانے والی اشیاء اور ان کی عام قیمتیں شامل کریں۔",
  "Back to invoice": "رسید پر واپس جائیں",
  "ADDRESS BOOK": "رابطہ فہرست",
  "Customers appear in invoices; suppliers stay organized here.": "گاہک رسیدوں میں آتے ہیں؛ سپلائر یہاں منظم رہتے ہیں۔",
  "Edit contact": "رابطے میں ترمیم",
  "New contact": "نیا رابطہ",
  "Contact type": "رابطے کی قسم",
  "Name": "نام",
  "WhatsApp / phone": "واٹس ایپ / فون",
  "Save contact": "رابطہ محفوظ کریں",
  "All": "تمام",
  "Customers": "گاہک",
  "Suppliers": "سپلائرز",
  "No contacts here": "یہاں کوئی رابطہ نہیں",
  "Add a customer for invoicing or a supplier for your records.": "رسید کے لیے گاہک یا ریکارڈ کے لیے سپلائر شامل کریں۔",
  "SAVED BILLS": "محفوظ بل",
  "Invoices": "رسیدیں",
  "Sales invoices": "فروخت کی رسیدیں",
  "Supplier invoices": "سپلائر کی رسیدیں",
  "Overdue": "میعاد گزر چکی",
  "No overdue invoices": "کوئی تاخیر شدہ رسید نہیں",
  "Pending invoices appear here after their due date passes.": "زیرِ التوا رسیدیں واجب الادا تاریخ گزرنے کے بعد یہاں نظر آئیں گی۔",
  "Invoice status filter": "رسید کی حالت کا فلٹر",
  "No sales invoices yet": "ابھی کوئی فروخت کی رسید نہیں",
  "Create and save your first sales invoice to start the record.": "ریکارڈ شروع کرنے کے لیے پہلی فروخت کی رسید بنائیں اور محفوظ کریں۔",
  "No supplier invoices yet": "ابھی کوئی سپلائر رسید نہیں",
  "Record a purchase to increase stock and track what you owe.": "اسٹاک بڑھانے اور واجب الادا رقم دیکھنے کے لیے خریداری درج کریں۔",
  "pending": "زیرِ التوا",
  "paid": "ادا شدہ",
  "in stock": "اسٹاک میں",
  "Open invoice": "رسید کھولیں",
  "AMOUNT": "رقم",
  "ITEM": "شے",
  "QTY": "تعداد",
  "NOTE": "نوٹ",
  "Business totals": "کاروباری مجموعے",
  "Primary navigation": "مرکزی نیویگیشن",
  "Create a new invoice": "نئی رسید بنائیں",
  "Invoice creation steps": "رسید بنانے کے مراحل",
  "Invoice type": "رسید کی قسم",
  "Live invoice preview": "رسید کا براہِ راست پیش نظارہ",
  "Purchase invoice preview": "خریداری کی رسید کا پیش نظارہ",
  "Choose a PNG or JPEG image": "PNG یا JPEG تصویر منتخب کریں",
  "Image creation is not supported in this browser": "اس براؤزر میں تصویر بنانا دستیاب نہیں",
  "Invoice image is still being prepared. Try again in a moment.": "رسید کی تصویر ابھی تیار ہو رہی ہے۔ ایک لمحے بعد دوبارہ کوشش کریں۔",
  "Download started — check your browser’s Downloads or Files app.": "ڈاؤن لوڈ شروع ہو گیا — براؤزر کے ڈاؤن لوڈز یا فائلز ایپ میں دیکھیں۔",
  "Image sharing is unavailable here, so the PNG download has started. Attach it in WhatsApp.": "یہاں براہِ راست شیئر دستیاب نہیں، اس لیے PNG ڈاؤن لوڈ شروع ہو گیا ہے۔ اسے واٹس ایپ میں منسلک کریں۔",
  "Invoice image sent to the phone share sheet.": "رسید کی تصویر فون کے شیئر مینو میں بھیج دی گئی ہے۔",
  "Could not create the invoice image": "رسید کی تصویر نہیں بن سکی",
  "Could not share the invoice image": "رسید کی تصویر شیئر نہیں ہو سکی",
  "The invoice is in your records and ready to share.": "رسید ریکارڈ میں محفوظ ہے اور شیئر کرنے کے لیے تیار ہے۔",
  "This sends the PNG to your phone’s share sheet—choose WhatsApp and the invoice is attached as an image, not text.": "یہ PNG فون کے شیئر مینو میں بھیجتا ہے—واٹس ایپ چُنیں، رسید تصویر کے طور پر منسلک ہو گی، متن کے طور پر نہیں۔",
  "Inventory increased and the supplier balance is now in payables.": "انوینٹری بڑھ گئی ہے اور سپلائر کی رقم واجبات میں شامل ہو گئی ہے۔",
  "Inventory increased and this supplier invoice is marked paid.": "انوینٹری بڑھ گئی ہے اور یہ سپلائر رسید ادا شدہ نشان زد ہے۔",
  "Recording…": "درج ہو رہا ہے…",
  "Saving…": "محفوظ ہو رہا ہے…",
  "Uploading…": "اپ لوڈ ہو رہا ہے…",
  "Close contact form": "رابطہ فارم بند کریں",
  "Close product form": "پروڈکٹ فارم بند کریں",
  "Close shop details": "دکان کی تفصیل بند کریں",
  "Current shop logo": "موجودہ دکان کا لوگو",
  "Include country code, e.g. +92…": "ملکی کوڈ شامل کریں، مثلاً +92…",
  "Shop address": "دکان کا پتہ",
  "Shop": "دکان",
  "Your shop name": "آپ کی دکان کا نام",
  "Unknown error": "نامعلوم خرابی",
  "Could not record this purchase": "یہ خریداری درج نہیں ہو سکی",
  "Could not save the invoice. Check the quantities and try again.": "رسید محفوظ نہیں ہو سکی۔ تعداد چیک کر کے دوبارہ کوشش کریں۔",
  "Choose the app language": "ایپ کی زبان منتخب کریں",
  "Appearance": "ظاہری انداز",
  "Choose light or dark theme": "ہلکا یا گہرا تھیم منتخب کریں",
  "Theme": "تھیم",
  "Light": "ہلکا",
  "Dark": "گہرا",
  "Sales": "فروخت",
  "WhatsApp recipient": "واٹس ایپ وصول کنندہ",
  "Save image & open WhatsApp chat": "تصویر محفوظ کریں اور واٹس ایپ چیٹ کھولیں",
  "Share image to another app": "تصویر کسی دوسری ایپ میں شیئر کریں",
  "Invoice image saved. You can attach it in WhatsApp.": "رسید کی تصویر محفوظ ہو گئی۔ اسے واٹس ایپ میں منسلک کریں۔",
  "Invoice image saved. Attach it in the WhatsApp chat that just opened.": "رسید کی تصویر محفوظ ہو گئی۔ ابھی کھلی واٹس ایپ چیٹ میں اسے منسلک کریں۔",
  "Share on WhatsApp": "واٹس ایپ پر شیئر کریں",
  "Your image is being prepared": "آپ کی تصویر تیار کی جا رہی ہے",
  "Preparing your invoice image for sharing.": "آپ کی رسید کی تصویر شیئر کرنے کے لیے تیار کی جا رہی ہے۔",
  "Saving your invoice image to this device.": "آپ کی رسید کی تصویر اس ڈیوائس پر محفوظ کی جا رہی ہے۔",
  "Success!": "کامیاب!",
  "Your image is ready": "آپ کی تصویر تیار ہے",
  "The invoice image was handed to the app you selected.": "رسید کی تصویر آپ کی منتخب کردہ ایپ کو دے دی گئی ہے۔",
  "Saved!": "محفوظ ہو گئی!",
  "The invoice image is saved on this device.": "رسید کی تصویر اس ڈیوائس پر محفوظ ہو گئی ہے۔",
  "Download started": "ڈاؤن لوڈ شروع ہو گیا",
  "Your browser accepted the download. If it does not appear, open the image below and save it manually.": "آپ کے براؤزر نے ڈاؤن لوڈ قبول کر لیا ہے۔ اگر تصویر نظر نہ آئے تو نیچے اسے کھول کر خود محفوظ کریں۔",
  "Open image to save manually": "تصویر کھول کر محفوظ کریں",
  "Open WhatsApp chat": "واٹس ایپ چیٹ کھولیں",
  "Done": "مکمل",
  "Couldn’t save the image": "تصویر محفوظ نہیں ہو سکی",
  "Try the manual-save option below.": "نیچے دستی طور پر محفوظ کرنے کا اختیار استعمال کریں۔",
  "Choose WhatsApp in the share sheet. The actual PNG will be attached—no invoice text is sent.": "شیئر مینو میں واٹس ایپ منتخب کریں۔ اصل PNG تصویر منسلک ہو گی—رسید کا متن نہیں بھیجا جائے گا۔",
  "Add the customer’s WhatsApp number, including the country code, then try again.": "گاہک کا واٹس ایپ نمبر ملکی کوڈ سمیت شامل کریں، پھر دوبارہ کوشش کریں۔",
  "The PNG is saved first, then the saved customer’s WhatsApp chat opens directly. Attach the clean invoice image from your downloads or gallery; no caption, link or app branding is added.": "پہلے PNG محفوظ ہوتی ہے، پھر محفوظ گاہک کی واٹس ایپ چیٹ براہِ راست کھلتی ہے۔ ڈاؤن لوڈز یا گیلری سے صاف رسید کی تصویر منسلک کریں؛ کوئی کیپشن، لنک یا ایپ برانڈنگ شامل نہیں ہوتی۔",
  "Business": "کاروبار",
  "Business address": "کاروبار کا پتہ",
  "DRAFT": "مسودہ",
  "Stock item": "اسٹاک آئٹم",
  "Reference": "حوالہ",
  "LOGO": "لوگو",
  "Daily invoice sales for the last seven days": "گزشتہ سات دن کی روزانہ رسیدوں کی فروخت",
  "Invoice accent color": "رسید کے رنگ کا انتخاب",
  "Enter a quantity of 1 or more.": "ایک یا اس سے زیادہ تعداد درج کریں۔",
  "The quantity box starts empty so you can type the full number directly.": "تعداد کا خانہ خالی شروع ہوتا ہے تاکہ آپ مکمل عدد براہِ راست لکھ سکیں۔",
  "Not enough stock.": "اسٹاک کافی نہیں۔",
  "Reduce the quantity before generating this invoice.": "رسید بنانے سے پہلے تعداد کم کریں۔",
  "Go back and reduce the quantity so inventory cannot go negative.": "واپس جا کر تعداد کم کریں تاکہ انوینٹری منفی نہ ہو۔",
  "Fixed discount amount": "مقررہ رعایت کی رقم",
  "e.g. Noor Traders": "مثلاً نور ٹریڈرز",
  "e.g. Cooking oil 1L": "مثلاً کوکنگ آئل 1 لیٹر",
  "item, kg, box": "آئٹم، کلو، ڈبہ",
  "e.g. Bill 4821": "مثلاً بل 4821",
  "Archive": "محفوظات میں ڈالیں",
  "Edit": "ترمیم کریں",
  "locked": "مقفل",
  "cost": "لاگت",
  "current stock": "موجودہ اسٹاک",
  "discount": "رعایت",
  "Purchase product": "خریداری کا پروڈکٹ",
  "Purchase quantity": "خریداری کی تعداد",
  "Purchase unit cost": "خریداری کی فی یونٹ لاگت",
  "Remove purchase line": "خریداری کی سطر ہٹائیں",
  "Remove line": "سطر ہٹائیں",
  "Add stock items to preview the purchase.": "خریداری کا پیش نظارہ دیکھنے کے لیے اسٹاک آئٹمز شامل کریں۔",
  "Supplier for product": "پروڈکٹ کا سپلائر",
  "English": "انگریزی",
  "← Back to invoice": "رسید پر واپس جائیں ←",
  "· cost": "· لاگت",
  "· current stock": "· موجودہ اسٹاک",
  "· due": "· واجب الادا",
  "4-digit PIN": "4 ہندسوں کا پن",
  "ACCOUNT DIRECTORY": "اکاؤنٹ ڈائریکٹری",
  "Active shop accounts": "فعال دکان اکاؤنٹس",
  "Add Item": "شے شامل کریں",
  "Add product to catalog": "کیٹلاگ میں پروڈکٹ شامل کریں",
  "Add purchase": "خریداری شامل کریں",
  "Administrator": "ایڈمنسٹریٹر",
  "BILLING RECORDS": "بلنگ ریکارڈز",
  "CASH FLOW": "کیش فلو",
  "Confirm PIN": "پن کی تصدیق کریں",
  "Delivered purchases awaiting payment": "ادائیگی کے منتظر ڈیلیور شدہ خریداریاں",
  "Description": "تفصیل",
  "Don’t have an account?": "اکاؤنٹ نہیں ہے؟",
  "Draft": "مسودہ",
  "Due date": "واجب الادا تاریخ",
  "FEEDBACK": "رائے",
  "Find, review and follow up on every invoice.": "ہر رسید تلاش کریں، جائزہ لیں اور فالو اپ کریں۔",
  "INVOICE DETAILS": "رسید کی تفصیلات",
  "Invoice number": "رسید نمبر",
  "Issued date": "جاری کرنے کی تاریخ",
  "Items sold": "فروخت شدہ اشیاء",
  "LATEST": "تازہ ترین",
  "New invoice": "نئی رسید",
  "Notes / project": "نوٹس / پروجیکٹ",
  "Oversight panel": "نگرانی پینل",
  "Overview": "جائزہ",
  "PINs do not match.": "پن مماثل نہیں ہیں۔",
  "PLATFORM OVERVIEW": "پلیٹ فارم کا جائزہ",
  "Payments collected from paid invoices": "ادا شدہ رسیدوں سے وصول شدہ ادائیگیاں",
  "Phone number": "فون نمبر",
  "Phone number must use the 0300-0000000 format.": "فون نمبر 0300-0000000 فارمیٹ میں ہونا چاہیے۔",
  "Preview invoice": "رسید کا پیش نظارہ",
  "Price": "قیمت",
  "Received": "موصول شدہ",
  "Recent Activity": "حالیہ سرگرمی",
  "Revenue minus cost": "آمدنی منفی لاگت",
  "Sales total": "کل فروخت",
  "Saved customer records": "محفوظ شدہ گاہک ریکارڈز",
  "Saved supplier records": "محفوظ شدہ سپلائر ریکارڈز",
  "Search bills": "بل تلاش کریں",
  "Secure owner account": "محفوظ مالک اکاؤنٹ",
  "Send Reminder": "یاد دہانی بھیجیں",
  "Signup": "سائن اپ",
  "Total amount": "کل رقم",
  "USER MESSAGES": "صارف پیغامات",
  "Unpaid": "غیر ادا شدہ",
  "Use the local format 0300-0000000.": "مقامی فارمیٹ 0300-0000000 استعمال کریں۔",
  "SENT": "بھیجا گیا",
  "Admin records": "ایڈمن ریکارڈز",
  "Chart time range": "چارٹ کی مدت",
  "Confirm 4-digit PIN": "4 ہندسوں کے پن کی تصدیق کریں",
  "Daybill administrator header": "ڈے بل ایڈمنسٹریٹر ہیڈر",
  "Daybill app sidebar": "ڈے بل ایپ سائڈبار",
  "Daybill business overview": "ڈے بل کاروباری جائزہ",
  "Daybill login": "ڈے بل لاگ ان",
  "No activity yet": "ابھی کوئی سرگرمی نہیں",
  "No matching invoices": "کوئی مماثل رسید نہیں",
  "No matching supplier invoices": "کوئی مماثل سپلائر رسید نہیں",
  "Platform totals": "پلیٹ فارم کل",
  "Project, payment terms, or a short thank-you": "پروجیکٹ، ادائیگی کی شرائط، یا مختصر شکریہ",
  "Received total": "کل موصول شدہ",
  "Search name or invoice number": "نام یا رسید نمبر تلاش کریں",
  "Street, area and city": "گلی، علاقہ اور شہر",
  "e.g. Ali Raza": "مثلاً علی رضا",

};

function translateUiText(value: string) {
  const leading = value.match(/^\s*/)?.[0] ?? "";
  const trailing = value.match(/\s*$/)?.[0] ?? "";
  const core = value.trim();
  if (!core) return value;
  const direct = urduUi[core];
  if (direct) return `${leading}${direct}${trailing}`;
  const replacements: Array<[RegExp, (match: RegExpMatchArray) => string]> = [
    [/^Payment due (.+)$/, (m) => `ادائیگی کی آخری تاریخ ${m[1] ?? ""}`],
    [/^Due (.+)$/, (m) => `واجب الادا ${m[1] ?? ""}`],
    [/^Issued (.+)$/, (m) => `جاری شدہ ${m[1] ?? ""}`],
    [/^Product (\d+)$/, (m) => `پروڈکٹ ${m[1] ?? ""}`],
    [/^(.+) in stock$/, (m) => `${m[1] ?? ""} اسٹاک میں`],
    [/^Supplier: (.+)$/, (m) => `سپلائر: ${m[1] ?? ""}`],
    [/^(.+) · due (.+)$/, (m) => `${m[1] ?? ""} · واجب الادا ${m[2] ?? ""}`],
    [/^(\d+) sales · (.+)$/, (m) => `${m[1] ?? ""} فروخت · ${m[2] ?? ""}`],
    [/^(\d+) purchases · (.+)$/, (m) => `${m[1] ?? ""} خریداریاں · ${m[2] ?? ""}`],
    [/^Save invoice · (.+)$/, (m) => `رسید محفوظ کریں · ${m[1] ?? ""}`],
    [/^Review invoice · (.+)$/, (m) => `رسید کا جائزہ · ${m[1] ?? ""}`],
    [/^Review purchase · (.+)$/, (m) => `خریداری کا جائزہ · ${m[1] ?? ""}`],
    [/^Record purchase · (.+)$/, (m) => `خریداری درج کریں · ${m[1] ?? ""}`],
    [/^Discount \((.+)\)$/, (m) => `رعایت (${m[1] ?? ""})`],
    [/^(\d+) item$/, (m) => `${m[1] ?? ""} شے`],
    [/^(\d+) items$/, (m) => `${m[1] ?? ""} اشیاء`],
    [/^Discount amount \((.+)\)$/, (m) => `رعایت کی رقم (${m[1] ?? ""})`],
    [/^Selling price \((.+)\)$/, (m) => `فروخت کی قیمت (${m[1] ?? ""})`],
    [/^Cost price \((.+)\)$/, (m) => `لاگت کی قیمت (${m[1] ?? ""})`],
    [/^Product for line (\d+)$/, (m) => `سطر ${m[1] ?? ""} کے لیے پروڈکٹ`],
    [/^Quantity for line (\d+)$/, (m) => `سطر ${m[1] ?? ""} کی تعداد`],
    [/^Remove line (\d+)$/, (m) => `سطر ${m[1] ?? ""} ہٹائیں`],
    [/^Purchase product for line (\d+)$/, (m) => `خریداری کی سطر ${m[1] ?? ""} کے لیے پروڈکٹ`],
    [/^Purchase quantity for line (\d+)$/, (m) => `خریداری کی سطر ${m[1] ?? ""} کی تعداد`],
    [/^Purchase unit cost for line (\d+)$/, (m) => `خریداری کی سطر ${m[1] ?? ""} کی فی یونٹ لاگت`],
    [/^Remove purchase line (\d+)$/, (m) => `خریداری کی سطر ${m[1] ?? ""} ہٹائیں`],
    [/^Edit (.+)$/, (m) => `${m[1] ?? ""} میں ترمیم کریں`],
    [/^Archive (.+)$/, (m) => `${m[1] ?? ""} محفوظات میں ڈالیں`],
    [/^(.+) · current stock (\d+)$/, (m) => `${m[1] ?? ""} · موجودہ اسٹاک ${m[2] ?? ""}`],
    [/^(.+) · cost (.+)$/, (m) => `${m[1] ?? ""} · لاگت ${m[2] ?? ""}`],
    [/^(.+) · discount (.+)$/, (m) => `${m[1] ?? ""} · رعایت ${m[2] ?? ""}`],
    [/^(\d+)\. (.+) \(locked\)$/, (m) => `${m[1] ?? ""}۔ ${translateUiText(m[2] ?? "")} (مقفل)`],
    [/^(\d+)\. (.+)$/, (m) => `${m[1] ?? ""}۔ ${translateUiText(m[2] ?? "")}`],
  ];
  for (const [pattern, format] of replacements) {
    const match = core.match(pattern);
    if (match) return `${leading}${format(match)}${trailing}`;
  }
  return value;
}

function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => localStorage.getItem("invoice-language") === "ur" ? "ur" : "en");
  const textMemoryRef = useRef(new WeakMap<Text, { english: string; last: string }>());
  const attrMemoryRef = useRef(new WeakMap<Element, Map<string, { english: string; last: string }>>());
  useEffect(() => {
    localStorage.setItem("invoice-language", language);
    document.documentElement.lang = language;
    document.documentElement.dir = language === "ur" ? "rtl" : "ltr";
    const root = document.querySelector<HTMLElement>("[data-generated-space-root]");
    if (!root) return;
    root.dir = language === "ur" ? "rtl" : "ltr";
    const textMemory = textMemoryRef.current;
    const attrMemory = attrMemoryRef.current;
    const processText = (node: Text) => {
      let record = textMemory.get(node);
      if (!record || node.data !== record.last) record = { english: node.data, last: node.data };
      const next = language === "ur" ? translateUiText(record.english) : record.english;
      record.last = next;
      textMemory.set(node, record);
      if (node.data !== next) node.data = next;
    };
    const processElement = (element: Element) => {
      const attrs = attrMemory.get(element) ?? new Map<string, { english: string; last: string }>();
      for (const name of ["aria-label", "placeholder", "title"]) {
        const value = element.getAttribute(name);
        if (value === null) continue;
        let record = attrs.get(name);
        if (!record || value !== record.last) record = { english: value, last: value };
        const next = language === "ur" ? translateUiText(record.english) : record.english;
        record.last = next;
        attrs.set(name, record);
        if (value !== next) element.setAttribute(name, next);
      }
      attrMemory.set(element, attrs);
    };
    const processNode = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) processText(node as Text);
      if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as Element;
        processElement(element);
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
        let child = walker.nextNode();
        while (child) {
          if (child.nodeType === Node.TEXT_NODE) processText(child as Text);
          else processElement(child as Element);
          child = walker.nextNode();
        }
      }
    };
    processNode(root);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData") processNode(mutation.target);
        else mutation.addedNodes.forEach(processNode);
        if (mutation.type === "attributes") processElement(mutation.target as Element);
      }
    });
    observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["aria-label", "placeholder", "title"] });
    return () => observer.disconnect();
  }, [language]);
  return <LanguageContext.Provider value={{ language, setLanguage }}>{children}</LanguageContext.Provider>;
}

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // Storage can be unavailable in strict embedded browser modes.
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // The selected theme still applies for the current session.
    }
  }, [theme]);
  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

function useLanguage() {
  return useContext(LanguageContext);
}

function useTheme() {
  return useContext(ThemeContext);
}

function ui(language: Language, value: string) {
  return language === "ur" ? translateUiText(value).trim() : value;
}

function paymentMethodLabel(language: Language, method: Invoice["payment_method"] | DraftInvoice["payment_method"]) {
  const english = `${method[0]?.toUpperCase() ?? ""}${method.slice(1)}`;
  return ui(language, english);
}

function formatLocalPhoneInput(value: string) {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("92")) digits = `0${digits.slice(2)}`;
  digits = digits.slice(0, 11);
  return digits.length > 4 ? `${digits.slice(0, 4)}-${digits.slice(4)}` : digits;
}

function formatPhoneDisplay(value: string) {
  const digits = value.replace(/\D/g, "");
  if (/^923\d{9}$/.test(digits)) return `0${digits.slice(2, 5)}-${digits.slice(5)}`;
  if (/^03\d{9}$/.test(digits)) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return value;
}

function whatsappDigits(phone: string) {
  const digits = phone.replace(/\D/g, "").replace(/^00/, "");
  return /^03\d{9}$/.test(digits) ? `92${digits.slice(1)}` : digits;
}

function openWhatsAppReminder(invoice: Pick<Workspace["invoices"][number], "customer_phone" | "customer_name" | "invoice_number" | "total" | "currency" | "due_date">, businessName: string, language: Language) {
  const phone = whatsappDigits(invoice.customer_phone);
  if (!phone || !invoice.due_date) return false;
  const amount = money(invoice.total, invoice.currency);
  const message = language === "ur"
    ? `السلام علیکم ${invoice.customer_name}، ${businessName || "ہماری دکان"} کی طرف سے یاد دہانی ہے کہ رسید ${invoice.invoice_number} کی ${amount} رقم ${invoice.due_date} کو واجب الادا تھی۔ براہِ کرم ادائیگی کر دیں۔ شکریہ۔`
    : `Hello ${invoice.customer_name}, this is a polite reminder from ${businessName || "our shop"} that invoice ${invoice.invoice_number} for ${amount} was due on ${invoice.due_date}. Please arrange payment. Thank you.`;
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
  return true;
}

function Icon({ name }: { name: "dashboard" | "plus" | "box" | "people" | "invoice" | "history" | "settings" | "trash" | "pencil" | "whatsapp" | "arrow" | "copy" | "profile" | "truck" | "lock" | "bell" | "revenue" | "cost" | "profit" | "wallet" | "collapse" | "expand" | "eye" | "eye-off" }) {
  const paths: Record<typeof name, React.ReactNode> = {
    dashboard: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="4" rx="1" /><rect x="14" y="11" width="7" height="10" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    box: <><path d="m4 7 8-4 8 4-8 4-8-4Z" /><path d="M4 7v10l8 4 8-4V7M12 11v10" /></>,
    people: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    invoice: <><path d="M6 2h9l4 4v16H6z" /><path d="M14 2v5h5M9 12h7M9 16h7" /></>,
    history: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.6 19a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.6-1H3v-4h.1A1.7 1.7 0 0 0 5 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3h4a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.6 1h.1v4H21a1.7 1.7 0 0 0-1.6 1Z" /></>,
    trash: <><path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6M10 11v6M14 11v6" /></>,
    pencil: <><path d="m4 16-1 5 5-1L19 9l-4-4L4 16Z" /><path d="m13 7 4 4" /></>,
    whatsapp: <><path d="M20.5 11.5a8.5 8.5 0 0 1-12.6 7.45L3 20l1.08-4.73A8.5 8.5 0 1 1 20.5 11.5Z" /><path d="M8.2 7.8c.4 3.8 2.2 5.6 6 6l1-1.5-2.1-1-1 1c-1.3-.6-2.3-1.6-2.9-2.9l1-1-1-2.1-1.5 1Z" /></>,
    arrow: <><path d="M5 12h14" /><path d="m14 7 5 5-5 5" /></>,
    copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
    profile: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
    truck: <><path d="M3 6h11v10H3zM14 9h4l3 3v4h-7z" /><circle cx="7" cy="18" r="2" /><circle cx="18" cy="18" r="2" /></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>,
    revenue: <><path d="M4 19V9M10 19V5M16 19v-7M22 19V3" /><path d="m3 7 6-4 6 5 7-6" /></>,
    cost: <><circle cx="12" cy="12" r="9" /><path d="M15 8.5c-.7-.7-1.6-1-2.7-1-1.5 0-2.6.8-2.6 2s1 1.8 2.8 2.3c1.8.5 2.8 1.1 2.8 2.5s-1.2 2.2-2.8 2.2c-1.2 0-2.3-.4-3.1-1.2M12.5 5.5v13" /></>,
    profit: <><path d="M4 18 9 13l3 3 8-10" /><path d="M15 6h5v5" /></>,
    wallet: <><path d="M4 6h14a2 2 0 0 1 2 2v10H4a2 2 0 0 1-2-2V6a3 3 0 0 1 3-3h12" /><path d="M16 11h6v4h-6a2 2 0 0 1 0-4Z" /></>,
    collapse: <><path d="m15 18-6-6 6-6" /><path d="M21 12H9" /></>,
    expand: <><path d="m9 18 6-6-6-6" /><path d="M3 12h12" /></>,
    help: <><circle cx="12" cy="12" r="9" /><path d="M9.2 9a3 3 0 0 1 5.8 1c0 2-3 2.6-3 4" /><circle cx="12" cy="17.5" r=".5" fill="currentColor" /></>,
    logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5M21 12H9" /></>,
    moon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
    eye: <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></>,
    "eye-off": <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

type ContactAvatarProps = {
  name: string;
  kind?: "customer" | "supplier";
  contactKey?: string;
  className?: string;
};

const CONTACT_AVATARS = [avatar1, avatar2, avatar3, avatar4, avatar5, avatar6, avatar7, avatar8, avatar9, avatar10, avatar11, avatar12] as const;
const SHOP_AVATARS = CONTACT_AVATARS;

function buildPaymentQrContent(settings: { bank_name?: string; bank_account_title?: string; bank_account_number?: string; bank_iban?: string }): string | null {
  const iban = (settings.bank_iban || "").trim();
  const acct = (settings.bank_account_number || "").trim();
  if (!iban && !acct) return null;
  const lines = [];
  if (settings.bank_name?.trim()) lines.push(settings.bank_name.trim());
  if (settings.bank_account_title?.trim()) lines.push(settings.bank_account_title.trim());
  if (acct) lines.push("Account: " + acct);
  if (iban) lines.push("IBAN: " + iban);
  return lines.join("\n");
}

function ContactAvatar({ name, kind = "customer", contactKey = "", className = "" }: ContactAvatarProps) {
  const seedText = `${kind}:${contactKey || name.trim().toLowerCase()}`;
  const seed = [...seedText].reduce((total, character, index) => (total * 33 + character.charCodeAt(0) + index) >>> 0, 5381);
  const avatar = CONTACT_AVATARS[seed % CONTACT_AVATARS.length] ?? avatar1;
  return <span className={`human-avatar ${className}`.trim()} role="img" aria-label={`${name} profile avatar`}><img src={avatar} alt="" /></span>;
}

type ContactAvatarSelectProps = {
  label: string;
  ariaLabel: string;
  placeholder: string;
  contacts: Contact[];
  selectedId: number | null;
  onChange: (id: number) => void;
};

function ContactAvatarSelect({ label, ariaLabel, placeholder, contacts, selectedId, onChange }: ContactAvatarSelectProps) {
  const selected = contacts.find((contact) => contact.id === selectedId) ?? null;
  return <div className="field avatar-select-field"><span>{label}</span><details className="avatar-contact-select"><summary aria-label={ariaLabel}>{selected ? <ContactAvatar name={selected.name} kind={selected.kind} contactKey={String(selected.id)} className="select-avatar" /> : <span className="select-avatar-empty"><Icon name="people" /></span>}<span className={`avatar-select-value ${selected ? "" : "placeholder"}`.trim()}><strong>{selected?.name ?? placeholder}</strong>{selected?.phone ? <small>{formatPhoneDisplay(selected.phone)}</small> : null}</span><span className="select-chevron" aria-hidden="true">⌄</span></summary><div className="avatar-select-options" role="listbox" aria-label={ariaLabel}>{contacts.map((contact) => <button type="button" role="option" aria-selected={contact.id === selectedId} key={contact.id} onClick={(event) => { onChange(contact.id); event.currentTarget.closest("details")?.removeAttribute("open"); }}><ContactAvatar name={contact.name} kind={contact.kind} contactKey={String(contact.id)} className="select-avatar" /><span><strong>{contact.name}</strong><small>{contact.phone ? formatPhoneDisplay(contact.phone) : (contact.kind === "supplier" ? "Supplier" : "Customer")}</small></span>{contact.id === selectedId ? <b aria-hidden="true">✓</b> : null}</button>)}</div></details></div>;
}

function localDate() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function money(minor: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(minor / 100);
}

function safeInvoiceFilename(invoiceNumber: string) {
  const base = invoiceNumber.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "invoice";
  return `${base}.png`;
}

const PNG_PIPELINE_TIMEOUT_MS = 8_000;
const PNG_RESOURCE_TIMEOUT_MS = 2_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

async function loadCanvasImage(src: string) {
  return withTimeout(new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load the shop logo"));
    image.src = src;
  }), PNG_RESOURCE_TIMEOUT_MS, "The shop logo took too long to load");
}

async function waitForInvoiceFonts(fonts: string[], sample: string) {
  if (!("fonts" in document)) return;
  await Promise.all(fonts.map(async (font) => {
    try {
      await withTimeout(document.fonts.load(font, sample), PNG_RESOURCE_TIMEOUT_MS, "The invoice font took too long to load");
    } catch {
      // Canvas rendering can safely continue with its fallback font.
    }
  }));
}

function canvasToPngBlob(canvas: HTMLCanvasElement) {
  return withTimeout(new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not create the invoice image")), "image/png");
  }), PNG_RESOURCE_TIMEOUT_MS, "The browser took too long to finish the invoice image");
}

function wrapCanvasText(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (current && context.measureText(next).width > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function drawPaymentQr(context: CanvasRenderingContext2D, x: number, y: number, size: number, content: string) {
  try {
    const qr = QRCode.create(content, { errorCorrectionLevel: "M" });
    const count = qr.modules.size;
    const cell = size / count;
    context.fillStyle = "#ffffff";
    context.fillRect(x, y, size, size);
    context.fillStyle = "#0d3b42";
    for (let row = 0; row < count; row += 1) {
      for (let col = 0; col < count; col += 1) {
        if (qr.modules.get(row, col)) context.fillRect(x + col * cell, y + row * cell, Math.ceil(cell), Math.ceil(cell));
      }
    }
    context.strokeStyle = "#d7d4cb";
    context.strokeRect(x - 8, y - 8, size + 16, size + 16);
  } catch { /* leave blank on failure */ }
}

async function renderInvoicePng(invoice: Invoice | DraftInvoice, settings: Workspace["settings"], language: Language) {
  const isUrdu = language === "ur";
  const width = 1200;
  const itemHeight = 84;
  const noteHeight = invoice.notes ? 150 : 0;
  const height = Math.max(1400, 790 + invoice.items.length * itemHeight + noteHeight);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image creation is not supported in this browser");

  if (isUrdu) {
    await waitForInvoiceFonts(['32px "Urdu Invoice"', '700 32px "Urdu Invoice"'], "رسید ادائیگی کاروبار");
  }

  const fontFamily = isUrdu ? '"Urdu Invoice", "Noto Naskh Arabic", serif' : "system-ui, sans-serif";
  const setText = (size: number, weight: 400 | 700, color: string, align: CanvasTextAlign = "left") => {
    context.font = `${weight} ${size}px ${fontFamily}`;
    context.fillStyle = color;
    context.textAlign = align;
    context.direction = isUrdu ? "rtl" : "ltr";
  };
  const label = (value: string) => ui(language, value);

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.fillStyle = settings.accent_color;
  context.fillRect(isUrdu ? width - 18 : 0, 0, 18, height);
  context.textBaseline = "top";

  let businessX = isUrdu ? 1118 : 82;
  if (settings.logo_url) {
    try {
      const logo = await loadCanvasImage(settings.logo_url);
      const maxSide = 120;
      const scale = Math.min(maxSide / logo.width, maxSide / logo.height, 1);
      const logoWidth = logo.width * scale;
      const logoHeight = logo.height * scale;
      const logoX = isUrdu ? 1118 - logoWidth : 82;
      context.drawImage(logo, logoX, 70, logoWidth, logoHeight);
      businessX = isUrdu ? logoX - 34 : 82 + logoWidth + 34;
    } catch {
      // The invoice is still useful without an optional logo.
    }
  }

  setText(54, 700, "#17202a", isUrdu ? "right" : "left");
  context.fillText(settings.business_name || label("Business"), businessX, 72);
  setText(28, 400, "#59636e", isUrdu ? "right" : "left");
  if (settings.address) context.fillText(settings.address, businessX, 142);
  if (settings.phone) context.fillText(formatPhoneDisplay(settings.phone), businessX, 184);

  const invoiceMetaX = isUrdu ? 82 : 1118;
  const invoiceMetaAlign: CanvasTextAlign = isUrdu ? "left" : "right";
  setText(28, 700, settings.accent_color, invoiceMetaAlign);
  context.fillText(label("INVOICE"), invoiceMetaX, 74);
  setText(38, 700, "#17202a", invoiceMetaAlign);
  context.fillText(invoice.invoice_number === "DRAFT" ? label("DRAFT") : invoice.invoice_number, invoiceMetaX, 118);
  setText(26, 400, "#59636e", invoiceMetaAlign);
  context.fillText(`${label("Issued")} ${invoice.issue_date}`, invoiceMetaX, 174);
  if (invoice.due_date) context.fillText(`${label("Due")} ${invoice.due_date}`, invoiceMetaX, 210);

  context.strokeStyle = "#d7d4cb";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(82, 255);
  context.lineTo(1118, 255);
  context.stroke();

  const customerX = isUrdu ? 1118 : 82;
  const customerAlign: CanvasTextAlign = isUrdu ? "right" : "left";
  setText(22, 700, settings.accent_color, customerAlign);
  context.fillText(label("BILL TO"), customerX, 300);
  setText(36, 700, "#17202a", customerAlign);
  context.fillText(invoice.customer_name || label("Select a customer"), customerX, 338);
  setText(26, 400, "#59636e", customerAlign);
  let customerY = 392;
  for (const detail of [invoice.customer_address, formatPhoneDisplay(invoice.customer_phone)].filter(Boolean)) {
    context.fillText(detail, customerX, customerY);
    customerY += 38;
  }

  const methodX = isUrdu ? 440 : 760;
  const methodAlign: CanvasTextAlign = isUrdu ? "right" : "left";
  setText(20, 700, settings.accent_color, methodAlign);
  context.fillText(label("PAYMENT METHOD"), methodX, 300);
  setText(30, 700, "#17202a", methodAlign);
  context.fillText(paymentMethodLabel(language, invoice.payment_method), methodX, 338);

  let y = Math.max(500, customerY + 40);
  context.fillStyle = "#f1f4f2";
  context.fillRect(82, y, 1036, 62);
  setText(22, 700, "#34404a", isUrdu ? "right" : "left");
  context.fillText(label("ITEM"), isUrdu ? 1094 : 106, y + 18);
  setText(22, 700, "#34404a", "center");
  context.fillText(label("QTY"), isUrdu ? 374 : 826, y + 18);
  setText(22, 700, "#34404a", isUrdu ? "left" : "right");
  context.fillText(label("AMOUNT"), isUrdu ? 106 : 1094, y + 18);
  y += 62;

  for (const item of invoice.items) {
    const itemX = isUrdu ? 1094 : 106;
    const itemAlign: CanvasTextAlign = isUrdu ? "right" : "left";
    setText(27, 700, "#17202a", itemAlign);
    const itemLines = wrapCanvasText(context, item.description, 560).slice(0, 2);
    itemLines.forEach((line, index) => context.fillText(line, itemX, y + 16 + index * 32));
    setText(22, 400, "#59636e", itemAlign);
    context.fillText(`${money(item.unit_price, invoice.currency)} / ${item.unit}`, itemX, y + 50);
    setText(27, 400, "#17202a", "center");
    context.fillText(String(item.quantity), isUrdu ? 374 : 826, y + 28);
    setText(27, 700, "#17202a", isUrdu ? "left" : "right");
    context.fillText(money(item.line_total, invoice.currency), isUrdu ? 106 : 1094, y + 28);
    context.strokeStyle = "#e5e3dc";
    context.beginPath();
    context.moveTo(82, y + itemHeight);
    context.lineTo(1118, y + itemHeight);
    context.stroke();
    y += itemHeight;
  }

  y += 34;
  const qrX = isUrdu ? 970 : 98;
  const qrContent = buildPaymentQrContent(settings);
  if (qrContent) {
    drawPaymentQr(context, qrX, y, 130, qrContent);
    setText(18, 700, "#17202a", "center");
    context.fillText(label("PAY ONLINE"), qrX + 65, y + 154);
    setText(16, 400, "#7a838c", "center");
    context.fillText(label("Scan to pay"), qrX + 65, y + 180);
  }

  const totalsLabelX = isUrdu ? 600 : 760;
  const totalsAmountX = isUrdu ? 82 : 1118;
  const totalsLabelAlign: CanvasTextAlign = isUrdu ? "right" : "left";
  const totalsAmountAlign: CanvasTextAlign = isUrdu ? "left" : "right";
  setText(26, 400, "#59636e", totalsLabelAlign);
  context.fillText(label("Subtotal"), totalsLabelX, y);
  setText(26, 400, "#59636e", totalsAmountAlign);
  context.fillText(money(invoice.subtotal, invoice.currency), totalsAmountX, y);
  if (invoice.discount_amount > 0) {
    const discountLabel = `${label("Discount")}${invoice.discount_type === "percentage" ? ` (${invoice.discount_value / 100}%)` : ""}`;
    setText(26, 400, settings.accent_color, totalsLabelAlign);
    context.fillText(discountLabel, totalsLabelX, y + 44);
    setText(26, 400, settings.accent_color, totalsAmountAlign);
    context.fillText(`−${money(invoice.discount_amount, invoice.currency)}`, totalsAmountX, y + 44);
  }
  const totalY = y + (invoice.discount_amount > 0 ? 102 : 62);
  setText(30, 400, "#17202a", totalsLabelAlign);
  context.fillText(label("Total"), totalsLabelX, totalY);
  setText(42, 700, "#17202a", totalsAmountAlign);
  context.fillText(money(invoice.total, invoice.currency), totalsAmountX, totalY - 8);
  y += 230;

  if (invoice.notes) {
    setText(22, 700, "#34404a", isUrdu ? "right" : "left");
    context.fillText(label("NOTE"), isUrdu ? 1118 : 82, y);
    setText(25, 400, "#59636e", isUrdu ? "right" : "left");
    const noteLines = wrapCanvasText(context, invoice.notes, 1000).slice(0, 4);
    noteLines.forEach((line, index) => context.fillText(line, isUrdu ? 1118 : 82, y + 38 + index * 34));
  }

  setText(24, 400, "#59636e", "center");
  context.fillText(label("Thank you for your business."), width / 2, height - 76);

  return canvasToPngBlob(canvas);
}

type DraftInvoice = {
  invoice_number: string;
  customer_id: number | null;
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  issue_date: string;
  due_date: string | null;
  payment_status: "pending" | "paid";
  payment_method: "card" | "cash" | "transfer" | "credit";
  discount_type: "none" | "percentage" | "fixed";
  discount_value: number;
  discount_amount: number;
  notes: string;
  subtotal: number;
  total: number;
  currency: string;
  items: Array<{ id: number; description: string; unit: string; quantity: number; unit_price: number; line_total: number }>;
};

function PaymentQr({ content, language }: { content: string | null; language: Language }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    if (!content) { setSvg(null); return; }
    let live = true;
    QRCode.toString(content, { type: "svg", margin: 1, width: 132, color: { dark: "#0d3b42", light: "#ffffff" } })
      .then((s) => { if (live) setSvg(s); })
      .catch(() => { if (live) setSvg(null); });
    return () => { live = false; };
  }, [content]);
  if (!content || !svg) return null;
  return <div className="payment-qr-wrap"><div className="payment-qr real" dangerouslySetInnerHTML={{ __html: svg }} /><span>{ui(language, "PAY ONLINE")}</span><small>{ui(language, "Scan to pay")}</small></div>;
}

function InvoicePaper({ invoice, settings }: { invoice: Invoice | DraftInvoice; settings: Workspace["settings"] }) {
  const { language } = useLanguage();
  const label = (value: string) => ui(language, value);
  return (
    <article className={`invoice-paper${language === "ur" ? " invoice-paper-urdu" : ""}`} dir={language === "ur" ? "rtl" : "ltr"} lang={language} style={{ "--invoice-accent": settings.accent_color } as React.CSSProperties} aria-label={label("Live invoice preview")}>
      <div className="paper-accent" />
      <header className="paper-head">
        <div>
          {settings.logo_url ? <img className="shop-logo" src={settings.logo_url} alt={`${settings.business_name || label("Business")} logo`} /> : null}
          <h2>{settings.business_name || label("Your shop name")}</h2>
          {settings.address ? <p>{settings.address}</p> : <p className="placeholder-copy">{label("Business address")}</p>}
          {settings.phone ? <p>{formatPhoneDisplay(settings.phone)}</p> : null}
        </div>
        <div className="invoice-id">
          <span>{label("INVOICE")}</span>
          <strong>{invoice.invoice_number === "DRAFT" ? label("DRAFT") : invoice.invoice_number}</strong>
          <time>{label("Issued")} {invoice.issue_date}</time>
          {invoice.due_date ? <time>{label("Due")} {invoice.due_date}</time> : null}
          <span className={`payment-badge ${invoice.payment_status}`}>{label(invoice.payment_status)}</span>
        </div>
      </header>
      <section className="bill-to">
        <div className="bill-to-person"><ContactAvatar name={invoice.customer_name || label("Customer")} kind="customer" contactKey={invoice.customer_id ? String(invoice.customer_id) : invoice.customer_name} className="invoice-contact-avatar" /><div><span>{label("BILL TO")}</span><strong>{invoice.customer_name || label("Select a customer")}</strong>{invoice.customer_address ? <p>{invoice.customer_address}</p> : null}{invoice.customer_phone ? <p>{formatPhoneDisplay(invoice.customer_phone)}</p> : null}</div></div>
        <div className="method-block"><span>{label("PAYMENT METHOD")}</span><strong>{paymentMethodLabel(language, invoice.payment_method)}</strong></div>
      </section>
      <div className="paper-lines">
        <div className="paper-row paper-row-head"><span>{label("Item")}</span><span>{label("Qty")}</span><span>{label("Amount")}</span></div>
        {invoice.items.length ? invoice.items.map((item) => (
          <div className="paper-row" key={item.id}>
            <span><strong>{item.description}</strong><small>{money(item.unit_price, invoice.currency)} / {item.unit}</small></span>
            <span>{item.quantity}</span>
            <span>{money(item.line_total, invoice.currency)}</span>
          </div>
        )) : <p className="empty-lines">{label("Add products to see them here.")}</p>}
      </div>
      <div className="paper-summary">
        <div className="paper-pay"><PaymentQr content={buildPaymentQrContent(settings)} language={language} /></div>
        <div className="paper-totals"><p><span>{label("Subtotal")}</span><b>{money(invoice.subtotal, invoice.currency)}</b></p>{invoice.discount_amount > 0 ? <p className="discount-line"><span>{label("Discount")}{invoice.discount_type === "percentage" ? ` (${invoice.discount_value / 100}%)` : ""}</span><b>−{money(invoice.discount_amount, invoice.currency)}</b></p> : null}<p className="paper-total"><span>{label("Total")}</span><strong>{money(invoice.total, invoice.currency)}</strong></p></div>
      </div>
      {invoice.notes ? <p className="paper-note"><strong>{label("Note")}</strong><br />{invoice.notes}</p> : null}
      <p className="paper-thanks">{label("Thank you for your business.")}</p>
    </article>
  );
}

function Empty({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return <div className="empty"><div className="empty-mark">＋</div><h3>{title}</h3><p>{body}</p>{action}</div>;
}

type TransferSheetState = {
  kind: "share" | "download";
  phase: "working" | "success" | "download-started" | "error";
  title: string;
  body: string;
  canOpenWhatsApp?: boolean;
};

type FileSavePicker = (options: {
  suggestedName: string;
  types: Array<{ description: string; accept: Record<string, string[]> }>;
}) => Promise<{ createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }> }>;

async function saveFileWithPicker(file: File): Promise<boolean> {
  const picker = (window as Window & { showSaveFilePicker?: FileSavePicker }).showSaveFilePicker;
  if (!picker) return false;
  const handle = await picker.call(window, {
    suggestedName: file.name,
    types: [{ description: "PNG image", accept: { "image/png": [".png"] } }],
  });
  const writable = await handle.createWritable();
  await writable.write(file);
  await writable.close();
  return true;
}

function triggerBrowserDownload(file: File) {
  const objectUrl = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = file.name;
  link.rel = "noopener";
  link.style.position = "fixed";
  link.style.left = "-9999px";
  document.body.appendChild(link);
  link.click();
  window.setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(objectUrl);
  }, 60_000);
}

function openFileForManualSave(file: File) {
  const objectUrl = URL.createObjectURL(file);
  const opened = window.open(objectUrl, "_blank");
  if (opened) opened.opener = null;
  if (!opened) {
    const link = document.createElement("a");
    link.href = objectUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 5 * 60_000);
}

function TransferStatusSheet({ state, language, onDismiss, onManualSave, onOpenWhatsApp }: { state: TransferSheetState; language: Language; onDismiss: () => void; onManualSave: () => void; onOpenWhatsApp: () => void }) {
  const isWorking = state.phase === "working";
  const isError = state.phase === "error";
  useEffect(() => {
    if (state.phase !== "success") return;
    const timeout = window.setTimeout(onDismiss, 3_600);
    return () => window.clearTimeout(timeout);
  }, [state.phase, onDismiss]);
  return <div className="transfer-sheet-backdrop" role="presentation" onMouseDown={(event) => { if (!isWorking && event.target === event.currentTarget) onDismiss(); }}>
    <section className="transfer-sheet" role="dialog" aria-modal="true" aria-live="polite" aria-label={ui(language, state.title)}>
      <div className="transfer-sheet-handle" />
      <div className={`transfer-status-mark ${isWorking ? "working" : isError ? "error" : "success"}`} aria-hidden="true">
        {isWorking ? <><span className="transfer-document"><i /></span><span className="transfer-spinner" /></> : isError ? <span className="transfer-symbol">!</span> : <span className="transfer-symbol">✓</span>}
      </div>
      <h2>{ui(language, state.title)}</h2>
      <p>{ui(language, state.body)}</p>
      {!isWorking ? <div className="transfer-sheet-actions">
        {state.canOpenWhatsApp ? <button type="button" className="primary transfer-whatsapp" onClick={onOpenWhatsApp}><Icon name="whatsapp" />{ui(language, "Open WhatsApp chat")}<Icon name="arrow" /></button> : null}
        {(state.phase === "download-started" || (isError && state.kind === "download")) ? <button type="button" className="secondary wide" onClick={onManualSave}>{ui(language, "Open image to save manually")}</button> : null}
        <button type="button" className="transfer-dismiss" onClick={onDismiss}>{ui(language, "Done")}</button>
      </div> : null}
    </section>
  </div>;
}

function SessionExpiredNotice({ onLogout }: { onLogout: () => void }) {
  useEffect(() => { onLogout(); }, [onLogout]);
  return <div className="loading"><div className="loader" /><p>Session expired — taking you to login…</p></div>;
}

function ProductCatalogPicker({ products, currency, selectedId, onSelect, language }: { products: Product[]; currency: string; selectedId: number | null; onSelect: (id: number | null) => void; language: Language }) {
  return <div className="catalog-strip" role="listbox" aria-label={ui(language, "Choose product")}>
    {products.map((product) => <button type="button" key={product.id} role="option" aria-selected={product.id === selectedId} disabled={product.stock_quantity <= 0} className={"catalog-card" + (product.id === selectedId ? " selected" : "")} onClick={() => onSelect(product.id === selectedId ? null : product.id)}>
      {product.image_url ? <img src={product.image_url} alt="" /> : <span className="catalog-thumb empty"><Icon name="box" /></span>}
      <strong>{product.name}</strong><small>{money(product.unit_price, currency)}</small><em>{product.stock_quantity} {ui(language, "in stock")}</em>
      {product.id === selectedId ? <span className="catalog-check">✓</span> : null}
    </button>)}
  </div>;
}

function InvoiceApp({ onLogout }: { onLogout: () => void }) {
  const queryClient = useQueryClient();
  const { language } = useLanguage();
  const { theme, setTheme } = useTheme();
  const workspace = useQuery({ queryKey: ["workspace"], queryFn: () => api.getWorkspace({}) });
  const restoreBillsOnMount = useRef(isMobileAppLayout() && sessionStorage.getItem(MOBILE_BILLS_RETURN_KEY) === "1");
  const [tab, setTab] = useState<Tab>(restoreBillsOnMount.current ? "history" : "dashboard");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [createKind, setCreateKind] = useState<"sale" | "purchase">("sale");
  const [savedPurchaseId, setSavedPurchaseId] = useState<number | null>(null);
  const [step, setStep] = useState(1);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelpFeedback, setShowHelpFeedback] = useState(false);
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [issueDate, setIssueDate] = useState(localDate());
  const [dueDate, setDueDate] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"card" | "cash" | "transfer" | "credit">("cash");
  const [discountType, setDiscountType] = useState<"none" | "percentage" | "fixed">("none");
  const [discountInput, setDiscountInput] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([{ key: 1, productId: null, quantity: "" }]);
  const [lineKey, setLineKey] = useState(2);
  const [savedInvoiceId, setSavedInvoiceId] = useState<number | null>(null);
  const [showInvoiceDelete, setShowInvoiceDelete] = useState(false);
  const [showPurchaseDelete, setShowPurchaseDelete] = useState(false);
  const [selectedContactId, setSelectedContactId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [isPreparingImage, setIsPreparingImage] = useState(false);
  const [preparedInvoiceFile, setPreparedInvoiceFile] = useState<File | null>(null);
  const [transferSheet, setTransferSheet] = useState<TransferSheetState | null>(null);
  const setupAutoOpened = useRef(false);
  const mobileDetailHistoryPushed = useRef(false);

  const showBills = () => {
    sessionStorage.removeItem(MOBILE_BILLS_RETURN_KEY);
    mobileDetailHistoryPushed.current = false;
    setTransferSheet(null);
    setSelectedContactId(null);
    setSavedInvoiceId(null);
    setSavedPurchaseId(null);
    setCreateKind("sale");
    setMessage("");
    setTab("history");
  };

  const armMobileBillsReturn = () => {
    if (!isMobileAppLayout()) return;
    sessionStorage.setItem(MOBILE_BILLS_RETURN_KEY, "1");
    if (mobileDetailHistoryPushed.current) return;
    window.history.pushState({ ...(window.history.state as Record<string, unknown> | null), [MOBILE_DETAIL_HISTORY_KEY]: true }, "", window.location.href);
    mobileDetailHistoryPushed.current = true;
  };

  const backToBills = () => {
    if (isMobileAppLayout() && mobileDetailHistoryPushed.current && Boolean((window.history.state as Record<string, unknown> | null)?.[MOBILE_DETAIL_HISTORY_KEY])) {
      window.history.back();
      return;
    }
    showBills();
  };

  useEffect(() => {
    if (restoreBillsOnMount.current) sessionStorage.removeItem(MOBILE_BILLS_RETURN_KEY);
    const onPopState = () => {
      if (!mobileDetailHistoryPushed.current) return;
      showBills();
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (workspace.data && !workspace.data.settings.business_name && !setupAutoOpened.current) {
      setupAutoOpened.current = true;
      setShowSettings(true);
    }
  }, [workspace.data]);

  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(() => setMessage(""), 3_600);
    return () => window.clearTimeout(timeout);
  }, [message]);

  const products = workspace.data?.products ?? [];
  const contacts = workspace.data?.contacts ?? [];
  const customers = contacts.filter((contact) => contact.kind === "customer");
  const settings = workspace.data?.settings ?? { business_name: "", phone: "", address: "", currency: "PKR", accent_color: "#17765A", logo_url: null };
  const customer = customers.find((item) => item.id === customerId);
  const requestedByProduct = new Map<number, number>();
  for (const line of lines) {
    if (line.productId === null) continue;
    const quantity = Number(line.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) continue;
    requestedByProduct.set(line.productId, (requestedByProduct.get(line.productId) ?? 0) + quantity);
  }
  const inventoryIssues = products.flatMap((product) => {
    const requested = requestedByProduct.get(product.id) ?? 0;
    return requested > product.stock_quantity
      ? [`${product.name}: only ${product.stock_quantity} ${product.unit} in stock, but ${requested} requested.`]
      : [];
  });
  const hasInvalidQuantity = lines.some((line) => !Number.isInteger(Number(line.quantity)) || Number(line.quantity) < 1);
  const draftItems = lines.flatMap((line, index) => {
    const product = products.find((item) => item.id === line.productId);
    const quantity = Number(line.quantity);
    return product && Number.isInteger(quantity) && quantity > 0 ? [{ id: index + 1, description: product.name, unit: product.unit, quantity, unit_price: product.unit_price, line_total: product.unit_price * quantity }] : [];
  });
  const draftSubtotal = draftItems.reduce((sum, item) => sum + item.line_total, 0);
  const normalizedDiscountValue = discountType === "percentage" ? Math.round(Math.min(100, Math.max(0, Number(discountInput) || 0)) * 100) : discountType === "fixed" ? Math.round(Math.max(0, Number(discountInput) || 0) * 100) : 0;
  const draftDiscountAmount = Math.min(draftSubtotal, discountType === "percentage" ? Math.round(draftSubtotal * normalizedDiscountValue / 10_000) : normalizedDiscountValue);
  const draftTotal = draftSubtotal - draftDiscountAmount;
  const draft: DraftInvoice = {
    invoice_number: "DRAFT",
    customer_id: customer?.id ?? null,
    customer_name: customer?.name ?? "",
    customer_phone: customer?.phone ?? "",
    customer_address: customer?.address ?? "",
    issue_date: issueDate,
    due_date: dueDate || null,
    payment_status: "pending",
    payment_method: paymentMethod,
    discount_type: discountType,
    discount_value: normalizedDiscountValue,
    discount_amount: draftDiscountAmount,
    notes,
    subtotal: draftSubtotal,
    total: draftTotal,
    currency: settings.currency,
    items: draftItems,
  };

  const savedInvoice = useQuery({
    queryKey: ["invoice", savedInvoiceId],
    queryFn: () => api.getInvoice({ id: savedInvoiceId ?? 0 }),
    enabled: savedInvoiceId !== null,
  });

  const paymentStatus = useMutation({
    mutationFn: (status: "pending" | "paid") => api.setInvoicePaymentStatus({ id: savedInvoiceId ?? 0, status }),
    onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ["workspace"] }), queryClient.invalidateQueries({ queryKey: ["invoice", savedInvoiceId] })]); },
  });

  const createInvoice = useMutation({
    mutationFn: () => api.createInvoice({
      customer_id: customerId ?? 0,
      issue_date: issueDate,
      due_date: dueDate || null,
      payment_method: paymentMethod,
      discount_type: discountType,
      discount_value: normalizedDiscountValue,
      notes,
      items: lines.filter((line): line is Line & { productId: number } => line.productId !== null).map((line) => ({ product_id: line.productId, quantity: Number(line.quantity) })),
    }),
    onSuccess: async (result) => {
      setSavedInvoiceId(result.id);
      setStep(3);
      armMobileBillsReturn();
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
    },
  });

  const canReviewInvoice = Boolean(
    customerId
    && draftItems.length
    && lines.every((line) => line.productId !== null)
    && !hasInvalidQuantity
    && inventoryIssues.length === 0,
  );
  const canCreate = Boolean(settings.business_name && canReviewInvoice);
  const displayInvoice = savedInvoice.data?.invoice ?? draft;
  const reminderInvoice = savedInvoice.data?.invoice;

  useEffect(() => {
    setPreparedInvoiceFile(null);
    setTransferSheet(null);
    setIsPreparingImage(false);
  }, [savedInvoice.data?.invoice, settings, language]);

  const prepareInvoiceFile = async () => {
    const invoice = savedInvoice.data?.invoice;
    if (!invoice) throw new Error("The saved invoice is not available yet.");
    if (preparedInvoiceFile) return preparedInvoiceFile;
    const blob = await withTimeout(
      renderInvoicePng(invoice, settings, language),
      PNG_PIPELINE_TIMEOUT_MS,
      "The invoice image took too long to prepare. Please try again.",
    );
    const file = new File([blob], safeInvoiceFilename(invoice.invoice_number), { type: "image/png" });
    setPreparedInvoiceFile(file);
    return file;
  };

  const openSavedInvoiceChat = () => {
    const invoice = savedInvoice.data?.invoice;
    if (!invoice) return;
    const phone = whatsappDigits(invoice.customer_phone);
    if (!phone) return;
    window.open(`https://wa.me/${phone}`, "_blank", "noopener,noreferrer");
  };

  const openDirectWhatsAppChat = async () => {
    armMobileBillsReturn();
    setMessage("");
    const invoice = savedInvoice.data?.invoice;
    if (!invoice) {
      setMessage("The saved invoice is not available yet.");
      return;
    }
    const phone = whatsappDigits(invoice.customer_phone);
    if (!phone) {
      setMessage("Add the customer’s WhatsApp number, including the country code, then try again.");
      return;
    }

    const whatsappUrl = `https://wa.me/${phone}`;
    const pendingChat = window.open("about:blank", "_blank");
    if (pendingChat) pendingChat.opener = null;
    setIsPreparingImage(true);
    setTransferSheet({ kind: "share", phase: "working", title: "Preparing…", body: "Your invoice image is being prepared for download." });

    try {
      const file = await prepareInvoiceFile();
      triggerBrowserDownload(file);
      setTransferSheet({ kind: "share", phase: "success", title: "Downloaded", body: "The invoice image was downloaded. Opening the customer’s WhatsApp chat…" });
      window.setTimeout(() => {
        setTransferSheet(null);
        if (pendingChat && !pendingChat.closed) {
          pendingChat.location.replace(whatsappUrl);
        } else {
          window.open(whatsappUrl, "_blank", "noopener,noreferrer");
        }
      }, 3_600);
    } catch (error: unknown) {
      if (pendingChat && !pendingChat.closed) pendingChat.close();
      const detail = error instanceof Error ? error.message : "The invoice image could not be created.";
      setTransferSheet({ kind: "share", phase: "error", title: "Couldn’t prepare the image", body: `${detail} The share button is ready to try again.` });
    } finally {
      setIsPreparingImage(false);
    }
  };

  const shareInvoiceImage = async () => {
    armMobileBillsReturn();
    setMessage("");
    setIsPreparingImage(true);
    setTransferSheet({ kind: "share", phase: "working", title: "Preparing…", body: "Your invoice image is being prepared." });
    try {
      const file = await prepareInvoiceFile();
      if (typeof navigator.share !== "function" || (navigator.canShare && !navigator.canShare({ files: [file] }))) {
        triggerBrowserDownload(file);
        setTransferSheet({ kind: "share", phase: "success", title: "Downloaded", body: "The invoice image was downloaded to this device." });
        return;
      }
      await withTimeout(
        navigator.share({ files: [file], title: `Invoice ${displayInvoice.invoice_number}` }),
        PNG_PIPELINE_TIMEOUT_MS,
        "The phone share menu did not respond in time.",
      );
      setTransferSheet({ kind: "share", phase: "success", title: "Shared", body: "The invoice image was handed to the app you selected." });
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setTransferSheet(null);
        return;
      }
      const detail = error instanceof Error ? error.message : "The invoice image could not be shared.";
      setTransferSheet({ kind: "share", phase: "error", title: "Couldn’t share the image", body: `${detail} The share button is ready to try again.` });
    } finally {
      setIsPreparingImage(false);
    }
  };

  const resetDraft = () => {
    setCustomerId(null);
    setIssueDate(localDate());
    setDueDate("");
    setPaymentMethod("cash");
    setDiscountType("none");
    setDiscountInput("");
    setNotes("");
    setLines([{ key: lineKey, productId: null, quantity: "" }]);
    setLineKey((value) => value + 1);
    setSavedInvoiceId(null);
    setStep(1);
    setMessage("");
  };

  if (workspace.isPending) return <div className="loading"><div className="loader" /><p>Opening the ledger…</p></div>;
  if (workspace.error || !workspace.data) {
    const errMsg = String(workspace.error ?? "Unknown error");
    if (/session|expired|unauthori|please log in|log in again/i.test(errMsg)) return <SessionExpiredNotice onLogout={onLogout} />;
    return <div className="fatal"><h2>Couldn’t open your records</h2><p>{errMsg}</p><div style={{display:"flex",gap:10,justifyContent:"center",marginTop:12}}><button onClick={() => workspace.refetch()}>Try again</button><button className="primary" onClick={onLogout}>Back to login</button></div></div>;
  }

  const nav = [
    { id: "dashboard" as const, label: "Home", icon: "dashboard" as const, group: "MENU" },
    { id: "create" as const, label: "Create", icon: "invoice" as const, group: "MENU" },
    { id: "products" as const, label: "Stock", icon: "box" as const, group: "FINANCIAL" },
    { id: "contacts" as const, label: "Contacts", icon: "people" as const, group: "FINANCIAL" },
    { id: "history" as const, label: "Bills", icon: "history" as const, group: "FINANCIAL" },
    { id: "profile" as const, label: "Profile", icon: "profile" as const, group: "TOOLS" },
  ];

  return (
    <div className={`app-shell${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
      <SafeAreaTopScrim backgroundColor="var(--bg)" />
      <header className="app-brand-bar" aria-label="Daybill app sidebar">
        <img className="sidebar-brand-logo" src={daybillLogoWhite} alt="Daybill" />
        <div className="app-brand-copy"><span>Roz ka karobar, ab asaan</span><small>Your daily trade, simplified</small></div>
        <button className="sidebar-toggle" type="button" aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!sidebarCollapsed} onClick={() => setSidebarCollapsed((value) => !value)}><Icon name={sidebarCollapsed ? "expand" : "collapse"} /></button>
      </header>
      <main>
        {selectedContactId !== null ? <ContactHistoryView contact={contacts.find((item) => item.id === selectedContactId) ?? null} invoices={workspace.data.invoices} purchases={workspace.data.purchases} currency={settings.currency} onBack={() => setSelectedContactId(null)} onOpenInvoice={(id) => { armMobileBillsReturn(); setSelectedContactId(null); setCreateKind("sale"); setSavedInvoiceId(id); setTab("create"); setStep(3); }} onOpenPurchase={(id) => { armMobileBillsReturn(); setSelectedContactId(null); setCreateKind("purchase"); setSavedPurchaseId(id); setTab("create"); }} /> : tab === "dashboard" ? <DashboardView workspace={workspace.data} onCreate={() => { setCreateKind("sale"); setTab("create"); }} onCreatePurchase={() => { setCreateKind("purchase"); setSavedPurchaseId(null); setTab("create"); }} onOpenInvoice={(id) => { armMobileBillsReturn(); setCreateKind("sale"); setSavedInvoiceId(id); setTab("create"); setStep(3); }} onOpenPurchase={(id) => { armMobileBillsReturn(); setCreateKind("purchase"); setSavedPurchaseId(id); setTab("create"); }} onOpenContact={setSelectedContactId} onInventory={() => setTab("products")} /> : tab === "create" ? (
          <section className="create-view">
            <div className="create-header reference-create-header">
              <div><p className="eyebrow">{createKind === "sale" ? "SALES INVOICE" : "SUPPLIER INVOICE"}</p><h1>{ui(language, "Create")}</h1><p className="create-subtitle">{createKind === "sale" ? (savedInvoiceId ? "Ready to send" : "Build a customer invoice") : (savedPurchaseId ? "Supplier document ready" : "Record a supplier document")}</p></div>
              <div className="create-head-actions"><div className="draft-number"><span>Invoice number</span><strong>{createKind === "sale" ? (savedInvoiceId ? displayInvoice.invoice_number : "DRAFT") : (savedPurchaseId ? "SAVED" : "DRAFT")}</strong></div><button className="icon-button" aria-label="Edit shop details" onClick={() => setShowSettings(true)}><Icon name="settings" /></button></div>
            </div>
            <div className="transaction-switch" role="group" aria-label="Invoice type"><button className={createKind === "sale" ? "active" : ""} onClick={() => setCreateKind("sale")}><Icon name="invoice" />Sales invoice</button><button className={createKind === "purchase" ? "active" : ""} onClick={() => setCreateKind("purchase")}><Icon name="truck" />Supplier invoice</button></div>
            {createKind === "purchase" ? <PurchaseFlow workspace={workspace.data} savedPurchaseId={savedPurchaseId} onSaved={(id) => { setSavedPurchaseId(id); if (id !== null) armMobileBillsReturn(); }} onAddSupplier={() => setTab("contacts")} onAddProduct={() => setTab("products")} onEditSettings={() => setShowSettings(true)} onOpenContact={setSelectedContactId} onBackToBills={backToBills} onPrepareShare={armMobileBillsReturn} onDeletePurchase={() => setShowPurchaseDelete(true)} /> : !settings.business_name ? (
              <SetupPrompt onOpen={() => setShowSettings(true)} />
            ) : (
              <>
                {!savedInvoiceId ? <div className="stepper" aria-label="Invoice creation steps">
                  {["Customer", "Items", "Preview"].map((label, index) => {
                    const targetStep = index + 1;
                    const locked = (targetStep === 2 && !customerId) || (targetStep === 3 && !canReviewInvoice);
                    return <button key={label} type="button" disabled={locked} aria-label={`${targetStep}. ${label}${locked ? " (locked)" : ""}`} className={step === targetStep ? "active" : step > targetStep ? "done" : ""} onClick={() => setStep(targetStep)}><span>{step > targetStep ? "✓" : targetStep}</span>{label}</button>;
                  })}
                </div> : null}
                <div className="workbench">
                  <div className="editor-panel">
                    {savedInvoiceId ? (
                      <div className="invoice-detail-panel">
                        <button type="button" className="mobile-back-to-bills" onClick={backToBills}>← Back to Bills</button>
                        <header className="invoice-detail-head">
                          <div><span>INVOICE DETAILS</span><h2>{displayInvoice.invoice_number}</h2><p>Billing to {displayInvoice.customer_name}</p></div>
                          <button className={`status-toggle ${displayInvoice.payment_status}`} disabled={paymentStatus.isPending} onClick={() => paymentStatus.mutate(displayInvoice.payment_status === "paid" ? "pending" : "paid")}>{displayInvoice.payment_status === "paid" ? "✓ Paid · mark pending" : "Mark as paid"}</button>
                        </header>
                        <div className="invoice-date-grid"><div><span>Issued date</span><strong>{displayInvoice.issue_date}</strong></div><div><span>Due date</span><strong>{displayInvoice.due_date || "No due date"}</strong></div></div>
                        <button type="button" className="detail-recipient contact-link" onClick={() => displayInvoice.customer_id && setSelectedContactId(displayInvoice.customer_id)} aria-label={`View ${displayInvoice.customer_name} history`}><ContactAvatar name={displayInvoice.customer_name} kind="customer" contactKey={displayInvoice.customer_id ? String(displayInvoice.customer_id) : displayInvoice.customer_name} /><div><small>BILL TO</small><strong>{displayInvoice.customer_name}</strong><p>{displayInvoice.customer_phone ? formatPhoneDisplay(displayInvoice.customer_phone) : "No phone saved"}{displayInvoice.customer_address ? ` · ${displayInvoice.customer_address}` : ""}</p></div><span className="chevron">›</span></button>
                        <div className="detail-items"><div className="detail-item detail-item-head"><span>Description</span><span>Qty</span><span>Price</span><span>Total</span></div>{displayInvoice.items.map((item) => <div className="detail-item" key={item.id}><strong>{item.description}</strong><span>{item.quantity}</span><span>{money(item.unit_price, displayInvoice.currency)}</span><b>{money(item.line_total, displayInvoice.currency)}</b></div>)}</div>
                        <div className="detail-totals"><p><span>Subtotal</span><strong>{money(displayInvoice.subtotal, displayInvoice.currency)}</strong></p>{displayInvoice.discount_amount > 0 ? <p><span>Discount</span><strong>− {money(displayInvoice.discount_amount, displayInvoice.currency)}</strong></p> : null}<div><span>Total amount</span><strong>{money(displayInvoice.total, displayInvoice.currency)}</strong></div></div>
                        {reminderInvoice?.payment_status === "pending" && whatsappDigits(reminderInvoice.customer_phone) ? <button className="primary wide reminder-detail" onClick={() => openWhatsAppReminder(reminderInvoice, settings.business_name, language)}><Icon name="whatsapp" />Send Reminder</button> : null}
                        <div className="share-actions">
                          <button className="whatsapp-share-button" disabled={isPreparingImage || !whatsappDigits(displayInvoice.customer_phone)} onClick={() => void openDirectWhatsAppChat()}><Icon name="whatsapp" /><span>{isPreparingImage ? "Preparing image…" : "Share on WhatsApp"}</span><Icon name="arrow" /></button>
                          <button className="secondary" disabled={isPreparingImage} onClick={() => void shareInvoiceImage()}>{isPreparingImage ? "Preparing…" : "Share image to another app"}</button>
                        </div>
                        {message ? <p className="toast" role="status">{message}</p> : null}
                        <button className="text-button" onClick={resetDraft}>Create another invoice</button>
                        <button className="text-button danger-text" onClick={() => setShowInvoiceDelete(true)}><Icon name="trash" /> Move to trash</button>
                      </div>
                    ) : step === 1 ? (
                      <div className="form-block">
                        <div className="section-heading"><div><span>1 / 3</span><h2>Who are you billing?</h2></div><button className="text-button" onClick={() => setTab("contacts")}>Add customer</button></div>
                        {customers.length ? <div className="contact-picker"><ContactAvatarSelect label="Customer" ariaLabel="Select customer" placeholder="Choose a customer" contacts={customers} selectedId={customerId} onChange={setCustomerId} />{customer ? <div className="selected-contact recipient-reference-card" aria-live="polite"><ContactAvatar name={customer.name} kind="customer" contactKey={String(customer.id)} /><button type="button" className="recipient-contact-link" onClick={() => setSelectedContactId(customer.id)} aria-label={`View ${customer.name} history`}><strong>{customer.name}</strong><small>{customer.phone ? formatPhoneDisplay(customer.phone) : "No phone saved"}{customer.address ? ` · ${customer.address}` : ""}</small></button><button type="button" className="recipient-remove" aria-label={`Remove ${customer.name} from invoice`} onClick={() => setCustomerId(null)}>×</button></div> : <p className="form-hint">Select a customer to unlock Step 2.</p>}</div> : <Empty title="No customers yet" body="Save a customer first, then return here to make their invoice." action={<button className="primary" onClick={() => setTab("contacts")}><Icon name="plus" />Add customer</button>} />}
                        <div className="field-row"><label className="field"><span>Invoice date</span><input type="date" value={issueDate} onChange={(event) => setIssueDate(event.target.value)} /></label><label className="field"><span>Payment due</span><input type="date" min={issueDate} value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label></div>
                        <button className="primary wide" disabled={!customerId} onClick={() => setStep(2)}>Continue to items</button>
                      </div>
                    ) : step === 2 ? (
                      <div className="form-block">
                        <div className="section-heading"><div><span>2 / 3</span><h2>Items</h2></div><button className="text-button" onClick={() => setTab("products")}><Icon name="plus" />Add product to catalog</button></div>
                        {products.length ? <div className="line-editor">
                          {lines.map((line, index) => {
                            const selectedProduct = products.find((product) => product.id === line.productId);
                            const quantity = Number(line.quantity) || 0;
                            return <div className="line-input create-item-row" key={line.key}>
                              <div className="item-description"><span>{ui(language, "Description")}</span><ProductCatalogPicker products={products} currency={settings.currency} selectedId={line.productId} language={language} onSelect={(id) => setLines((current) => current.map((item) => item.key === line.key ? { ...item, productId: id } : item))} /></div>
                              <label className="qty"><span>Qty</span><input aria-label={`Quantity for line ${index + 1}`} type="number" inputMode="numeric" min="1" step="1" placeholder="1" value={line.quantity} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setLines((current) => current.map((item) => item.key === line.key ? { ...item, quantity: event.target.value } : item))} /></label>
                              <div className="line-price"><span>Price</span><strong>{selectedProduct ? money(selectedProduct.unit_price, settings.currency) : "—"}</strong></div>
                              <div className="line-total"><span>Total</span><strong>{selectedProduct && quantity > 0 ? money(selectedProduct.unit_price * quantity, settings.currency) : "—"}</strong></div>
                              <button className="remove-line" aria-label={`Remove line ${index + 1}`} disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))}><Icon name="trash" /></button>
                            </div>;
                          })}
                          <button className="add-line add-item-button" onClick={() => { setLines((current) => [...current, { key: lineKey, productId: null, quantity: "" }]); setLineKey((value) => value + 1); }}><Icon name="plus" />Add Item</button>
                          {hasInvalidQuantity ? <p className="stock-error" role="alert"><strong>Enter a quantity of 1 or more.</strong> The quantity box starts empty so you can type the full number directly.</p> : null}
                          {inventoryIssues.map((issue) => <p className="stock-error" role="alert" key={issue}><strong>Not enough stock.</strong> {issue} Reduce the quantity before generating this invoice.</p>)}
                          <div className="invoice-options">
                            <fieldset><legend>Payment method</legend><div className="option-grid">{(["card", "cash", "transfer", "credit"] as const).map((method) => <button type="button" key={method} className={paymentMethod === method ? "active" : ""} onClick={() => setPaymentMethod(method)}>{method[0]?.toUpperCase()}{method.slice(1)}</button>)}</div></fieldset>
                            <fieldset><legend>Discount</legend><div className="option-grid discount-options">{(["none", "percentage", "fixed"] as const).map((type) => <button type="button" key={type} className={discountType === type ? "active" : ""} onClick={() => { setDiscountType(type); if (type === "none") setDiscountInput(""); }}>{type === "none" ? "No discount" : type === "percentage" ? "Percentage" : "Fixed amount"}</button>)}</div>{discountType !== "none" ? <label className="field discount-field"><span>{discountType === "percentage" ? "Discount percent" : `Discount amount (${settings.currency})`}</span><div className="amount-input"><span>{discountType === "percentage" ? "%" : settings.currency}</span><input aria-label={discountType === "percentage" ? "Discount percent" : "Fixed discount amount"} type="number" min="0" max={discountType === "percentage" ? "100" : undefined} step="0.01" value={discountInput} onChange={(event) => setDiscountInput(event.target.value)} /></div></label> : null}</fieldset>
                          </div>
                          <label className="field"><span>Notes / project <em>optional</em></span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Project, payment terms, or a short thank-you" rows={3} /></label>
                          <div className="create-total-row"><span>Total</span><strong>{money(draftTotal, settings.currency)}</strong></div>
                          <button className="primary wide preview-invoice-button" disabled={!canReviewInvoice} onClick={() => setStep(3)}><Icon name="invoice" />Preview invoice</button>
                        </div> : <Empty title="Your product list is empty" body="Save products with their prices so you can add them to invoices in one tap." action={<button className="primary" onClick={() => setTab("products")}><Icon name="plus" />Add product</button>} />}
                      </div>
                    ) : (
                      <div className="form-block review-block">
                        <div className="section-heading"><div><span>3 / 3</span><h2>Check and save</h2></div><button className="text-button" onClick={() => setStep(2)}>Edit items</button></div>
                        <div className="mobile-preview"><InvoicePaper invoice={draft} settings={settings} /></div>
                        {inventoryIssues.map((issue) => <p className="stock-error" role="alert" key={issue}><strong>Invoice not saved.</strong> {issue} Go back and reduce the quantity so inventory cannot go negative.</p>)}
                        {createInvoice.error ? <p className="error" role="alert">{createInvoice.error instanceof Error ? createInvoice.error.message : "Could not save the invoice. Check the quantities and try again."}</p> : null}
                        <button className="primary wide" disabled={!canCreate || createInvoice.isPending} onClick={() => createInvoice.mutate()}>{createInvoice.isPending ? "Saving…" : `Save invoice · ${money(draftTotal, settings.currency)}`}</button>
                      </div>
                    )}
                  </div>
                  <aside className="desktop-preview"><div className="preview-label"><span>LIVE PREVIEW</span><span>Updates as you type</span></div><InvoicePaper invoice={displayInvoice} settings={settings} /></aside>
                </div>
                {!savedInvoiceId && step < 3 ? <div className="mobile-running-total"><span>{draftItems.length} {draftItems.length === 1 ? "item" : "items"}</span><strong>{money(draftTotal, settings.currency)}</strong></div> : null}
              </>
            )}
          </section>
        ) : tab === "products" ? <ProductsView products={products} contacts={contacts} currency={settings.currency} onDone={() => setTab("create")} />
        : tab === "contacts" ? <ContactsView contacts={contacts} onDone={() => setTab("create")} onOpenContact={setSelectedContactId} />
        : tab === "history" ? <HistoryView invoices={workspace.data.invoices} purchases={workspace.data.purchases} settings={settings} onOpen={(id) => { armMobileBillsReturn(); setCreateKind("sale"); setSavedInvoiceId(id); setTab("create"); setStep(3); }} onOpenPurchase={(id) => { armMobileBillsReturn(); setCreateKind("purchase"); setSavedPurchaseId(id); setTab("create"); }} onOpenContact={setSelectedContactId} />
        : <ProfileView settings={settings} account={workspace.data.account} onEdit={() => setShowSettings(true)} onLogout={onLogout} />}
      </main>
      <nav className="bottom-nav" aria-label="Primary navigation">
        <div className="sidebar-topbar"><button className="theme-fab" onClick={() => setTheme(theme === "light" ? "dark" : "light")} aria-label={ui(language, "Toggle theme")} title={ui(language, "Toggle theme")}><Icon name={theme === "light" ? "moon" : "sun"} /></button></div>
        <div className="sidebar-profile">{settings.logo_url ? <img src={settings.logo_url} alt="" /> : settings.avatar_choice && SHOP_AVATARS[Number(settings.avatar_choice) - 1] ? <img src={SHOP_AVATARS[Number(settings.avatar_choice) - 1]} alt="" /> : <span className="sidebar-avatar-fallback"><Icon name="profile" /></span>}<div><strong>{workspace.data.account.shopkeeper_name || settings.business_name || "Shop owner"}</strong></div></div>
        {nav.map((item, index) => <div className="nav-entry" key={item.id}>{index === 0 || nav[index - 1]?.group !== item.group ? <span className="nav-group-label">{item.group}</span> : null}<button title={sidebarCollapsed ? item.label : undefined} aria-label={item.label} className={tab === item.id ? "active" : ""} onClick={() => { sessionStorage.removeItem(MOBILE_BILLS_RETURN_KEY); mobileDetailHistoryPushed.current = false; setSelectedContactId(null); setTab(item.id); setMessage(""); }}><Icon name={item.icon} /><span>{item.label}</span></button></div>)}
        <div className="sidebar-bottom"><button className="sidebar-help" onClick={() => setShowHelpFeedback(true)}><Icon name="help" /><span>{ui(language, "Help")}</span></button><button className="sidebar-logout" onClick={onLogout}><Icon name="logout" /><span>{ui(language, "Logout")}</span></button></div>
      </nav>

      <ChatBot workspace={workspace} />
      {showInvoiceDelete && savedInvoiceId ? <TrashDeleteDialog kind="sales" id={savedInvoiceId} label={displayInvoice?.invoice_number ?? "Invoice"} onClose={() => setShowInvoiceDelete(false)} onDeleted={() => { setShowInvoiceDelete(false); resetDraft(); }} /> : null}
      {showPurchaseDelete && savedPurchaseId ? <TrashDeleteDialog kind="purchases" id={savedPurchaseId} label="Purchase" onClose={() => setShowPurchaseDelete(false)} onDeleted={() => { setShowPurchaseDelete(false); setSavedPurchaseId(null); setStep(1); }} /> : null}
      {showHelpFeedback ? <FeedbackSheet onClose={() => setShowHelpFeedback(false)} /> : null}
      {showSettings ? <SettingsSheet settings={settings} onClose={() => setShowSettings(false)} /> : null}
      {transferSheet ? <TransferStatusSheet state={transferSheet} language={language} onDismiss={() => setTransferSheet(null)} onManualSave={() => { if (preparedInvoiceFile) openFileForManualSave(preparedInvoiceFile); }} onOpenWhatsApp={() => { openSavedInvoiceChat(); setTransferSheet(null); }} /> : null}
    </div>
  );
}

function ChatBot({ workspace }: { workspace: { data: { invoices: any[]; contacts: any[]; products: any[]; purchases: any[]; dashboard: any; settings: any } } }) {
  const { language } = useLanguage();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<{ from: "bot" | "user"; text: string }[]>([
    { from: "bot", text: language === "ur" ? "السلام علیکم! میں Daybill اسسٹنٹ ہوں۔ ایپ کے بارے میں یا آپ کی دکان کے حساب کے بارے میں پوچھیں۔" : "Hi! I'm the Daybill assistant. Ask me how to use the app, or about your shop's numbers." },
  ]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, typing, open]);

  const send = (text: string) => {
    const q = text.trim();
    if (!q || typing) return;
    setMessages((m) => [...m, { from: "user", text: q }]);
    setInput("");
    setTyping(true);
    const ctx: ChatContext = {
      invoices: workspace.data.invoices,
      contacts: workspace.data.contacts,
      products: workspace.data.products,
      purchases: workspace.data.purchases,
      dashboard: workspace.data.dashboard,
      currency: workspace.data.settings.currency || "PKR",
      language: language === "ur" ? "ur" : "en",
    };
    setTimeout(() => {
      const reply = answerQuestion(q, ctx);
      setMessages((m) => [...m, { from: "bot", text: reply }]);
      setTyping(false);
    }, 500);
  };

  return (<>
    <button className="chatbot-fab" onClick={() => setOpen((o) => !o)} aria-label="Chat with assistant">
      {open ? <span className="chatbot-fab-close">✕</span> : <img src={mascotAvatar} alt="Assistant" />}
    </button>
    {open ? <div className="chatbot-panel" role="dialog" aria-label="Daybill assistant">
      <div className="chatbot-header">
        <img src={mascotAvatar} alt="" />
        <div><strong>{language === "ur" ? "Daybill اسسٹنٹ" : "Daybill Assistant"}</strong><small><span className="chatbot-dot" />{language === "ur" ? "آن لائن" : "Online"}</small></div>
        <button className="chatbot-close" onClick={() => setOpen(false)} aria-label={language === "ur" ? "بند کریں" : "Close chat"}>✕</button>
      </div>
      <div className="chatbot-messages" ref={listRef}>
        {messages.map((m, i) => <div key={i} className={`chatbot-msg ${m.from}`}>{m.from === "bot" ? <img src={mascotAvatar} alt="" className="chatbot-msg-avatar" /> : null}<div className="chatbot-bubble">{m.text}</div></div>)}
        {typing ? <div className="chatbot-msg bot"><img src={mascotAvatar} alt="" className="chatbot-msg-avatar" /><div className="chatbot-bubble typing"><span /><span /><span /></div></div> : null}
      </div>
      <div className="chatbot-chips">
        {QUICK_CHIPS.map((c, i) => <button key={i} onClick={() => send(language === "ur" ? c.ur : c.en)}>{language === "ur" ? c.ur : c.en}</button>)}
      </div>
      <form className="chatbot-input" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={language === "ur" ? "کچھ پوچھیں…" : "Ask something…"} aria-label="Message" />
        <button type="submit" aria-label="Send">➤</button>
      </form>
    </div> : null}
  </>);
}

function BrandIdentity({ compact = false, variant = "auto" }: { compact?: boolean; variant?: "auto" | "dark" | "white" }) {
  const { theme } = useTheme();
  const useWhiteLogo = variant === "white" || (variant === "auto" && theme === "dark");
  return <div className={`brand-identity${compact ? " compact" : ""}`}><img src={useWhiteLogo ? daybillLogoWhite : daybillLogoDark} alt="Daybill logo" /><div><span>Roz ka karobar, ab asaan</span>{compact ? null : <small>Your daily trade, simplified</small>}</div></div>;
}

const onboardingSlides = [
  {
    title: "Create Invoices Faster and Easier",
    body: "Build polished sales and supplier invoices in a few simple steps.",
    image: welcomeShopkeeper,
    imageAlt: "Shopkeeper holding an invoice at the counter",
  },
  {
    title: "Simple Digital Billing",
    body: "Keep invoices and daily calculations clear and organized.",
    image: welcomeSlideBilling,
    imageAlt: "Invoice papers with a calculator and payment coins",
  },
  {
    title: "Share Clearly and Grow",
    body: "Send clean invoice images and keep customer conversations moving.",
    image: welcomeSlideSharing,
    imageAlt: "Phone sharing a digital invoice with business growth symbols",
  },
] as const;

function LoginShowcase() {
  return <section className="login-showcase desktop-business-showcase" aria-label="Daybill business overview">
    <div className="desktop-showcase-brand"><BrandIdentity compact variant="white" /></div>
    <div className="desktop-showcase-stage">
      <div className="floating-stat revenue-stat"><span>Revenue</span><strong>Rs 24,500</strong><small>+12% this month</small></div>
      <img className="desktop-shopkeeper-image" src={desktopShopkeeper} alt="Smiling shopkeeper holding an invoice and calculator" />
      <div className="floating-stat invoice-stat"><span>Invoices</span><strong>43</strong><small>8 paid today</small></div>
    </div>
    <div className="desktop-showcase-copy"><h2>Roz ka karobar, ab asaan</h2><p>Your daily trade, simplified</p></div>
  </section>;
}

function WelcomeScreen({ onLogin, onSignup }: { onLogin: () => void; onSignup: () => void }) {
  const [slide, setSlide] = useState(0);
  const touchStart = useRef<number | null>(null);
  const onTouchEnd = (event: React.TouchEvent<HTMLElement>) => {
    const start = touchStart.current;
    touchStart.current = null;
    const end = event.changedTouches[0]?.clientX;
    if (start === null || end === undefined || Math.abs(end - start) < 36) return;
    setSlide((current) => end < start ? (current + 1) % onboardingSlides.length : (current - 1 + onboardingSlides.length) % onboardingSlides.length);
  };
  return <main className="welcome-page" onTouchStart={(event) => { touchStart.current = event.touches[0]?.clientX ?? null; }} onTouchEnd={onTouchEnd}>
    <SafeAreaTopScrim backgroundColor="#ffffff" />
    <header className="welcome-head"><img className="welcome-logo" src={daybillLogoDark} alt="Daybill" /></header>
    <section className="welcome-content">
      <div className="welcome-art"><img className={`welcome-shopkeeper-image welcome-slide-image slide-${slide + 1}`} src={onboardingSlides[slide]?.image ?? welcomeShopkeeper} alt={onboardingSlides[slide]?.imageAlt ?? "Daybill welcome illustration"} /></div>
      <div className="welcome-copy">
        <h1>Welcome to Daybill!</h1>
        <p className="welcome-tagline">Roz ka karobar, ab asaan — your daily trade, simplified</p>
        <div className="welcome-dots" aria-label={`Page ${slide + 1} of ${onboardingSlides.length}`}>{onboardingSlides.map((item, index) => <button key={item.title} type="button" aria-label={`Go to page ${index + 1}`} className={index === slide ? "active" : ""} onClick={() => setSlide(index)} />)}</div>
      </div>
      <div className="welcome-actions"><button className="welcome-access" type="button" onClick={onLogin}>Access Your Account</button><button className="welcome-signup" type="button" onClick={onSignup}>Don’t have an account? <span>Signup</span></button></div>
    </section>
  </main>;
}

function NotFoundPage({ loggedIn, onHome }: { loggedIn: boolean; onHome: () => void }) {
  return <main className="not-found-page">
    <SafeAreaTopScrim backgroundColor="#bdeee4" />
    <span className="cloud cloud-one" /><span className="cloud cloud-two" /><span className="cloud cloud-three" />
    <div className="not-found-number" aria-hidden="true">404</div>
    <div className="not-found-monster"><img className="lost-monster-image" src={lostMonster} alt="A surprised fluffy teal monster" /></div>
    <section className="not-found-copy"><h1>Oops, I think we’re lost</h1><p>Let’s get you back somewhere familiar…</p><button type="button" onClick={onHome}>Back to home</button><small>{loggedIn ? "Dashboard" : "Login"}</small></section>
  </main>;
}

function AccountAuth({ onAuthenticated, initialMode = "user-login" }: { onAuthenticated: (session: AccountSession) => void; initialMode?: "user-login" | "create" }) {
  const { language, setLanguage } = useLanguage();
  const [mode, setMode] = useState<"user-login" | "create" | "admin" | "forgot-pin">(initialMode);
  const [remember, setRemember] = useState(true);
  const [name, setName] = useState("");
  const [shopName, setShopName] = useState("");
  const [shopAddress, setShopAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [adminEmail, setAdminEmail] = useState("hadiaghazanfar354@gmail.com");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminConfirmation, setAdminConfirmation] = useState("");
  // Phone OTP verification state
  const [otpStep, setOtpStep] = useState<"form" | "verify">("form");
  const [otpCode, setOtpCode] = useState("");
  const [otpSending, setOtpSending] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [otpCooldown, setOtpCooldown] = useState(0);
  const [otpVerifiedPhone, setOtpVerifiedPhone] = useState<string | null>(null);
  // Forgot PIN state
  const [resetPhone, setResetPhone] = useState("");
  const [resetPin, setResetPin] = useState("");
  const [resetConfirm, setResetConfirm] = useState("");
  const [resetDone, setResetDone] = useState(false);

  const login = useMutation({
    mutationFn: () => api.login({ phone, pin }),
    onSuccess: (result) => {
      const session: AccountSession = result;
      saveAccountSession(session, remember);
      onAuthenticated(session);
    },
  });
  const create = useMutation({
    mutationFn: () => {
      if (otpCode.length < 3) throw new Error("Please enter the verification code sent to your phone");
      return api.createAccount({ shopkeeper_name: name, shop_name: shopName, shop_address: shopAddress, phone, pin, otp_code: otpCode });
    },
    onSuccess: (result) => {
      const session: AccountSession = { account_id: result.account_id, session_token: result.session_token, session_kind: result.session_kind, shopkeeper_name: result.shopkeeper_name, phone: result.phone };
      saveAccountSession(session, remember);
      onAuthenticated(session);
    },
  });
  const doResetPin = useMutation({
    mutationFn: () => {
      if (otpCode.length < 3) throw new Error("Please enter the verification code sent to your phone");
      return api.resetPin({ phone: resetPhone, new_pin: resetPin, otp_code: otpCode });
    },
    onSuccess: () => { setResetDone(true); },
  });

  // OTP handlers with 60s resend cooldown
  const startCooldown = () => {
    setOtpCooldown(60);
    const t = setInterval(() => setOtpCooldown((c) => { if (c <= 1) { clearInterval(t); return 0; } return c - 1; }), 1000);
  };
  const handleSendOtp = async (phoneNumber: string) => {
    setOtpError(null);
    if (otpCooldown > 0 || otpSending) return;
    setOtpSending(true);
    try {
      await sendOtpCode(phoneNumber);
      setOtpStep("verify");
      startCooldown();
    } catch (err) {
      setOtpError(err instanceof Error ? err.message : "Could not send the code. Try again.");
    } finally {
      setOtpSending(false);
    }
  };

  const resetOtpState = () => {
    setOtpStep("form"); setOtpCode("");
    setOtpVerifiedPhone(null); setOtpError(null); setOtpCooldown(0);
  };

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail.trim());
  const adminStatus = useQuery({
    queryKey: ["admin-login-status", adminEmail.trim().toLowerCase()],
    queryFn: () => api.getAdminLoginStatus({ email: adminEmail.trim().toLowerCase() }),
    enabled: mode === "admin" && emailValid,
    retry: false,
  });
  const adminSetupRequired = Boolean(adminStatus.data?.recognized && adminStatus.data.setup_required);
  const adminLogin = useMutation({
    mutationFn: () => api.adminLogin({
      email: adminEmail.trim().toLowerCase(),
      password: adminPassword,
      confirm_password: adminSetupRequired ? adminConfirmation : null,
    }),
    onSuccess: (result) => {
      const session: AccountSession = result;
      saveAccountSession(session, remember);
      onAuthenticated(session);
    },
  });

  const normalizePhone = (value: string) => formatLocalPhoneInput(value);
  const changeMode = (next: "user-login" | "create" | "admin" | "forgot-pin") => {
    setMode(next);
    setPin("");
    setConfirmation("");
    setAdminPassword("");
    setAdminConfirmation("");
    setResetPhone(""); setResetPin(""); setResetConfirm(""); setResetDone(false);
    resetOtpState();
    login.reset();
    create.reset();
    adminLogin.reset();
    doResetPin.reset();
  };
  const phoneValid = /^03\d{2}-\d{7}$/.test(phone);
  const pinValid = /^\d{4}$/.test(pin);
  const adminPasswordValid = adminPassword.length >= 10;
  const adminFormValid = emailValid && adminPasswordValid && !adminStatus.isLoading && (!adminSetupRequired || adminPassword === adminConfirmation);
  const error = mode === "admin" ? adminLogin.error : login.error ?? create.error;
  const isCreating = mode === "create";

  return <main className="login-page">
    <SafeAreaTopScrim backgroundColor="#0B3B39" />
    <div className="login-layout">
      <LoginShowcase />
      <section className="login-panel" aria-label="Daybill login">
        <div className="login-panel-tools">
          <div className="login-language" role="group" aria-label="Language">
            <button type="button" className={language === "en" ? "active" : ""} aria-pressed={language === "en"} onClick={() => setLanguage("en")}>English</button>
            <button type="button" className={language === "ur" ? "active" : ""} aria-pressed={language === "ur"} onClick={() => setLanguage("ur")}>اردو</button>
          </div>
        </div>
        <div className="login-mobile-brand"><BrandIdentity compact /></div>
        <div className="login-card">
          <p className="auth-kicker">WELCOME BACK</p>
          <h1>{isCreating ? ui(language, "Create new account") : ui(language, "Welcome back")}</h1>
          <p className="auth-intro">{isCreating ? ui(language, "Each account keeps its products, contacts, invoices, purchases and shop settings separate.") : ui(language, "Sign in to continue to your business.")}</p>

          <div className="login-role-tabs" role="tablist" aria-label="Choose how to sign in">
            <button type="button" role="tab" aria-selected={mode !== "admin"} className={mode !== "admin" ? "active" : ""} onClick={() => changeMode("user-login")}><Icon name="profile" />User</button>
            <button type="button" role="tab" aria-selected={mode === "admin"} className={mode === "admin" ? "active" : ""} onClick={() => changeMode("admin")}><Icon name="lock" />Admin</button>
          </div>

          {mode === "forgot-pin" ? <form className="login-form" onSubmit={(event) => { event.preventDefault(); if (otpStep === "verify" && otpCode.length >= 3 && resetPin.length === 4 && resetPin === resetConfirm) doResetPin.mutate(); }}>
            <h2 style={{ margin: "0 0 4px" }}>Reset your PIN</h2>
            <p className="auth-intro">We'll send a verification code to your number.</p>
            {resetDone ? <><p className="otp-verified" role="status">✓ PIN reset successfully. Please log in with your new PIN.</p><button className="primary wide" type="button" onClick={() => changeMode("user-login")}>Back to login</button></> : <>
              <label><span>Phone number</span><input autoFocus aria-label="Phone number" inputMode="numeric" maxLength={12} value={resetPhone} onChange={(event) => { setResetPhone(formatLocalPhoneInput(event.target.value)); resetOtpState(); }} placeholder="0300-0000000" /></label>
              <div className="otp-section">
                {otpStep === "form" ? <button type="button" className="secondary wide" onClick={() => handleSendOtp(resetPhone)} disabled={!/^03\d{2}-\d{7}$/.test(resetPhone) || otpSending || otpCooldown > 0}>{otpSending ? "Sending code…" : otpCooldown > 0 ? `Resend in ${otpCooldown}s` : "Send verification code"}</button> : <>
                  <label><span>Enter the 6-digit code</span><input aria-label="Verification code" inputMode="numeric" maxLength={6} value={otpCode} onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="••••••" /></label>
                  <button type="button" className="secondary" onClick={() => handleSendOtp(resetPhone)} disabled={otpSending || otpCooldown > 0}>{otpCooldown > 0 ? `Resend in ${otpCooldown}s` : "Resend code"}</button>
                </>}
                {otpError ? <p className="auth-error" role="alert">{otpError}</p> : null}
              </div>
              {otpStep === "verify" ? <>
                <label><span>New 4-digit PIN</span><input aria-label="New PIN" type="password" inputMode="numeric" maxLength={4} value={resetPin} onChange={(e) => setResetPin(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="••••" /></label>
                <label><span>Confirm new PIN</span><input aria-label="Confirm new PIN" type="password" inputMode="numeric" maxLength={4} value={resetConfirm} onChange={(e) => setResetConfirm(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="••••" /></label>
                {resetConfirm.length === 4 && resetPin !== resetConfirm ? <p className="auth-error" role="alert">PINs do not match.</p> : null}
                {doResetPin.error ? <p className="auth-error" role="alert">{doResetPin.error instanceof Error ? doResetPin.error.message : "Could not reset PIN."}</p> : null}
                <button className="primary wide login-submit" type="submit" disabled={otpStep !== "verify" || otpCode.length < 3 || resetPin.length !== 4 || resetPin !== resetConfirm || doResetPin.isPending}>{doResetPin.isPending ? "Please wait…" : "Set new PIN"}</button>
              </> : null}
              <button className="auth-switch" type="button" onClick={() => changeMode("user-login")}>Back to login</button>
            </>}
          </form>
          : mode === "admin" ? <form className="login-form admin-form" onSubmit={(event) => { event.preventDefault(); if (adminFormValid) adminLogin.mutate(); }}>
            <label><span>Admin email</span><input autoFocus aria-label="Admin email" type="email" autoComplete="username" value={adminEmail} onChange={(event) => { setAdminEmail(event.target.value); setAdminPassword(""); setAdminConfirmation(""); adminLogin.reset(); }} /></label>
            {adminStatus.isLoading ? <p className="auth-field-help" role="status">Checking administrator account…</p> : null}
            <label><span>{adminSetupRequired ? "Set password" : "Password"}</span><span className="password-field"><input aria-label={adminSetupRequired ? "Set admin password" : "Admin password"} type={showPassword ? "text" : "password"} autoComplete={adminSetupRequired ? "new-password" : "current-password"} minLength={10} maxLength={128} placeholder="••••••••••" value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} /><button type="button" className="password-toggle" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <Icon name="eye-off" /> : <Icon name="eye" />}</button></span></label>
            <p className="auth-field-help">Use at least 10 characters.</p>
            {adminSetupRequired ? <label><span>Confirm password</span><span className="password-field"><input aria-label="Confirm admin password" type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={10} maxLength={128} placeholder="••••••••••" value={adminConfirmation} onChange={(event) => setAdminConfirmation(event.target.value)} /><button type="button" className="password-toggle" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <Icon name="eye-off" /> : <Icon name="eye" />}</button></span></label> : null}
            {!emailValid && adminEmail.length > 0 ? <p className="auth-error" role="alert">Enter a valid email address.</p> : null}
            {adminSetupRequired && adminConfirmation.length >= 10 && adminPassword !== adminConfirmation ? <p className="auth-error" role="alert">Passwords do not match.</p> : null}
            {error ? <p className="auth-error" role="alert">{error instanceof Error ? error.message : "Could not continue. Try again."}</p> : null}
            <label className="remember-row"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /><span>Remember me</span></label>
            <button className="primary wide login-submit" type="submit" disabled={!adminFormValid || adminLogin.isPending}>{adminLogin.isPending ? "Please wait…" : adminSetupRequired ? "Set password & sign in" : "Admin Login"}</button>
            <p className="auth-footnote">There is one administrator account. New administrator accounts cannot be created here.</p>
          </form> : <form className="login-form" onSubmit={(event) => {
            event.preventDefault();
            if (!phoneValid || !pinValid) return;
            if (isCreating) {
              if (pin !== confirmation || name.trim().length < 2 || shopName.trim().length < 2 || shopAddress.trim().length < 3) return;
              create.mutate();
            } else login.mutate();
          }}>
            {isCreating ? <>
              <label><span>Account holder</span><input autoFocus aria-label="Account holder" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Ali Raza" /></label>
              <label><span>Shop name</span><input aria-label="Shop name" value={shopName} onChange={(event) => setShopName(event.target.value)} placeholder="e.g. Noor Traders" /></label>
              <label><span>Shop address</span><textarea aria-label="Shop address" value={shopAddress} onChange={(event) => setShopAddress(event.target.value)} placeholder="Street, area and city" rows={2} /></label>
            </> : null}
            <label><span>Phone number</span><input autoFocus={!isCreating} aria-label="Phone number" inputMode="numeric" autoComplete="tel" maxLength={12} value={phone} onChange={(event) => setPhone(normalizePhone(event.target.value))} placeholder="0300-0000000" /></label>
            <p className="auth-field-help">Use the local format 0300-0000000.</p>
            <label><span>4-digit PIN</span><span className="password-field"><input aria-label={isCreating ? "Set 4-digit PIN" : "4-digit PIN"} type={showPassword ? "text" : "password"} inputMode="numeric" autoComplete={isCreating ? "new-password" : "current-password"} maxLength={4} pattern="[0-9]{4}" placeholder="••••" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 4))} /><button type="button" className="password-toggle" aria-label={showPassword ? "Hide PIN" : "Show PIN"} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <Icon name="eye-off" /> : <Icon name="eye" />}</button></span></label>
            {isCreating ? <label><span>Confirm PIN</span><span className="password-field"><input aria-label="Confirm 4-digit PIN" type={showPassword ? "text" : "password"} inputMode="numeric" autoComplete="new-password" maxLength={4} pattern="[0-9]{4}" placeholder="••••" value={confirmation} onChange={(event) => setConfirmation(event.target.value.replace(/\D/g, "").slice(0, 4))} /><button type="button" className="password-toggle" aria-label={showPassword ? "Hide PIN" : "Show PIN"} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <Icon name="eye-off" /> : <Icon name="eye" />}</button></span></label> : null}
            {!phoneValid && phone.length > 0 ? <p className="auth-error" role="alert">Phone number must use the 0300-0000000 format.</p> : null}
            {isCreating && confirmation.length === 4 && pin !== confirmation ? <p className="auth-error" role="alert">PINs do not match.</p> : null}
            {error ? <p className="auth-error" role="alert">{error instanceof Error ? error.message : "Could not continue. Try again."}</p> : null}
            <label className="remember-row"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /><span>Remember me</span></label>
            {isCreating ? <div className="otp-section">
              <p className="auth-field-help" style={{ marginTop: 0 }}>Verify your phone number to create the account.</p>
              {otpStep === "form" ? <>
                <button type="button" className="secondary wide" onClick={() => handleSendOtp(phone)} disabled={!phoneValid || otpSending || otpCooldown > 0}>{otpSending ? "Sending code…" : otpCooldown > 0 ? `Resend in ${otpCooldown}s` : "Send verification code"}</button>
              </> : <>
                <label><span>Enter the 6-digit code sent to {phone}</span><input aria-label="Verification code" inputMode="numeric" maxLength={6} value={otpCode} onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="••••••" /></label>
                <button type="button" className="secondary" onClick={() => handleSendOtp(phone)} disabled={otpSending || otpCooldown > 0}>{otpCooldown > 0 ? `Resend in ${otpCooldown}s` : "Resend code"}</button>
              </>}
              {otpError ? <p className="auth-error" role="alert">{otpError}</p> : null}
            </div> : null}
            <button className="primary wide login-submit" type="submit" disabled={!phoneValid || !pinValid || (isCreating && (name.trim().length < 2 || shopName.trim().length < 2 || shopAddress.trim().length < 3 || pin !== confirmation || otpStep !== "verify" || otpCode.length < 3)) || login.isPending || create.isPending}>{login.isPending || create.isPending ? "Please wait…" : isCreating ? "Create account" : "User Login"}</button>
            {!isCreating ? <button className="auth-switch" type="button" onClick={() => changeMode("forgot-pin")}>Forgot PIN?</button> : null}
            <button className="auth-switch" type="button" onClick={() => changeMode(isCreating ? "user-login" : "create")}>{isCreating ? "Already have a user account? Log in" : "New here? Create user account"}</button>
          </form>}
        </div>
      </section>
    </div>
  </main>;
}

function routeTail() {
  const marker = "/invoicing-app";
  const markerIndex = window.location.pathname.indexOf(marker);
  if (markerIndex < 0) return "";
  return window.location.pathname.slice(markerIndex + marker.length).replace(/\/+$/, "");
}

function AppContent() {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<LaunchPhase>("splash");
  const [session, setSession] = useState<AccountSession | null>(null);
  const [authInitialMode, setAuthInitialMode] = useState<"user-login" | "create">("user-login");
  const [unknownRoute, setUnknownRoute] = useState(() => !["", "/index.html"].includes(routeTail()));

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = readAccountSession();
      setApiSession(saved);
      setSession(saved);
      setPhase(saved ? "open" : "welcome");
    }, 450);
    return () => window.clearTimeout(timer);
  }, []);

  const authenticated = (next: AccountSession) => {
    setApiSession(next);
    setSession(next);
    queryClient.clear();
    setPhase("open");
  };
  const logout = () => {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
    localStorage.removeItem("hisaab-app-lock-v1");
    setApiSession(null);
    setSession(null);
    queryClient.clear();
    setAuthInitialMode("user-login");
    setPhase("auth");
  };
  const goHome = () => {
    const marker = "/invoicing-app";
    const markerIndex = window.location.pathname.indexOf(marker);
    if (markerIndex >= 0) window.history.replaceState(null, "", `${window.location.pathname.slice(0, markerIndex + marker.length)}/`);
    setUnknownRoute(false);
    const saved = readAccountSession();
    setApiSession(saved);
    setSession(saved);
    setPhase(saved ? "open" : "auth");
  };

  if (unknownRoute) return <NotFoundPage loggedIn={Boolean(session ?? readAccountSession())} onHome={goHome} />;
  if (phase === "splash") return <section className="launch-screen"><SafeAreaTopScrim backgroundColor="#0B3B39" /><img className="launch-logo" src={daybillLogoWhite} alt="Daybill" /><span className="launch-line" /></section>;
  if (phase === "welcome") return <WelcomeScreen onLogin={() => { setAuthInitialMode("user-login"); setPhase("auth"); }} onSignup={() => { setAuthInitialMode("create"); setPhase("auth"); }} />;
  if (phase === "auth" || !session) return <AccountAuth key={authInitialMode} initialMode={authInitialMode} onAuthenticated={authenticated} />;
  setApiSession(session);
  return session.session_kind === "admin" ? <AdminApp session={session} onLogout={logout} /> : <InvoiceApp onLogout={logout} />;
}

export function App() {
  return <ThemeProvider><LanguageProvider><AppContent /></LanguageProvider></ThemeProvider>;
}

function PurchasePaper({ purchase, settings }: { purchase: Purchase | PurchaseDraft; settings: Workspace["settings"] }) {
  const { language } = useLanguage();
  const label = (value: string) => ui(language, value);
  const isOrder = purchase.document_type === "purchase_order";
  return <article className={`purchase-paper${language === "ur" ? " invoice-paper-urdu" : ""}`} dir={language === "ur" ? "rtl" : "ltr"} lang={language} aria-label={label("Purchase invoice preview")}>
    <header><div>{settings.logo_url ? <img src={settings.logo_url} alt={`${settings.business_name || label("Business")} logo`} /> : null}<strong>{settings.business_name || label("Your shop")}</strong><small>{label(isOrder ? "Purchase Order" : "Delivered Purchase")}</small></div><div><span className={`document-badge ${purchase.delivery_status}`}>{label(purchase.delivery_status === "delivered" ? "Delivered" : "Pending delivery")}</span><b>{purchase.purchase_number === "DRAFT" ? label("DRAFT") : purchase.purchase_number}</b><time>{purchase.issue_date}</time>{purchase.due_date ? <time>{label("Due")} {purchase.due_date}</time> : null}</div></header>
    <section className="purchase-supplier-block"><ContactAvatar name={purchase.supplier_name || label("Supplier")} kind="supplier" contactKey={purchase.supplier_id ? String(purchase.supplier_id) : purchase.supplier_name} className="invoice-contact-avatar" /><div><span>{label("SUPPLIER")}</span><strong>{purchase.supplier_name || label("Select a supplier")}</strong>{purchase.supplier_phone ? <p>{formatPhoneDisplay(purchase.supplier_phone)}</p> : null}{purchase.supplier_address ? <p>{purchase.supplier_address}</p> : null}{purchase.supplier_reference ? <p>{label("Reference")}: {purchase.supplier_reference}</p> : null}</div></section>
    <div className="purchase-lines"><div className="purchase-row head"><span>{label("Stock item")}</span><span>{label("Qty")}</span><span>{label("Unit cost")}</span><span>{label("Total")}</span></div>{purchase.items.length ? purchase.items.map((item) => <div className="purchase-row" key={item.id}><span><strong>{item.description}</strong><small>{item.unit}</small></span><span>{item.quantity}</span><span>{money(item.unit_cost, purchase.currency)}</span><b>{money(item.line_total, purchase.currency)}</b></div>) : <p className="empty-lines">{label("Add stock items to preview the purchase.")}</p>}</div>
    <footer><span>{label(isOrder ? "Order total" : "Total purchase")}</span><strong>{money(purchase.total, purchase.currency)}</strong></footer>{purchase.notes ? <p className="purchase-note">{purchase.notes}</p> : null}
  </article>;
}

async function renderPurchasePng(purchase: Purchase | PurchaseDraft, settings: Workspace["settings"], language: Language) {
  const isUrdu = language === "ur";
  const width = 1200;
  const rowHeight = 86;
  const height = Math.max(1240, 680 + purchase.items.length * rowHeight + (purchase.notes ? 140 : 0));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image creation is not supported in this browser");
  if (isUrdu) await waitForInvoiceFonts(['32px "Urdu Invoice"'], "خریداری سپلائر آرڈر");
  const fontFamily = isUrdu ? '"Urdu Invoice", "Noto Naskh Arabic", serif' : "system-ui, sans-serif";
  const setText = (size: number, weight: 400 | 700, color: string, align: CanvasTextAlign = "left") => {
    context.font = `${weight} ${size}px ${fontFamily}`;
    context.fillStyle = color;
    context.textAlign = align;
    context.direction = isUrdu ? "rtl" : "ltr";
  };
  const label = (value: string) => ui(language, value);
  const left = isUrdu ? 1110 : 90;
  const right = isUrdu ? 90 : 1110;
  const leftAlign: CanvasTextAlign = isUrdu ? "right" : "left";
  const rightAlign: CanvasTextAlign = isUrdu ? "left" : "right";
  const title = purchase.document_type === "purchase_order" ? "Purchase Order" : "Delivered Purchase";

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.fillStyle = settings.accent_color;
  context.fillRect(isUrdu ? width - 18 : 0, 0, 18, height);
  context.textBaseline = "top";
  setText(50, 700, "#17202a", leftAlign);
  context.fillText(settings.business_name || label("Your shop"), left, 70);
  setText(25, 400, "#59636e", leftAlign);
  if (settings.address) context.fillText(settings.address, left, 136);
  if (settings.phone) context.fillText(formatPhoneDisplay(settings.phone), left, 174);
  setText(27, 700, settings.accent_color, rightAlign);
  context.fillText(label(title), right, 72);
  setText(38, 700, "#17202a", rightAlign);
  context.fillText(purchase.purchase_number === "DRAFT" ? label("DRAFT") : purchase.purchase_number, right, 118);
  setText(24, 400, "#59636e", rightAlign);
  context.fillText(`${label("Issued")} ${purchase.issue_date}`, right, 170);
  context.fillText(label(purchase.delivery_status === "delivered" ? "Delivered" : "Pending delivery"), right, 206);
  context.strokeStyle = "#d7d4cb";
  context.lineWidth = 2;
  context.beginPath(); context.moveTo(90, 266); context.lineTo(1110, 266); context.stroke();

  setText(21, 700, settings.accent_color, leftAlign);
  context.fillText(label("SUPPLIER"), left, 310);
  setText(35, 700, "#17202a", leftAlign);
  context.fillText(purchase.supplier_name || label("Select a supplier"), left, 350);
  setText(24, 400, "#59636e", leftAlign);
  let supplierY = 402;
  for (const detail of [purchase.supplier_address, formatPhoneDisplay(purchase.supplier_phone), purchase.supplier_reference ? `${label("Reference")}: ${purchase.supplier_reference}` : ""].filter(Boolean)) {
    context.fillText(detail, left, supplierY);
    supplierY += 35;
  }

  let y = Math.max(510, supplierY + 35);
  context.fillStyle = "#f1f4f2";
  context.fillRect(90, y, 1020, 62);
  setText(21, 700, "#34404a", leftAlign);
  context.fillText(label("Stock item"), isUrdu ? 1085 : 115, y + 18);
  setText(21, 700, "#34404a", "center");
  context.fillText(label("Qty"), isUrdu ? 470 : 730, y + 18);
  context.fillText(label("Unit cost"), isUrdu ? 300 : 900, y + 18);
  setText(21, 700, "#34404a", rightAlign);
  context.fillText(label("Total"), isUrdu ? 115 : 1085, y + 18);
  y += 62;
  for (const item of purchase.items) {
    setText(27, 700, "#17202a", leftAlign);
    context.fillText(item.description, isUrdu ? 1085 : 115, y + 16);
    setText(20, 400, "#59636e", leftAlign);
    context.fillText(item.unit, isUrdu ? 1085 : 115, y + 50);
    setText(25, 400, "#17202a", "center");
    context.fillText(String(item.quantity), isUrdu ? 470 : 730, y + 28);
    context.fillText(money(item.unit_cost, purchase.currency), isUrdu ? 300 : 900, y + 28);
    setText(25, 700, "#17202a", rightAlign);
    context.fillText(money(item.line_total, purchase.currency), isUrdu ? 115 : 1085, y + 28);
    context.strokeStyle = "#e5e3dc";
    context.beginPath(); context.moveTo(90, y + rowHeight); context.lineTo(1110, y + rowHeight); context.stroke();
    y += rowHeight;
  }
  y += 44;
  setText(28, 400, "#59636e", leftAlign);
  context.fillText(label(purchase.document_type === "purchase_order" ? "Order total" : "Total purchase"), left, y);
  setText(42, 700, "#17202a", rightAlign);
  context.fillText(money(purchase.total, purchase.currency), right, y - 8);
  if (purchase.notes) {
    y += 90;
    setText(21, 700, "#34404a", leftAlign);
    context.fillText(label("NOTE"), left, y);
    setText(24, 400, "#59636e", leftAlign);
    wrapCanvasText(context, purchase.notes, 980).slice(0, 3).forEach((line, index) => context.fillText(line, left, y + 36 + index * 32));
  }
  setText(22, 400, "#59636e", "center");
  context.fillText(label(purchase.document_type === "purchase_order" ? "Please deliver the listed stock." : "Stock received and recorded."), width / 2, height - 72);
  return canvasToPngBlob(canvas);
}

function PurchaseFlow({ workspace, savedPurchaseId, onSaved, onAddSupplier, onAddProduct, onEditSettings, onOpenContact, onBackToBills, onPrepareShare }: { workspace: Workspace; savedPurchaseId: number | null; onSaved: (id: number | null) => void; onAddSupplier: () => void; onAddProduct: () => void; onEditSettings: () => void; onOpenContact: (id: number) => void; onBackToBills: () => void; onPrepareShare: () => void }) {
  const queryClient = useQueryClient();
  const { language } = useLanguage();
  // Defensive: if workspace data isn't ready, show loading instead of crashing
  if (!workspace || !workspace.contacts) return <div className="purchase-flow"><div className="loading-panel"><p>Loading…</p></div></div>;
  const suppliers = workspace.contacts.filter((contact) => contact.kind === "supplier");
  const [step, setStep] = useState(1);
  const [documentType, setDocumentType] = useState<PurchaseDocumentType>("delivered_purchase");
  const [supplierId, setSupplierId] = useState<number | null>(null);
  const [issueDate, setIssueDate] = useState(localDate());
  const [dueDate, setDueDate] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"card" | "cash" | "transfer" | "credit">("credit");
  const [purchasePaymentStatus, setPurchasePaymentStatus] = useState<"pending" | "paid">("pending");
  const [supplierReference, setSupplierReference] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<PurchaseLine[]>([{ key: 1, productId: null, quantity: "", unitCost: "" }]);
  const [lineKey, setLineKey] = useState(2);
  const [shareMessage, setShareMessage] = useState("");
  const [isSharing, setIsSharing] = useState(false);
  const supplier = suppliers.find((item) => item.id === supplierId);
  const draftItems = lines.flatMap((line, index) => {
    const product = workspace.products.find((item) => item.id === line.productId);
    const quantity = Number(line.quantity);
    const unitCost = Math.round(Number(line.unitCost) * 100);
    return product && Number.isInteger(quantity) && quantity > 0 && Number.isInteger(unitCost) && unitCost >= 0 ? [{ id: index + 1, product_id: product.id, description: product.name, unit: product.unit, quantity, unit_cost: unitCost, line_total: quantity * unitCost }] : [];
  });
  const total = draftItems.reduce((sum, item) => sum + item.line_total, 0);
  const draft: PurchaseDraft = { purchase_number: "DRAFT", supplier_id: supplier?.id ?? null, supplier_name: supplier?.name ?? "", supplier_phone: supplier?.phone ?? "", supplier_address: supplier?.address ?? "", issue_date: issueDate, due_date: dueDate || null, document_type: documentType, delivery_status: documentType === "purchase_order" ? "pending" : "delivered", payment_status: purchasePaymentStatus, payment_method: paymentMethod, supplier_reference: supplierReference, notes, total, currency: workspace.settings.currency, items: draftItems };
  const saved = useQuery({ queryKey: ["purchase", savedPurchaseId], queryFn: async () => { const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("Request timed out after 15 seconds")), 15000)); return Promise.race([api.getPurchaseInvoice({ id: savedPurchaseId ?? 0 }), timeout]); }, enabled: false, retry: 1 });
  const create = useMutation({ mutationFn: () => api.createPurchaseInvoice({ supplier_id: supplierId ?? 0, document_type: documentType, issue_date: issueDate, due_date: dueDate || null, payment_method: paymentMethod, payment_status: purchasePaymentStatus, supplier_reference: supplierReference, notes, items: draftItems.map((item) => ({ product_id: item.product_id, quantity: item.quantity, unit_cost: item.unit_cost })) }), onSuccess: async (result) => { onSaved(result.id); setStep(3); await queryClient.invalidateQueries({ queryKey: ["workspace"] }); } });
  const payment = useMutation({ mutationFn: (status: "pending" | "paid") => api.setPurchasePaymentStatus({ id: savedPurchaseId ?? 0, status }), onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ["workspace"] }), queryClient.invalidateQueries({ queryKey: ["purchase", savedPurchaseId] })]); } });
  const deliver = useMutation({ mutationFn: () => api.markPurchaseDelivered({ id: savedPurchaseId ?? 0 }), onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ["workspace"] }), queryClient.invalidateQueries({ queryKey: ["purchase", savedPurchaseId] })]); } });
  if (savedPurchaseId && !listPurchase && !saved.data?.purchase) return <div className="purchase-flow"><div className="loading-panel"><p className="error">Could not find this purchase.</p><button className="secondary" onClick={onBackToBills}>← Back to Bills</button></div></div>;
  if (savedPurchaseId && saved.error) return <div className="purchase-flow"><div className="loading-panel"><p className="error">Could not load this purchase: {String(saved.error instanceof Error ? saved.error.message : saved.error)}</p><button className="secondary" onClick={onBackToBills}>← Back to Bills</button></div></div>;
  const invalid = lines.some((line) => line.productId === null || !Number.isInteger(Number(line.quantity)) || Number(line.quantity) < 1 || !Number.isFinite(Number(line.unitCost)) || Number(line.unitCost) < 0 || line.unitCost === "");
  const canReviewPurchase = Boolean(supplierId && !invalid && draftItems.length > 0);
  const reset = () => { onSaved(null); setStep(1); setDocumentType("delivered_purchase"); setSupplierId(null); setIssueDate(localDate()); setDueDate(""); setPaymentMethod("credit"); setPurchasePaymentStatus("pending"); setSupplierReference(""); setNotes(""); setLines([{ key: lineKey, productId: null, quantity: "", unitCost: "" }]); setLineKey((value) => value + 1); setShareMessage(""); };
  // Use list data immediately if available, enhance with full data when it loads
  const listPurchase = savedPurchaseId ? workspace.purchases?.find((pr) => pr.id === savedPurchaseId) : null;
  const display = saved.data?.purchase ?? (listPurchase ? {
    purchase_number: listPurchase.purchase_number,
    supplier_id: listPurchase.supplier_id,
    supplier_name: listPurchase.supplier_name,
    supplier_phone: listPurchase.supplier_phone ?? "",
    supplier_address: listPurchase.supplier_address ?? "",
    issue_date: listPurchase.issue_date,
    due_date: listPurchase.due_date,
    document_type: listPurchase.document_type,
    delivery_status: listPurchase.delivery_status,
    payment_status: listPurchase.payment_status,
    payment_method: listPurchase.payment_method ?? "credit",
    supplier_reference: listPurchase.supplier_reference ?? "",
    notes: listPurchase.notes ?? "",
    total: listPurchase.total,
    currency: listPurchase.currency,
    items: [],
  } : draft);
  const sharePurchaseImage = async () => {
    onPrepareShare();
    setShareMessage("");
    setIsSharing(true);
    try {
      const blob = await withTimeout(
        renderPurchasePng(display, workspace.settings, language),
        PNG_PIPELINE_TIMEOUT_MS,
        "The supplier document image took too long to prepare. Please try again.",
      );
      const file = new File([blob], safeInvoiceFilename(display.purchase_number), { type: "image/png" });
      if (typeof navigator.share === "function" && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        await withTimeout(navigator.share({ files: [file] }), PNG_PIPELINE_TIMEOUT_MS, "The phone share menu did not respond in time.");
        setShareMessage("Supplier document image sent to the phone share sheet.");
        return;
      }
      const objectUrl = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = safeInvoiceFilename(display.purchase_number);
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      window.setTimeout(() => { link.remove(); URL.revokeObjectURL(objectUrl); }, 30_000);
      const phone = whatsappDigits(display.supplier_phone);
      if (phone) window.open(`https://wa.me/${phone}`, "_blank", "noopener,noreferrer");
      setShareMessage(phone ? "Image saved. Attach it in the WhatsApp chat that just opened." : "Image saved. Add the supplier’s WhatsApp number to open their chat directly.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setShareMessage(error instanceof Error ? error.message : "Could not share the invoice image");
    } finally {
      setIsSharing(false);
    }
  };

  if (!workspace.settings.business_name) return <SetupPrompt onOpen={onEditSettings} />;

  return <div className="purchase-flow">{!savedPurchaseId ? <div className="stepper" aria-label="Purchase invoice creation steps">{["Supplier", "Stock", "Review"].map((label, index) => { const targetStep = index + 1; const locked = (targetStep === 2 && !supplierId) || (targetStep === 3 && !canReviewPurchase); return <button key={label} type="button" disabled={locked} aria-label={`${targetStep}. ${label}${locked ? " (locked)" : ""}`} className={step === targetStep ? "active" : step > targetStep ? "done" : ""} onClick={() => setStep(targetStep)}><span>{step > targetStep ? "✓" : targetStep}</span>{label}</button>; })}</div> : null}<div className="workbench"><div className="editor-panel">{savedPurchaseId ? <div className="success-panel"><button type="button" className="mobile-back-to-bills" onClick={onBackToBills}>← Back to Bills</button><span className={`success-stamp ${display.delivery_status}`}>{display.document_type === "purchase_order" ? "PURCHASE ORDER" : "STOCKED"}</span><h2>{display.purchase_number}</h2><button type="button" className="detail-recipient contact-link supplier-detail-link" onClick={() => display.supplier_id && onOpenContact(display.supplier_id)} aria-label={`View ${display.supplier_name} history`}><ContactAvatar name={display.supplier_name} kind="supplier" contactKey={display.supplier_id ? String(display.supplier_id) : display.supplier_name} /><div><small>SUPPLIER</small><strong>{display.supplier_name}</strong><p>{display.supplier_phone ? formatPhoneDisplay(display.supplier_phone) : "No phone saved"}{display.supplier_address ? ` · ${display.supplier_address}` : ""}</p></div><span className="chevron">›</span></button><p>{display.delivery_status === "pending" ? "Purchase order saved. Inventory has not changed yet." : display.payment_status === "pending" ? "Inventory increased and the supplier balance is now in payables." : "Inventory increased and this supplier invoice is marked paid."}</p>{display.document_type === "purchase_order" && display.delivery_status === "pending" ? <><button className="primary wide" disabled={deliver.isPending} onClick={() => deliver.mutate()}><Icon name="truck" />{deliver.isPending ? "Recording…" : "Mark delivered & add to stock"}</button><p className="form-hint">Marking delivered adds every item to inventory once and moves the amount into supplier payables.</p></> : <button className={`status-toggle ${display.payment_status}`} disabled={payment.isPending} onClick={() => payment.mutate(display.payment_status === "paid" ? "pending" : "paid")}>{display.payment_status === "paid" ? "✓ Paid · mark pending" : "Mark supplier paid"}</button>}<button className="secondary wide" disabled={isSharing || !saved.data?.purchase} onClick={() => void sharePurchaseImage()}><Icon name="whatsapp" />{isSharing ? "Preparing image…" : "Share supplier document image"}</button>{shareMessage ? <p className="toast" role="status">{shareMessage}</p> : null}{(saved.error || deliver.error) ? <p className="error">{String(saved.error ?? deliver.error)}</p> : null}<button className="text-button" onClick={reset}>Record another purchase</button><button className="text-button danger-text" onClick={onDeletePurchase}><Icon name="trash" /> Move to trash</button></div> : step === 1 ? <div className="form-block"><fieldset className="purchase-type-picker"><legend>Choose supplier invoice type</legend><div className="purchase-type-grid"><button type="button" className={documentType === "purchase_order" ? "active" : ""} onClick={() => { setDocumentType("purchase_order"); setPurchasePaymentStatus("pending"); }}><Icon name="invoice" /><span><strong>Purchase Order</strong><small>Order stock from a supplier without adding it to inventory yet.</small></span></button><button type="button" className={documentType === "delivered_purchase" ? "active" : ""} onClick={() => setDocumentType("delivered_purchase")}><Icon name="truck" /><span><strong>Delivered Purchase</strong><small>Record stock that has already arrived and add it to inventory now.</small></span></button></div></fieldset><div className="section-heading"><div><span>1 / 3</span><h2>{documentType === "purchase_order" ? "Who should deliver the stock?" : "Who supplied the stock?"}</h2></div><button className="text-button" onClick={onAddSupplier}>Add supplier</button></div>{suppliers.length ? <div className="contact-picker"><ContactAvatarSelect label="Supplier" ariaLabel="Select supplier" placeholder="Choose a supplier" contacts={suppliers} selectedId={supplierId} onChange={setSupplierId} />{supplier ? <div className="selected-contact recipient-reference-card" aria-live="polite"><ContactAvatar name={supplier.name} kind="supplier" contactKey={String(supplier.id)} /><button type="button" className="recipient-contact-link" onClick={() => onOpenContact(supplier.id)} aria-label={`View ${supplier.name} history`}><strong>{supplier.name}</strong><small>{supplier.phone ? formatPhoneDisplay(supplier.phone) : "No phone saved"}{supplier.address ? ` · ${supplier.address}` : ""}</small></button><button type="button" className="recipient-remove" aria-label={`Remove ${supplier.name} from purchase`} onClick={() => setSupplierId(null)}>×</button></div> : <p className="form-hint">Select a supplier to unlock Step 2.</p>}</div> : <Empty title="No suppliers yet" body="Add a supplier first, then record stock bought from them." action={<button className="primary" onClick={onAddSupplier}><Icon name="plus" />Add supplier</button>} />}<div className="field-row"><label className="field"><span>Purchase date</span><input type="date" value={issueDate} onChange={(event) => setIssueDate(event.target.value)} /></label><label className="field"><span>Payment due</span><input type="date" min={issueDate} value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label></div><label className="field"><span>Supplier bill / reference <em>optional</em></span><input value={supplierReference} onChange={(event) => setSupplierReference(event.target.value)} placeholder="e.g. Bill 4821" /></label><button className="primary wide" disabled={!supplierId} onClick={() => setStep(2)}>Continue to stock</button></div> : step === 2 ? <div className="form-block"><div className="section-heading"><div><span>2 / 3</span><h2>{documentType === "purchase_order" ? "What stock do you need?" : "What stock arrived?"}</h2></div><button className="text-button" onClick={onAddProduct}>Add product</button></div>{workspace.products.length ? <div className="line-editor">{lines.map((line, index) => <div className="purchase-line-input" key={line.key}><label><span>Product {index + 1}</span><select aria-label={`Purchase product for line ${index + 1}`} value={line.productId ?? ""} onChange={(event) => { const productId = event.target.value ? Number(event.target.value) : null; const product = workspace.products.find((item) => item.id === productId); setLines((current) => current.map((item) => item.key === line.key ? { ...item, productId, unitCost: product ? String(product.unit_cost / 100) : "" } : item)); }}><option value="">Choose product</option>{workspace.products.map((product) => <option key={product.id} value={product.id}>{product.name} · current stock {product.stock_quantity}</option>)}</select></label><label><span>{documentType === "purchase_order" ? "Qty ordered" : "Qty received"}</span><input aria-label={`Purchase quantity for line ${index + 1}`} type="number" min="1" step="1" value={line.quantity} onChange={(event) => setLines((current) => current.map((item) => item.key === line.key ? { ...item, quantity: event.target.value } : item))} /></label><label><span>Unit cost</span><input aria-label={`Purchase unit cost for line ${index + 1}`} type="number" min="0" step="0.01" value={line.unitCost} onChange={(event) => setLines((current) => current.map((item) => item.key === line.key ? { ...item, unitCost: event.target.value } : item))} /></label><button className="remove-line" aria-label={`Remove purchase line ${index + 1}`} disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))}><Icon name="trash" /></button></div>)}<button className="add-line" onClick={() => { setLines((current) => [...current, { key: lineKey, productId: null, quantity: "", unitCost: "" }]); setLineKey((value) => value + 1); }}><Icon name="plus" />Add another stock item</button><fieldset className="purchase-payment"><legend>Payment method</legend><div className="option-grid">{(["card", "cash", "transfer", "credit"] as const).map((method) => <button type="button" key={method} className={paymentMethod === method ? "active" : ""} onClick={() => setPaymentMethod(method)}>{method[0]?.toUpperCase()}{method.slice(1)}</button>)}</div></fieldset>{documentType === "delivered_purchase" ? <fieldset className="purchase-payment"><legend>Payment status</legend><div className="option-grid purchase-status-options"><button type="button" className={purchasePaymentStatus === "pending" ? "active" : ""} onClick={() => setPurchasePaymentStatus("pending")}>Pay later</button><button type="button" className={purchasePaymentStatus === "paid" ? "active" : ""} onClick={() => setPurchasePaymentStatus("paid")}>Already paid</button></div></fieldset> : <div className="delivery-note"><strong>Pending delivery</strong><span>Inventory and supplier payables will not change until this order is marked delivered.</span></div>}<label className="field"><span>Note <em>optional</em></span><textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} /></label><button className="primary wide" disabled={!canReviewPurchase} onClick={() => setStep(3)}>Review purchase · {money(total, workspace.settings.currency)}</button></div> : <Empty title="No products yet" body="Add the product first, then record the quantity and actual supplier cost." action={<button className="primary" onClick={onAddProduct}><Icon name="plus" />Add product</button>} />}</div> : <div className="form-block review-block"><div className="section-heading"><div><span>3 / 3</span><h2>{documentType === "purchase_order" ? "Check and send order" : "Check and record"}</h2></div><button className="text-button" onClick={() => setStep(2)}>Edit stock</button></div><div className="mobile-preview"><PurchasePaper purchase={draft} settings={workspace.settings} /></div>{create.error ? <p className="error">{create.error instanceof Error ? create.error.message : "Could not record this purchase"}</p> : null}<button className="primary wide" disabled={!supplierId || invalid || create.isPending} onClick={() => create.mutate()}>{create.isPending ? "Recording…" : `${documentType === "purchase_order" ? "Save purchase order" : "Record delivered purchase"} · ${money(total, workspace.settings.currency)}`}</button></div>}</div><aside className="desktop-preview"><div className="preview-label"><span>{documentType === "purchase_order" ? "PURCHASE ORDER PREVIEW" : "PURCHASE PREVIEW"}</span><span>{documentType === "purchase_order" ? "Stock changes only when marked delivered" : "Stock increases when saved"}</span></div><PurchasePaper purchase={display} settings={workspace.settings} /></aside></div></div>;
}

function RegisteredAccountsPanel({ accounts }: { accounts: RegisteredAccount[] }) {
  const { language } = useLanguage();
  const formatCreatedAt = (value: number) => new Intl.DateTimeFormat(language === "ur" ? "ur-PK" : "en-PK", {
    dateStyle: "medium",
  }).format(new Date(value));

  return <section className="registered-accounts-panel admin-table-panel" aria-labelledby="registered-accounts-title">
    <header><div><p className="eyebrow">ACCOUNT DIRECTORY</p><h2 id="registered-accounts-title">Registered Accounts</h2><p>Every account created in Daybill, newest first.</p></div><span className="registered-count">{accounts.length}</span></header>
    {accounts.length ? <div className="admin-table-wrap"><table className="admin-accounts-table">
      <thead><tr><th>Account holder & phone</th><th>Shop name</th><th>Shop address</th><th>Created</th><th className="numeric">Invoices</th><th className="numeric">Customers</th><th className="numeric">Suppliers</th></tr></thead>
      <tbody>{accounts.map((item) => <tr key={item.id}>
        <td data-label="Account holder & phone"><span className="account-person"><ContactAvatar name={item.account_holder_name} contactKey={`account-${item.id}`} className="registered-contact-avatar" /><span><strong>{item.account_holder_name}</strong><small>{item.phone ? formatPhoneDisplay(item.phone) : "Not provided"}</small></span></span></td>
        <td data-label="Shop name">{item.shop_name || "Not provided"}</td>
        <td data-label="Shop address">{item.shop_address || "Not provided"}</td>
        <td data-label="Created"><time dateTime={new Date(item.created_at).toISOString()}>{formatCreatedAt(item.created_at)}</time></td>
        <td data-label="Invoices" className="numeric"><b>{item.invoice_count}</b></td>
        <td data-label="Customers" className="numeric"><b>{item.customer_count}</b></td>
        <td data-label="Suppliers" className="numeric"><b>{item.supplier_count}</b></td>
      </tr>)}</tbody>
    </table></div> : <Empty title="No registered accounts" body="New accounts will appear here as soon as they are created." />}
  </section>;
}

function UserFeedbackPanel({ feedback }: { feedback: UserFeedback[] }) {
  const { language } = useLanguage();
  const formatCreatedAt = (value: number) => new Intl.DateTimeFormat(language === "ur" ? "ur-PK" : "en-PK", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
  const categoryLabel = (category: UserFeedback["category"]) => category ? `${category[0]?.toUpperCase() ?? ""}${category.slice(1)}` : "No category";

  return <section className="registered-accounts-panel admin-table-panel feedback-panel" aria-labelledby="user-feedback-title">
    <header><div><p className="eyebrow">USER MESSAGES</p><h2 id="user-feedback-title">User Feedback</h2><p>Messages from shop accounts, newest first.</p></div><span className="registered-count">{feedback.length}</span></header>
    {feedback.length ? <div className="admin-table-wrap"><table className="admin-accounts-table feedback-table">
      <thead><tr><th>Sender & phone</th><th>Shop name</th><th>Subject / category</th><th>Message</th><th>Date</th></tr></thead>
      <tbody>{feedback.map((item) => <tr key={item.id}>
        <td data-label="Sender & phone"><span className="account-person"><ContactAvatar name={item.sender_name} contactKey={`account-${item.account_id}`} className="registered-contact-avatar" /><span><strong>{item.sender_name}</strong><small>{item.phone ? formatPhoneDisplay(item.phone) : "Not provided"}</small></span></span></td>
        <td data-label="Shop name">{item.shop_name || "Not provided"}</td>
        <td data-label="Subject / category"><span className={`feedback-category ${item.category ?? "none"}`}>{categoryLabel(item.category)}</span></td>
        <td data-label="Message"><p className="feedback-message">{item.message}</p></td>
        <td data-label="Date"><time dateTime={new Date(item.created_at).toISOString()}>{formatCreatedAt(item.created_at)}</time></td>
      </tr>)}</tbody>
    </table></div> : <Empty title="No feedback yet" body="Feedback submitted by users will appear here." />}
  </section>;
}

function AdminProfile({ session, onLogout }: { session: AccountSession; onLogout: () => void }) {
  const { language, setLanguage } = useLanguage();
  const { theme, setTheme } = useTheme();
  return <section className="admin-profile profile-view">
    <div className="profile-hero"><div className="profile-logo-placeholder"><Icon name="lock" /></div><div><p className="eyebrow">ADMIN PROFILE</p><h1>{session.shopkeeper_name || "Administrator"}</h1><p>Oversight access only</p></div></div>
    <section className="account-card" aria-label="Signed in account"><div><span>Administrator session</span><strong>{session.shopkeeper_name || "Administrator"}</strong><small>Secure owner account</small></div><button className="secondary compact" type="button" onClick={onLogout}>{ui(language, "Logout / Switch account")}</button></section>
    <section className="language-card" aria-labelledby="admin-language-title"><div><span id="admin-language-title">Language</span><small>{language === "ur" ? "ایپ اردو میں دکھائی جا رہی ہے" : "Choose the app language"}</small></div><div className="language-switch" role="group" aria-label="Language"><button type="button" className={language === "en" ? "active" : ""} aria-pressed={language === "en"} onClick={() => setLanguage("en")}>English</button><button type="button" className={language === "ur" ? "active" : ""} aria-pressed={language === "ur"} onClick={() => setLanguage("ur")}>اردو</button></div></section>
    <section className="theme-card" aria-labelledby="admin-theme-title"><div><span id="admin-theme-title">Appearance</span><small>{ui(language, "Choose light or dark theme")}</small></div><div className="theme-switch" role="group" aria-label="Theme"><button type="button" className={theme === "light" ? "active" : ""} aria-pressed={theme === "light"} onClick={() => setTheme("light")}><i className="theme-swatch light" aria-hidden="true" />Light</button><button type="button" className={theme === "dark" ? "active" : ""} aria-pressed={theme === "dark"} onClick={() => setTheme("dark")}><i className="theme-swatch dark" aria-hidden="true" />Dark</button></div></section>
  </section>;
}

function AdminApp({ session, onLogout }: { session: AccountSession; onLogout: () => void }) {
  const { language } = useLanguage();
  const [view, setView] = useState<"dashboard" | "profile">("dashboard");
  const [directoryView, setDirectoryView] = useState<"accounts" | "feedback">("accounts");
  const dashboard = useQuery({ queryKey: ["admin-dashboard"], queryFn: () => api.getAdminDashboard({}) });
  if (dashboard.isPending) return <div className="loading"><div className="loader" /><p>Opening the ledger…</p></div>;
  if (dashboard.error || !dashboard.data) {
    const adminErr = String(dashboard.error ?? "Unknown error");
    if (/session|expired|unauthori|please log in|log in again/i.test(adminErr)) return <SessionExpiredNotice onLogout={onLogout} />;
    return <div className="fatal"><h2>Couldn’t open your records</h2><p>{adminErr}</p><div style={{display:"flex",gap:10,justifyContent:"center",marginTop:12}}><button className="secondary" onClick={() => dashboard.refetch()}>Try again</button><button className="primary" onClick={onLogout}>Back to login</button></div></div>;
  }
  const totals = dashboard.data.totals;
  return <div className="app-shell admin-shell">
    <SafeAreaTopScrim backgroundColor="var(--bg)" />
    <header className="app-brand-bar admin-brand-bar" aria-label="Daybill administrator header"><img className="sidebar-brand-logo" src={daybillLogoWhite} alt="Daybill" /><div className="app-brand-copy"><span>Administrator</span><small>Oversight panel</small></div></header>
    <main>{view === "dashboard" ? <section className="admin-dashboard">
      <header className="admin-dashboard-heading"><div><p className="eyebrow">PLATFORM OVERVIEW</p><h1>Admin Dashboard</h1><p>Across all user accounts</p></div><span className="admin-status"><Icon name="lock" />ADMIN</span></header>
      <section className="admin-stats" aria-label="Platform totals">
        <article><span>Total Registered Accounts</span><strong>{totals.registered_accounts}</strong><small>Active shop accounts</small></article>
        <article><span>Total Invoices Generated</span><strong>{totals.invoices}</strong><small>Sales invoices</small></article>
        <article><span>Total Customers</span><strong>{totals.customers}</strong><small>Saved customer records</small></article>
        <article><span>Total Suppliers</span><strong>{totals.suppliers}</strong><small>Saved supplier records</small></article>
      </section>
      <div className="admin-section-switch" role="tablist" aria-label="Admin records">
        <button type="button" role="tab" aria-selected={directoryView === "accounts"} className={directoryView === "accounts" ? "active" : ""} onClick={() => setDirectoryView("accounts")}><span>Registered Accounts</span><b>{dashboard.data.accounts.length}</b></button>
        <button type="button" role="tab" aria-selected={directoryView === "feedback"} className={directoryView === "feedback" ? "active" : ""} onClick={() => setDirectoryView("feedback")}><span>User Feedback</span><b>{totals.feedback}</b></button>
      </div>
      {directoryView === "accounts" ? <RegisteredAccountsPanel accounts={dashboard.data.accounts} /> : <UserFeedbackPanel feedback={dashboard.data.feedback} />}
    </section> : <AdminProfile session={session} onLogout={onLogout} />}</main>
    <nav className="bottom-nav admin-nav" aria-label="Primary navigation"><button className={view === "dashboard" ? "active" : ""} onClick={() => setView("dashboard")}><Icon name="dashboard" /><span>{ui(language, "Home")}</span></button><button className={view === "profile" ? "active" : ""} onClick={() => setView("profile")}><Icon name="profile" /><span>{ui(language, "Profile")}</span></button></nav>
  </div>;
}

function FeedbackSheet({ onClose }: { onClose: () => void }) {
  const [category, setCategory] = useState<"" | "bug" | "suggestion" | "other">("");
  const [message, setMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const submit = useMutation({
    mutationFn: () => api.submitFeedback({ category: category || null, message }),
    onSuccess: () => setSubmitted(true),
  });

  return <div className="sheet-backdrop" role="presentation"><section className="sheet feedback-sheet" role="dialog" aria-modal="true" aria-labelledby="feedback-title"><div className="sheet-handle" /><div className="sheet-head"><div><p className="eyebrow">FEEDBACK</p><h2 id="feedback-title">Help us improve Daybill</h2></div><button className="close-button" aria-label="Close feedback form" onClick={onClose}>×</button></div>
    {submitted ? <div className="feedback-success" role="status"><span className="success-stamp">SENT</span><h3>Thank you for your feedback.</h3><p>Your message has been sent to the Daybill team.</p><div className="feedback-success-actions"><button className="secondary" type="button" onClick={() => { setSubmitted(false); setCategory(""); setMessage(""); submit.reset(); }}>Send another response</button><button className="primary" type="button" onClick={onClose}>Done</button></div></div> : <form onSubmit={(event) => { event.preventDefault(); if (message.trim().length >= 5) submit.mutate(); }}>
      <p className="feedback-intro">Tell us what is working, what needs fixing, or what you would like us to add.</p>
      <label className="field"><span>Category <em>optional</em></span><select aria-label="Choose a category (optional)" value={category} onChange={(event) => setCategory(event.target.value as "" | "bug" | "suggestion" | "other")}><option value="">Choose a category (optional)</option><option value="bug">Bug</option><option value="suggestion">Suggestion</option><option value="other">Other</option></select></label>
      <label className="field"><span>Message</span><textarea required minLength={5} maxLength={1000} rows={7} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Write your feedback" /><small className="character-count">{message.length} / 1000</small></label>
      {submit.error ? <p className="error" role="alert">{submit.error instanceof Error ? submit.error.message : "Could not send feedback. Please try again."}</p> : null}
      <button className="primary wide" disabled={submit.isPending || message.trim().length < 5}>{submit.isPending ? "Sending…" : "Send feedback"}</button>
    </form>}
  </section></div>;
}

function ProfileView({ settings, account, onEdit, onLogout }: { settings: Workspace["settings"]; account: Workspace["account"]; onEdit: () => void; onLogout: () => void }) {
  const { language, setLanguage } = useLanguage();
  const { theme, setTheme } = useTheme();
  const [showFeedback, setShowFeedback] = useState(false);
  return <section className="profile-view">
    <div className="profile-hero">{settings.logo_url ? <img src={settings.logo_url} alt={`${settings.business_name || "Shop"} logo`} /> : settings.avatar_choice && SHOP_AVATARS[Number(settings.avatar_choice) - 1] ? <img src={SHOP_AVATARS[Number(settings.avatar_choice) - 1]} alt="Shop avatar" className="shopkeeper-avatar" /> : <ContactAvatar name={account.shopkeeper_name || settings.business_name || "Shop owner"} contactKey={`profile-${account.phone || account.shopkeeper_name}`} className="shopkeeper-avatar" />}<div><p className="eyebrow">{ui(language, "SHOP PROFILE")}</p><h1>{settings.business_name || ui(language, "Your shop")}</h1><p>{settings.address || ui(language, "No address added")}</p></div></div>
    <section className="account-card" aria-label="Signed in account"><div><span>{account.session_kind === "admin" ? ui(language, "Administrator session") : ui(language, "Signed in as")}</span><strong>{account.shopkeeper_name}</strong><small>{account.session_kind === "admin" ? account.admin_email : formatPhoneDisplay(account.phone)}</small></div><button className="secondary compact" type="button" onClick={onLogout}>{ui(language, "Logout / Switch account")}</button></section>
    <div className="profile-details"><article><span>{ui(language, "Phone / WhatsApp")}</span><strong>{settings.phone ? formatPhoneDisplay(settings.phone) : "Not added"}</strong></article><article><span>{ui(language, "Currency")}</span><strong>{settings.currency}</strong></article><article><span>{ui(language, "Invoice accent")}</span><strong className="accent-detail"><i style={{ background: settings.accent_color }} />{settings.accent_color.toUpperCase()}</strong></article></div>
    <section className="language-card" aria-labelledby="language-title"><div><span id="language-title">{ui(language, "Language")}</span><small>{language === "ur" ? "ایپ اردو میں دکھائی جا رہی ہے" : "Choose the app language"}</small></div><div className="language-switch" role="group" aria-label="Language"><button type="button" className={language === "en" ? "active" : ""} aria-pressed={language === "en"} onClick={() => setLanguage("en")}>English</button><button type="button" className={language === "ur" ? "active" : ""} aria-pressed={language === "ur"} onClick={() => setLanguage("ur")}>اردو</button></div></section>
    <section className="theme-card" aria-labelledby="theme-title"><div><span id="theme-title">{ui(language, "Appearance")}</span><small>{ui(language, "Choose light or dark theme")}</small></div><div className="theme-switch" role="group" aria-label="Theme"><button type="button" className={theme === "light" ? "active" : ""} aria-pressed={theme === "light"} onClick={() => setTheme("light")}><i className="theme-swatch light" aria-hidden="true" />Light</button><button type="button" className={theme === "dark" ? "active" : ""} aria-pressed={theme === "dark"} onClick={() => setTheme("dark")}><i className="theme-swatch dark" aria-hidden="true" />Dark</button></div></section>
    <section className="feedback-entry" aria-labelledby="feedback-entry-title"><span className="feedback-entry-icon"><Icon name="invoice" /></span><div><strong id="feedback-entry-title">{ui(language, "Feedback")}</strong><small>{ui(language, "Help us improve Daybill")}</small></div><button className="secondary compact" type="button" onClick={() => setShowFeedback(true)}>{ui(language, "Share feedback")}</button></section>
    <section className="urdu-guide" aria-labelledby="urdu-guide-title" dir="rtl"><p className="eyebrow">مدد</p><h2 id="urdu-guide-title">استعمال کا آسان طریقہ</h2><ol><li><strong>ایک بار کی ترتیب:</strong> دکان کا نام، فون، پتہ، کرنسی اور لوگو پروفائل میں محفوظ کریں۔</li><li><strong>رسید بنائیں:</strong> گاہک منتخب کریں، تاریخ اور واجب الادا تاریخ لگائیں، پھر اشیاء اور تعداد شامل کر کے رسید محفوظ کریں۔</li><li><strong>واٹس ایپ پر شیئر کریں:</strong> محفوظ رسید کھولیں اور رسید کی تصویر شیئر کرنے والا بٹن دبائیں۔</li><li><strong>اسٹاک دیکھیں:</strong> اسٹاک ٹیب میں ہر آئٹم کی موجودہ تعداد، لاگت اور فروخت کی قیمت دیکھیں؛ فروخت پر تعداد خود کم ہو گی۔</li><li><strong>بقایا جات سنبھالیں:</strong> ہوم یا بلز میں میعاد گزرنے والی رسیدیں دیکھیں اور واٹس ایپ یاد دہانی کا بٹن دبائیں۔</li></ol></section>
    <button className="primary profile-edit" onClick={onEdit}><Icon name="pencil" />{ui(language, "Edit shop details")}</button>
    {showFeedback ? <FeedbackSheet onClose={() => setShowFeedback(false)} /> : null}
  </section>;
}

type ChartRange = "7d" | "1m" | "3m" | "6m" | "9m" | "1y" | "lifetime";
const CHART_RANGES: Array<{ id: ChartRange; label: string; days: number | null; buckets: number }> = [
  { id: "7d", label: "7 days", days: 7, buckets: 7 },
  { id: "1m", label: "1 month", days: 30, buckets: 10 },
  { id: "3m", label: "3 months", days: 90, buckets: 12 },
  { id: "6m", label: "6 months", days: 180, buckets: 12 },
  { id: "9m", label: "9 months", days: 270, buckets: 9 },
  { id: "1y", label: "1 year", days: 365, buckets: 12 },
  { id: "lifetime", label: "Lifetime", days: null, buckets: 12 },
];

type AppNotification = {
  id: number;
  type: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
};

function timeAgo(iso: string, language: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = Math.max(0, now - then);
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return language === "ur" ? "ابھی" : "Just now";
  if (mins < 60) return language === "ur" ? `${mins} منٹ پہلے` : `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return language === "ur" ? `${hours} گھنٹے پہلے` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return language === "ur" ? `${days} دن پہلے` : `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function notificationIcon(type: string): string {
  switch (type) {
    case "low_stock": return "box";
    case "invoice_deleted": return "trash";
    case "customer_added":
    case "supplier_added": return "people";
    case "product_added": return "plus";
    case "stock_updated": return "arrow";
    default: return "bell";
  }
}

function NotificationPanel({ onClose }: { onClose: () => void }) {
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const { data, isPending } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.listNotifications({}),
  });
  const markRead = useMutation({
    mutationFn: (id: number) => api.markNotificationRead({ id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });
  const markAll = useMutation({
    mutationFn: () => api.markAllNotificationsRead({}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });
  const notifications: AppNotification[] = (data as any)?.notifications ?? [];
  const unreadCount: number = (data as any)?.unreadCount ?? 0;
  return (
    <div className="notif-backdrop" onClick={onClose}>
      <section className="notif-panel" role="dialog" aria-modal="true" aria-label="Notifications" onClick={(e) => e.stopPropagation()}>
        <div className="notif-head">
          <div><p className="eyebrow">ALERTS</p><h2>{ui(language, "Notifications")}</h2></div>
          <div className="notif-head-actions">
            {unreadCount > 0 ? <button type="button" className="text-button" onClick={() => markAll.mutate()} disabled={markAll.isPending}>{ui(language, "Mark all as read")}</button> : null}
            <button type="button" className="close-button" aria-label="Close notifications" onClick={onClose}>×</button>
          </div>
        </div>
        {isPending ? <p className="notif-loading">Loading…</p> : notifications.length === 0 ? (
          <div className="notif-empty"><Icon name="bell" /><p>{ui(language, "No notifications yet")}</p><small>{ui(language, "Stock alerts and activity will appear here.")}</small></div>
        ) : (
          <ul className="notif-list">
            {notifications.map((n) => (
              <li key={n.id}>
                <button type="button" className={`notif-item${n.is_read ? "" : " unread"}`} onClick={() => { if (!n.is_read) markRead.mutate(n.id); }}>
                  <span className={`notif-icon notif-${n.type}`}><Icon name={notificationIcon(n.type) as any} /></span>
                  <span className="notif-body">
                    <strong>{n.title}</strong>
                    <p>{n.message}</p>
                    <small>{timeAgo(n.created_at, language)}</small>
                  </span>
                  {!n.is_read ? <span className="notif-dot" aria-label="Unread" /> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function DashboardView({ workspace, onCreate, onCreatePurchase, onOpenInvoice, onOpenPurchase, onOpenContact, onInventory }: { workspace: Workspace; onCreate: () => void; onCreatePurchase: () => void; onOpenInvoice: (id: number) => void; onOpenPurchase: (id: number) => void; onOpenContact: (id: number) => void; onInventory: () => void }) {
  const { theme, setTheme } = useTheme();
  const { language } = useLanguage();
  const [chartRange, setChartRange] = useState<ChartRange>("1m");
  const [showNotifications, setShowNotifications] = useState(false);
  const { data: notifData } = useQuery({ queryKey: ["notifications"], queryFn: () => api.listNotifications({}), refetchInterval: 30000 });
  const unreadCount: number = (notifData as any)?.unreadCount ?? 0;
  const today = localDate();
  const overdue = workspace.invoices.filter((invoice) => invoice.payment_status === "pending" && invoice.due_date && invoice.due_date < today);
  const overduePurchases = workspace.purchases.filter((purchase) => purchase.delivery_status === "delivered" && purchase.payment_status === "pending" && purchase.due_date && purchase.due_date < today);
  const recentActivity = [
    ...workspace.invoices.slice(0, 6).map((invoice) => ({ id: `sale-${invoice.id}`, kind: "sale" as const, isOrder: false, rowId: invoice.id, contactId: invoice.customer_id, name: invoice.customer_name, phone: invoice.customer_phone, number: invoice.invoice_number, date: invoice.issue_date, amount: invoice.total, currency: invoice.currency, status: invoice.payment_status, overdue: invoice.payment_status === "pending" && Boolean(invoice.due_date && invoice.due_date < today) })),
    ...workspace.purchases.slice(0, 4).map((purchase) => ({ id: `purchase-${purchase.id}`, kind: "purchase" as const, isOrder: purchase.document_type === "purchase_order" && purchase.delivery_status === "pending", rowId: purchase.id, contactId: purchase.supplier_id, name: purchase.supplier_name, phone: purchase.supplier_phone, number: `${purchase.document_type === "purchase_order" ? "Purchase Order" : "Delivered Purchase"} · ${purchase.purchase_number}`, date: purchase.issue_date, amount: purchase.total, currency: purchase.currency, status: purchase.delivery_status === "pending" ? "pending-delivery" : purchase.payment_status, overdue: purchase.delivery_status === "delivered" && purchase.payment_status === "pending" && Boolean(purchase.due_date && purchase.due_date < today) })),
  ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 7);
  const unpaidCount = workspace.invoices.filter((invoice) => invoice.payment_status === "pending").length;
  const paidRevenue = workspace.invoices.filter((invoice) => invoice.payment_status === "paid").reduce((sum, invoice) => sum + invoice.total, 0);
  const salesSeries = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, offset) => {
      const date = new Date();
      date.setDate(date.getDate() - (6 - offset));
      const key = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
      return { key, label: new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date), sales: 0 };
    });
    const byDate = new Map(days.map((day) => [day.key, day]));
    for (const invoice of workspace.invoices) { const day = byDate.get(invoice.issue_date); if (day) day.sales += invoice.total / 100; }
    return days;
  }, [workspace.invoices]);
  const cashFlowSeries = useMemo(() => {
    const selected = CHART_RANGES.find((range) => range.id === chartRange) ?? CHART_RANGES[1];
    const end = new Date(`${today}T12:00:00`);
    const earliest = workspace.invoices.reduce<string | null>((value, invoice) => value === null || invoice.issue_date < value ? invoice.issue_date : value, null);
    const lifetimeDays = earliest ? Math.max(1, Math.ceil((end.getTime() - new Date(`${earliest}T12:00:00`).getTime()) / 86_400_000) + 1) : 1;
    const totalDays = selected?.days ?? lifetimeDays;
    const bucketCount = Math.max(1, Math.min(selected?.buckets ?? 12, totalDays));
    const start = new Date(end);
    start.setDate(end.getDate() - (totalDays - 1));
    const span = totalDays / bucketCount;
    const buckets = Array.from({ length: bucketCount }, (_, index) => {
      const bucketDate = new Date(start);
      bucketDate.setDate(start.getDate() + Math.floor(index * span));
      const label = totalDays <= 31
        ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(bucketDate)
        : new Intl.DateTimeFormat(undefined, { month: "short", year: totalDays > 365 ? "2-digit" : undefined }).format(bucketDate);
      return { label, revenue: 0, cost: 0, profit: 0 };
    });
    for (const invoice of workspace.invoices) {
      const invoiceDate = new Date(`${invoice.issue_date}T12:00:00`);
      const elapsed = Math.floor((invoiceDate.getTime() - start.getTime()) / 86_400_000);
      if (elapsed < 0 || elapsed >= totalDays) continue;
      const index = Math.min(bucketCount - 1, Math.floor(elapsed / span));
      const bucket = buckets[index];
      if (!bucket) continue;
      bucket.revenue += invoice.total / 100;
      bucket.cost += invoice.cost_total / 100;
      bucket.profit = bucket.revenue - bucket.cost;
    }
    return buckets;
  }, [chartRange, today, workspace.invoices]);
  const latestCashFlow = cashFlowSeries[cashFlowSeries.length - 1];
  const recentThreeDaySales = salesSeries.slice(4).reduce((sum, day) => sum + day.sales, 0);
  const previousThreeDaySales = salesSeries.slice(1, 4).reduce((sum, day) => sum + day.sales, 0);
  const trendPercent = previousThreeDaySales > 0 ? Math.round(((recentThreeDaySales - previousThreeDaySales) / previousThreeDaySales) * 100) : recentThreeDaySales > 0 ? 100 : 0;
  const attentionCount = overdue.length + overduePurchases.length;

  return <section className="dashboard-view overview-view">
    <header className="dashboard-topbar overview-header"><div className="overview-heading"><img src={daybillIcon} alt="" /><div><p>{ui(language, "Business overview")}</p><h1>{ui(language, "Overview")}</h1></div></div><div className="overview-header-actions"><button className="theme-toggle-header" onClick={() => setTheme(theme === "light" ? "dark" : "light")} aria-label={ui(language, "Toggle theme")}><Icon name={theme === "light" ? "moon" : "sun"} /></button><button className="notification-button" aria-label={`${unreadCount} unread notifications`} onClick={() => setShowNotifications(true)}><Icon name="bell" />{unreadCount > 0 ? <span className="notif-badge">{unreadCount > 99 ? "99+" : unreadCount}</span> : null}</button><button className="round-create" aria-label="Create a new invoice" onClick={onCreate}><Icon name="plus" /></button></div></header>
    {showNotifications ? <NotificationPanel onClose={() => setShowNotifications(false)} /> : null}
    <section className="received-card" aria-label="Received total">
      <div className="received-copy"><span>Received <i className={`trend-badge ${trendPercent < 0 ? "down" : ""}`}>{trendPercent >= 0 ? "+" : ""}{trendPercent}%</i></span><strong>{money(paidRevenue, workspace.settings.currency)}</strong><small>{ui(language, "Payments collected from paid invoices")}</small></div>
      <div className="received-chart" role="img" aria-label="Daily invoice sales for the last seven days"><ResponsiveContainer width="100%" height="100%"><AreaChart data={salesSeries} margin={{ top: 10, right: 4, left: 4, bottom: 0 }}><defs><linearGradient id="overviewFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#34d995" stopOpacity={0.45} /><stop offset="100%" stopColor="#34d995" stopOpacity={0.02} /></linearGradient></defs><Area type="monotone" dataKey="sales" stroke="#54e6aa" strokeWidth={2.5} fill="url(#overviewFill)" dot={false} /></AreaChart></ResponsiveContainer></div>
    </section>
    <section className="stat-tiles" aria-label="Business totals">
      <article className="stat-tile revenue"><span className="stat-icon"><Icon name="revenue" /></span><strong>{money(workspace.dashboard.revenue, workspace.settings.currency)}</strong><span>Revenue</span><small>Sales total</small><i className="stat-accent" /></article>
      <article className="stat-tile cost"><span className="stat-icon"><Icon name="cost" /></span><strong>{money(workspace.dashboard.cost, workspace.settings.currency)}</strong><span>Cost</span><small>Items sold</small><i className="stat-accent" /></article>
      <article className="stat-tile profit"><span className="stat-icon"><Icon name="profit" /></span><strong>{money(workspace.dashboard.profit, workspace.settings.currency)}</strong><span>Profit</span><small>Revenue minus cost</small><i className="stat-accent" /></article>
      <article className="stat-tile pending"><span className="stat-icon"><Icon name="history" /></span><strong>{money(workspace.dashboard.outstanding, workspace.settings.currency)}</strong><span>Pending dues</span><small>{unpaidCount} unpaid · {overdue.length} overdue</small><i className="stat-accent" /></article>
      <article className="stat-tile payables"><span className="stat-icon"><Icon name="wallet" /></span><strong>{money(workspace.dashboard.payables, workspace.settings.currency)}</strong><span>Supplier payables</span><small>Delivered purchases awaiting payment</small><i className="stat-accent" /></article>
    </section>
    <section className="finance-section cash-flow-card" aria-labelledby="cash-flow-title"><div className="finance-heading"><div><p className="card-kicker">CASH FLOW</p><h2 id="cash-flow-title">Revenue, cost & profit</h2></div><div className="quick-actions"><button onClick={onCreate}><Icon name="invoice" />New invoice</button><button onClick={onCreatePurchase}><Icon name="truck" />Add purchase</button><button onClick={onInventory}><Icon name="box" />View stock</button></div></div><div className="chart-range-picker" role="group" aria-label="Chart time range">{CHART_RANGES.map((range) => <button type="button" key={range.id} className={chartRange === range.id ? "active" : ""} aria-pressed={chartRange === range.id} onClick={() => setChartRange(range.id)}>{range.label}</button>)}</div><div className="cash-flow-chart" role="img" aria-label={`Revenue, cost and profit chart for ${CHART_RANGES.find((range) => range.id === chartRange)?.label ?? "selected range"}`}><ResponsiveContainer width="100%" height="100%"><AreaChart data={cashFlowSeries} margin={{ top: 20, right: 12, left: -12, bottom: 0 }}><defs><linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#20bd78" stopOpacity={0.3} /><stop offset="100%" stopColor="#20bd78" stopOpacity={0.01} /></linearGradient><linearGradient id="costFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#e2a93b" stopOpacity={0.18} /><stop offset="100%" stopColor="#e2a93b" stopOpacity={0.01} /></linearGradient></defs><CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 7" /><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "var(--dim)", fontSize: 10 }} interval="preserveStartEnd" /><YAxis axisLine={false} tickLine={false} tick={{ fill: "var(--dim)", fontSize: 10 }} width={58} tickFormatter={(value: number) => new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value)} /><Tooltip formatter={(value: number, name: string) => [money(Math.round(value * 100), workspace.settings.currency), name[0]?.toUpperCase() + name.slice(1)]} contentStyle={{ borderRadius: 12, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", boxShadow: "0 10px 30px rgba(10,64,61,.12)" }} /><Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 11, color: "var(--dim)" }} /><Area type="monotone" dataKey="revenue" stroke="#20bd78" strokeWidth={3} fill="url(#revenueFill)" dot={false} /><Area type="monotone" dataKey="cost" stroke="#e2a93b" strokeWidth={2.4} fill="url(#costFill)" dot={false} /><Area type="monotone" dataKey="profit" stroke="#0a6661" strokeWidth={2.4} fill="transparent" dot={false} />{latestCashFlow ? <><ReferenceDot x={latestCashFlow.label} y={latestCashFlow.revenue} r={4.5} fill="#20bd78" stroke="var(--surface)" strokeWidth={2} /><ReferenceDot x={latestCashFlow.label} y={latestCashFlow.cost} r={4} fill="#e2a93b" stroke="var(--surface)" strokeWidth={2} /><ReferenceDot x={latestCashFlow.label} y={latestCashFlow.profit} r={4} fill="#0a6661" stroke="var(--surface)" strokeWidth={2} /></> : null}</AreaChart></ResponsiveContainer></div></section>
    {overdue.length ? <section id="attention-section" className="dashboard-section overdue-section"><div className="dashboard-section-head"><div><p className="card-kicker danger">CUSTOMER DUES</p><h2>Overdue reminders</h2></div><span className="count-badge">{overdue.length}</span></div><div className="overdue-list">{overdue.map((invoice) => <article className="overdue-item" key={invoice.id}><button className="overdue-open" onClick={() => onOpenInvoice(invoice.id)}><span><strong>{invoice.customer_name}</strong><small>{invoice.invoice_number} · due {invoice.due_date}</small></span><b>{money(invoice.total, invoice.currency)}</b><em>Overdue</em></button><button className="reminder-button" disabled={!whatsappDigits(invoice.customer_phone)} onClick={() => openWhatsAppReminder(invoice, workspace.settings.business_name, language)}><Icon name="whatsapp" />{whatsappDigits(invoice.customer_phone) ? "Send Reminder on WhatsApp" : "WhatsApp number missing"}</button></article>)}</div></section> : null}
    {overduePurchases.length ? <section id={overdue.length ? undefined : "attention-section"} className="dashboard-section overdue-section"><div className="dashboard-section-head"><div><p className="card-kicker danger">SUPPLIER PAYABLES</p><h2>Payments overdue</h2></div><span className="count-badge">{overduePurchases.length}</span></div><div className="due-list">{overduePurchases.map((purchase) => <button key={purchase.id} onClick={() => onOpenPurchase(purchase.id)}><span><strong>{purchase.supplier_name}</strong><small>{purchase.purchase_number} · due {purchase.due_date}</small></span><b>{money(purchase.total, purchase.currency)}</b><em>Open purchase</em></button>)}</div></section> : null}
    <section id="recent-activity" className="activity-card"><div className="dashboard-section-head"><div><p className="card-kicker">LATEST</p><h2>Recent Activity</h2></div></div>{recentActivity.length ? <div className="activity-list">{recentActivity.map((item) => <button key={item.id} onClick={() => onOpenContact(item.contactId)} aria-label={`View ${item.name} history`}><ContactAvatar name={item.name} kind={item.kind === "sale" ? "customer" : "supplier"} contactKey={String(item.contactId)} /><span><strong>{item.name}</strong><small className="activity-contact">{item.phone ? formatPhoneDisplay(item.phone) : (item.kind === "sale" ? "Customer" : "Supplier")}</small><small>{item.number} · {item.date}</small></span><b>{item.kind === "purchase" && !item.isOrder ? "−" : item.kind === "sale" ? "+" : ""}{money(item.amount, item.currency)}<i className={`mini-status ${item.overdue ? "overdue" : item.status}`}>{item.overdue ? "Overdue" : item.status === "pending-delivery" ? "Pending delivery" : item.status === "pending" ? "Unpaid" : "Paid"}</i></b></button>)}</div> : <Empty title="No activity yet" body="Create your first invoice or record a supplier purchase." />}</section>
  </section>;
}

function SetupPrompt({ onOpen }: { onOpen: () => void }) {
  return <div className="setup-prompt"><div className="receipt-notch" /><p className="eyebrow">ONE-TIME SETUP</p><h2>Put your shop on the invoice</h2><p>Add the business name, currency, optional logo, and contact details that should appear on every bill.</p><button className="primary" onClick={onOpen}>Set up shop details</button></div>;
}

function SettingsSheet({ settings, onClose }: { settings: Workspace["settings"]; onClose: () => void }) {
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({ business_name: settings.business_name, phone: formatPhoneDisplay(settings.phone), address: settings.address, currency: settings.currency, accent_color: settings.accent_color, avatar_choice: settings.avatar_choice ?? "", bank_name: settings.bank_name ?? "", bank_account_title: settings.bank_account_title ?? "", bank_account_number: settings.bank_account_number ?? "", bank_iban: settings.bank_iban ?? "" });
  const [logoUrl, setLogoUrl] = useState(settings.logo_url);
  const save = useMutation({ mutationFn: () => api.saveSettings(form), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["workspace"] }); onClose(); } });
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const encoded = await fileToBase64(file);
      if (encoded.mimeType !== "image/jpeg" && encoded.mimeType !== "image/png") throw new Error("Choose a PNG or JPEG image");
      return api.uploadLogo({ data_base64: encoded.dataBase64, mime_type: encoded.mimeType });
    },
    onSuccess: async (result) => { setLogoUrl(result.logo_url); await queryClient.invalidateQueries({ queryKey: ["workspace"] }); },
  });
  return <div className="sheet-backdrop" role="presentation"><section className="sheet" role="dialog" aria-modal="true" aria-labelledby="settings-title"><div className="sheet-handle" /><div className="sheet-head"><div><p className="eyebrow">SHOP DETAILS</p><h2 id="settings-title">Invoice identity</h2></div><button className="close-button" aria-label="Close shop details" onClick={onClose}>×</button></div><form onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
    <div className="logo-control">{logoUrl ? <img src={logoUrl} alt="Current shop logo" /> : <div className="logo-placeholder">LOGO</div>}<div><strong>Shop logo</strong><p>Optional · PNG or JPEG</p><button type="button" className="secondary compact" disabled={upload.isPending} onClick={() => fileRef.current?.click()}>{upload.isPending ? "Uploading…" : logoUrl ? "Replace logo" : "Upload logo"}</button><input ref={fileRef} hidden tabIndex={-1} type="file" accept="image/png,image/jpeg" onChange={(event) => { const file = event.target.files?.[0]; if (file) upload.mutate(file); }} /></div></div>
    <div className="avatar-picker"><strong>{ui(language, "Choose avatar")}</strong><p>{ui(language, "Pick a profile picture — or upload your logo above.")}</p><div className="avatar-grid">{SHOP_AVATARS.map((src, i) => <button type="button" key={i} className={"avatar-option" + (form.avatar_choice === String(i + 1) ? " selected" : "")} onClick={() => setForm({ ...form, avatar_choice: form.avatar_choice === String(i + 1) ? "" : String(i + 1) })} aria-label={"Avatar " + (i + 1)}><img src={src} alt="" /></button>)}</div></div>
    <div className="bank-section"><strong>{ui(language, "Payment account")}</strong><p>{ui(language, "Add your bank details — the app creates a scannable QR for your invoices.")}</p><label className="field"><span>{ui(language, "Bank name")}</span><input value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} placeholder="Meezan Bank" /></label><label className="field"><span>{ui(language, "Account title")}</span><input value={form.bank_account_title} onChange={(e) => setForm({ ...form, bank_account_title: e.target.value })} placeholder="Ahmed Traders" /></label><label className="field"><span>{ui(language, "Account number")}</span><input value={form.bank_account_number} onChange={(e) => setForm({ ...form, bank_account_number: e.target.value })} placeholder="0123456789" /></label><label className="field"><span>{ui(language, "IBAN")}</span><input value={form.bank_iban} onChange={(e) => setForm({ ...form, bank_iban: e.target.value })} placeholder="PK36MEZN0001234567890123" dir="ltr" /></label></div>
    <label className="field"><span>Business / shop name</span><input required value={form.business_name} onChange={(event) => setForm({ ...form, business_name: event.target.value })} placeholder="e.g. Noor Traders" /></label>
    <div className="field-row"><label className="field"><span>Phone</span><input inputMode="tel" maxLength={12} pattern="03[0-9]{2}-[0-9]{7}" value={form.phone} onChange={(event) => setForm({ ...form, phone: formatLocalPhoneInput(event.target.value) })} placeholder="0300-0000000" /></label><label className="field currency"><span>Currency</span><input required minLength={3} maxLength={6} value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })} /></label></div>
    <label className="field"><span>{ui(language, "Address")}</span><textarea rows={2} value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} placeholder="Shop address" /></label>
    <label className="field"><span>Invoice accent</span><div className="color-field"><input aria-label="Invoice accent color" type="color" value={form.accent_color} onChange={(event) => setForm({ ...form, accent_color: event.target.value })} /><code>{form.accent_color.toUpperCase()}</code></div></label>
    {(save.error || upload.error) ? <p className="error" role="alert">{String(save.error ?? upload.error)}</p> : null}
    <button className="primary wide" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save shop details"}</button>
  </form></section></div>;
}

function ProductsView({ products, contacts, currency, onDone }: { products: Product[]; contacts: Contact[]; currency: string; onDone: () => void }) {
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const suppliers = contacts.filter((contact) => contact.kind === "supplier");
  const [editing, setEditing] = useState<Product | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("__all");
  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((pr) => { const c = (pr.category ?? "").trim(); if (c) set.add(c); });
    return Array.from(set).sort();
  }, [products]);
  const featuredProducts = useMemo(() => products.filter((pr) => pr.is_featured), [products]);
  const [form, setForm] = useState({ name: "", unit: "item", price: "", cost: "", stock: "", supplierId: "", brand: "", product_type: "", shelf_code: "", category: "", is_featured: false, sizes: "" });
  const [formImage, setFormImage] = useState<string | null>(null);
  const [formImageMime, setFormImageMime] = useState<string>("image/png");
  const imgRef = useRef<HTMLInputElement>(null);
  const save = useMutation({ mutationFn: () => api.saveProduct({ id: editing?.id, name: form.name, unit: form.unit, unit_price: Math.round(Number(form.price) * 100), unit_cost: Math.round(Number(form.cost || 0) * 100), stock_quantity: Math.max(0, Math.floor(Number(form.stock) || 0)), supplier_id: form.supplierId ? Number(form.supplierId) : null, brand: form.brand, product_type: form.product_type, shelf_code: form.shelf_code, category: form.category, is_featured: form.is_featured, sizes: form.sizes, ...(formImage ? { image_data_base64: formImage, image_mime_type: formImageMime as "image/png" | "image/jpeg" } : {}) }), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["workspace"] }); setShowForm(false); setEditing(null); setForm({ name: "", unit: "item", price: "", cost: "", stock: "", supplierId: "", brand: "", product_type: "", shelf_code: "", category: "", is_featured: false, sizes: "" }); setFormImage(null); } });
  const archive = useMutation({ mutationFn: (id: number) => api.archiveProduct({ id }), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["workspace"] }) });
  const startEdit = (product: Product) => { setEditing(product); setForm({ name: product.name, unit: product.unit, price: String(product.unit_price / 100), cost: String(product.unit_cost / 100), stock: String(product.stock_quantity), supplierId: product.supplier_id ? String(product.supplier_id) : "", brand: product.brand ?? "", product_type: product.product_type ?? "", shelf_code: product.shelf_code ?? "", category: product.category ?? "", is_featured: product.is_featured ?? false, sizes: product.sizes ?? "" }); setFormImage(null); setShowForm(true); };
  const newProduct = () => { setEditing(null); setForm({ name: "", unit: "item", price: "", cost: "", stock: "", supplierId: "", brand: "", product_type: "", shelf_code: "", category: "", is_featured: false, sizes: "" }); setFormImage(null); setShowForm(true); };
  const onImagePick = async (file: File) => {
    if (file.type !== "image/png" && file.type !== "image/jpeg") return;
    const reader = new FileReader();
    reader.onload = () => { const url = String(reader.result || ""); setFormImage(url.split(",")[1] || ""); setFormImageMime(file.type); };
    reader.readAsDataURL(file);
  };
  const q = search.trim().toLowerCase();
  const visible = products.filter((pr) => {
    const matchQ = !q || (pr.name + " " + (pr.brand ?? "") + " " + (pr.shelf_code ?? "") + " " + (pr.category ?? "") + " " + pr.id).toLowerCase().includes(q);
    if (activeCategory === "__featured") return matchQ && pr.is_featured;
    if (activeCategory !== "__all") return matchQ && (pr.category ?? "").trim() === activeCategory;
    return matchQ;
  });
  const supplierName = (id: number | null) => id ? suppliers.find((s) => s.id === id)?.name ?? "—" : "—";
  return <section className="manage-view products-view"><div className="manage-head"><div><p className="eyebrow">{ui(language, "SAVED CATALOG")}</p><h1>{ui(language, "Products")}</h1><p>{ui(language, "Prices added here fill invoices automatically.")}</p></div><button className="primary compact" onClick={newProduct}><Icon name="plus" />{ui(language, "New")}</button></div>
    <div className="product-toolbar"><div className="product-search"><Icon name="search" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={ui(language, "Search products…")} /></div></div>
    {showForm ? <form className="inline-form" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}><div className="section-heading"><h2>{editing ? ui(language, "Edit product") : ui(language, "New product")}</h2><button type="button" className="close-button" aria-label={ui(language, "Close")} onClick={() => setShowForm(false)}>×</button></div>
      <div className="product-image-picker">{formImage ? <img src={`data:${formImageMime};base64,${formImage}`} alt="" /> : editing?.image_url ? <img src={editing.image_url} alt="" /> : <div className="product-image-placeholder"><Icon name="box" /></div>}<button type="button" className="secondary compact" onClick={() => imgRef.current?.click()}>{ui(language, "Product image")}</button><input ref={imgRef} hidden type="file" accept="image/png,image/jpeg" onChange={(e) => { const f = e.target.files?.[0]; if (f) onImagePick(f); }} /></div>
      <label className="field"><span>{ui(language, "Name")}</span><input autoFocus required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
      <div className="form-row-2"><label className="field"><span>{ui(language, "Brand")}</span><input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} placeholder="No brand" /></label><label className="field"><span>{ui(language, "Type")}</span><input value={form.product_type} onChange={(e) => setForm({ ...form, product_type: e.target.value })} placeholder="Simple" /></label></div>
      <div className="form-row-2"><label className="field"><span>{ui(language, "Shelf code")}</span><input value={form.shelf_code} onChange={(e) => setForm({ ...form, shelf_code: e.target.value })} placeholder="A-01" /></label><label className="field"><span>{ui(language, "Unit")}</span><input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></label></div>
      <div className="form-row-2"><label className="field"><span>{ui(language, "Category")}</span><input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder={ui(language, "e.g. Cables, Chargers")} list="product-categories" /></label><label className="field"><span>{ui(language, "Sizes")}</span><input value={form.sizes} onChange={(e) => setForm({ ...form, sizes: e.target.value })} placeholder={ui(language, "e.g. S, M, L or 250g, 500g")} /></label></div>
      <label className="featured-toggle"><input type="checkbox" checked={form.is_featured} onChange={(e) => setForm({ ...form, is_featured: e.target.checked })} /><span className="featured-star">★</span><span>{ui(language, "Featured product")}</span><small>{ui(language, "Show in special section")}</small></label>
      <div className="form-row-2"><label className="field"><span>{ui(language, "Selling price")}</span><input required inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></label><label className="field"><span>{ui(language, "Cost price")}</span><input inputMode="decimal" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} /></label></div>
      <div className="form-row-2"><label className="field"><span>{ui(language, "Stock count")}</span><input inputMode="numeric" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} /></label><label className="field"><span>{ui(language, "Supplier")}</span><select value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })}><option value="">{ui(language, "No supplier")}</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label></div>
      {save.error ? <p className="error">{String(save.error)}</p> : null}<button className="primary wide" disabled={save.isPending}>{save.isPending ? ui(language, "Saving…") : ui(language, "Save product")}</button></form> : null}
    {visible.length ? <div className="product-table-wrap"><table className="product-table"><thead><tr><th>{ui(language, "Image")}</th><th>ID</th><th>{ui(language, "Name")}</th><th>{ui(language, "Brand")}</th><th>{ui(language, "Count")}</th><th>{ui(language, "Type")}</th><th>{ui(language, "Shelf code")}</th><th>{ui(language, "Supplier")}</th><th></th></tr></thead><tbody>{visible.map((product) => <tr key={product.id} className="product-row"><td className="cell-edit-left"><button aria-label={ui(language, "Edit")} onClick={() => startEdit(product)}><Icon name="pencil" /></button></td><td className="cell-image">{product.image_url ? <img className="product-thumb" src={product.image_url} alt="" /> : <span className="product-thumb empty"><Icon name="box" /></span>}</td><td className="mono cell-id">#{product.id}</td><td className="cell-main"><div className="cell-top"><strong>{product.name}</strong>{product.is_featured ? <span className="featured-star" title={ui(language, "Featured product")}>★</span> : null}<span className="mobile-only-meta"><span className={"stock-badge" + (product.stock_quantity <= 5 ? " low" : "")}>{product.stock_quantity} {ui(language, "in stock")}</span></span></div><div className="cell-meta mobile-only-meta"><span className="price">{money(product.unit_price, currency)}</span>{product.category ? <span className="cell-category"> · {product.category}</span> : null}{product.sizes ? <span> · {product.sizes}</span> : null}</div></td><td className="cell-brand">{product.brand || <span className="dim">—</span>}</td><td className="cell-count"><span className={product.stock_quantity <= 5 ? "low-stock" : ""}>{product.stock_quantity}</span></td><td className="cell-type">{product.product_type || <span className="dim">—</span>}</td><td className="mono cell-shelf">{product.shelf_code || <span className="dim">—</span>}</td><td className="cell-supplier">{supplierName(product.supplier_id)}</td><td className="row-actions"><button className="btn-edit" aria-label={ui(language, "Edit")} onClick={() => startEdit(product)}><Icon name="pencil" /></button><button className="btn-delete" aria-label={ui(language, "Delete")} onClick={() => archive.mutate(product.id)}><Icon name="trash" /></button></td></tr>)}</tbody></table></div> : !showForm ? <Empty title={ui(language, "No products here")} body={ui(language, "Add products to fill invoices automatically.")} /> : null}
    <button className="return-link" onClick={onDone}>← {ui(language, "Back to invoice")}</button>
  </section>;
}

function ContactsView({ contacts, onDone, onOpenContact }: { contacts: Contact[]; onDone: () => void; onOpenContact: (id: number) => void }) {
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Contact | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState<"all" | "customer" | "supplier">("all");
  const [form, setForm] = useState<{ name: string; phone: string; address: string; kind: "customer" | "supplier" }>({ name: "", phone: "", address: "", kind: "customer" });
  const save = useMutation({ mutationFn: () => api.saveContact({ id: editing?.id, ...form }), onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ["workspace"] }), queryClient.invalidateQueries({ queryKey: ["invoice"] })]); setShowForm(false); setEditing(null); setForm({ name: "", phone: "", address: "", kind: "customer" }); } });
  const archive = useMutation({ mutationFn: (id: number) => api.archiveContact({ id }), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["workspace"] }) });
  const visible = filter === "all" ? contacts : contacts.filter((contact) => contact.kind === filter);
  const startEdit = (contact: Contact) => { setEditing(contact); setForm({ name: contact.name, phone: formatPhoneDisplay(contact.phone), address: contact.address, kind: contact.kind }); setShowForm(true); };
  return <section className="manage-view"><div className="manage-head"><div><p className="eyebrow">{ui(language, "ADDRESS BOOK")}</p><h1>{ui(language, "Contacts")}</h1><p>{ui(language, "Customers appear in invoices; suppliers stay organized here.")}</p></div><button className="primary compact" onClick={() => { setEditing(null); setForm({ name: "", phone: "", address: "", kind: "customer" }); setShowForm(true); }}><Icon name="plus" />{ui(language, "Add")}</button></div>
    {showForm ? <form className="inline-form" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}><div className="section-heading"><h2>{editing ? ui(language, "Edit contact") : ui(language, "New contact")}</h2><button type="button" className="close-button" aria-label="Close contact form" onClick={() => setShowForm(false)}>×</button></div><div className="segmented" role="group" aria-label="Contact type"><button type="button" className={form.kind === "customer" ? "active" : ""} onClick={() => setForm({ ...form, kind: "customer" })}>{ui(language, "Customer")}</button><button type="button" className={form.kind === "supplier" ? "active" : ""} onClick={() => setForm({ ...form, kind: "supplier" })}>{ui(language, "Supplier")}</button></div><label className="field"><span>{ui(language, "Name")}</span><input autoFocus required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label className="field"><span>{ui(language, "WhatsApp / phone")}</span><input inputMode="tel" maxLength={12} pattern="03[0-9]{2}-[0-9]{7}" value={form.phone} onChange={(event) => setForm({ ...form, phone: formatLocalPhoneInput(event.target.value) })} placeholder="0300-0000000" /></label><label className="field"><span>{ui(language, "Address")}</span><textarea rows={2} value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} /></label>{save.error ? <p className="error">{String(save.error)}</p> : null}<button className="primary wide" disabled={save.isPending}>{save.isPending ? ui(language, "Saving…") : ui(language, "Save contact")}</button></form> : null}
    <div className="filter-tabs"><button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>{ui(language, "All")}</button><button className={filter === "customer" ? "active" : ""} onClick={() => setFilter("customer")}>{ui(language, "Customers")}</button><button className={filter === "supplier" ? "active" : ""} onClick={() => setFilter("supplier")}>{ui(language, "Suppliers")}</button></div>
    {visible.length ? <div className="record-list">{visible.map((contact) => <article className="record contact-record" key={contact.id}><button type="button" className="contact-record-main" onClick={() => onOpenContact(contact.id)} aria-label={`View ${contact.name} history`}><ContactAvatar name={contact.name} kind={contact.kind} contactKey={String(contact.id)} /><span><strong>{contact.name}</strong><small>{contact.phone ? formatPhoneDisplay(contact.phone) : contact.kind}</small></span><span className="chevron">›</span></button><button aria-label={`Edit ${contact.name}`} onClick={() => startEdit(contact)}><Icon name="pencil" /></button><button aria-label={`Archive ${contact.name}`} onClick={() => archive.mutate(contact.id)}><Icon name="trash" /></button></article>)}</div> : !showForm ? <Empty title="No contacts here" body="Add a customer for invoicing or a supplier for your records." /> : null}
    <button className="return-link" onClick={onDone}>← {ui(language, "Back to invoice")}</button>
  </section>;
}

function ContactHistoryView({ contact, invoices, purchases, currency, onBack, onOpenInvoice, onOpenPurchase }: { contact: Contact | null; invoices: Workspace["invoices"]; purchases: Workspace["purchases"]; currency: string; onBack: () => void; onOpenInvoice: (id: number) => void; onOpenPurchase: (id: number) => void }) {
  const { language } = useLanguage();
  const label = (value: string) => ui(language, value);
  if (!contact) return <section className="contact-history-view"><button className="return-link" onClick={onBack}>← {label("Back to contacts")}</button><Empty title={label("Contact not found")} body={label("This contact is no longer available.")} /></section>;

  const rows = contact.kind === "customer"
    ? invoices.filter((invoice) => invoice.customer_id === contact.id).map((invoice) => ({
        id: invoice.id, kind: "sale" as const, number: invoice.invoice_number, date: invoice.issue_date,
        amount: invoice.total, currency: invoice.currency, paid: invoice.payment_status === "paid",
        status: invoice.payment_status === "paid" ? "paid" : (invoice.due_date && invoice.due_date < localDate() ? "overdue" : "pending"),
        type: "Sales invoice",
      }))
    : purchases.filter((purchase) => purchase.supplier_id === contact.id).map((purchase) => ({
        id: purchase.id, kind: "purchase" as const, number: purchase.purchase_number, date: purchase.issue_date,
        amount: purchase.total, currency: purchase.currency, paid: purchase.delivery_status === "delivered" && purchase.payment_status === "paid",
        status: purchase.delivery_status === "pending" ? "pending-delivery" : purchase.payment_status,
        type: purchase.document_type === "purchase_order" ? "Purchase Order" : "Delivered Purchase",
      }));
  rows.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  const paid = rows.filter((row) => row.paid).reduce((sum, row) => sum + row.amount, 0);
  const pending = total - paid;
  const lastDate = rows[0]?.date ?? null;
  let frequency = label("No transactions yet");
  if (rows.length === 1) frequency = label("One transaction");
  if (rows.length > 1) {
    const oldest = rows[rows.length - 1]?.date;
    const newest = rows[0]?.date;
    if (oldest && newest) {
      const spanDays = Math.max(1, Math.round((new Date(`${newest}T00:00:00`).getTime() - new Date(`${oldest}T00:00:00`).getTime()) / 86_400_000));
      frequency = `${label("About every")} ${Math.max(1, Math.round(spanDays / (rows.length - 1)))} ${label("days")}`;
    }
  }

  return <section className="contact-history-view">
    <button className="return-link contact-back" onClick={onBack}>← {label("Back to contacts")}</button>
    <header className="contact-profile-card">
      <ContactAvatar name={contact.name} kind={contact.kind} contactKey={String(contact.id)} className="profile-contact-avatar" />
      <div><span className={`contact-type-pill ${contact.kind}`}>{label(contact.kind === "customer" ? "Customer" : "Supplier")}</span><h1>{contact.name}</h1><p>{contact.phone ? formatPhoneDisplay(contact.phone) : label("No phone saved")}</p><p>{contact.address || label("No address saved")}</p></div>
    </header>
    <section className="contact-summary-grid" aria-label={label("Contact billing summary")}>
      <article className="contact-total-stat"><span>{label("Total billed")}</span><strong>{money(total, currency)}</strong><small>{rows.length} {label(rows.length === 1 ? "invoice" : "invoices")}</small></article>
      <article><span>{label("Paid")}</span><strong>{money(paid, currency)}</strong></article>
      <article><span>{label("Pending")}</span><strong>{money(pending, currency)}</strong></article>
      <article><span>{label("Last transaction")}</span><strong className="date-value">{lastDate ?? "—"}</strong><small>{frequency}</small></article>
    </section>
    <section className="contact-ledger" aria-labelledby="contact-ledger-title"><div className="contact-ledger-head"><div><p className="eyebrow">{label("COMPLETE HISTORY")}</p><h2 id="contact-ledger-title">{label("Invoice history")}</h2></div><span className="count-badge">{rows.length}</span></div>
      {rows.length ? <div className="contact-ledger-list">{rows.map((row) => <button key={`${row.kind}-${row.id}`} onClick={() => row.kind === "sale" ? onOpenInvoice(row.id) : onOpenPurchase(row.id)}><span className="ledger-icon"><Icon name={row.kind === "sale" ? "invoice" : "truck"} /></span><span><strong>{label(row.type)}</strong><small>{row.number} · {row.date}</small></span><span className="ledger-amount"><strong>{money(row.amount, row.currency)}</strong><small className={`mini-status ${row.status}`}>{label(row.status === "pending-delivery" ? "Pending delivery" : row.status === "overdue" ? "Overdue" : row.status === "paid" ? "Paid" : "Pending")}</small></span><span className="chevron">›</span></button>)}</div> : <Empty title={label("No invoice history")} body={label(contact.kind === "customer" ? "Invoices for this customer will appear here." : "Orders and purchases for this supplier will appear here.")} />}
    </section>
  </section>;
}

type PdfPageSize = "a4" | "a5" | "a6";

const PDF_SIZES: Record<PdfPageSize, { w: number; h: number; label: string }> = {
  a4: { w: 210, h: 297, label: "A4" },
  a5: { w: 148, h: 210, label: "A5" },
  a6: { w: 105, h: 148, label: "A6" },
};

function BulkDownloadModal({ invoices, purchases, kind, settings, onClose }: {
  invoices: Workspace["invoices"];
  purchases: Workspace["purchases"];
  kind: "sales" | "purchases";
  settings: Workspace["settings"];
  onClose: () => void;
}) {
  const { language } = useLanguage();
  const [groupBy, setGroupBy] = useState<"day" | "month">("day");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [pdfSize, setPdfSize] = useState<PdfPageSize>("a4");
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const isSales = kind === "sales";

  // Normalize to a common shape for grouping/display
  type NormItem = { id: number; number: string; name: string; issue_date: string; total: number; currency: string };
  const normItems: NormItem[] = useMemo(() => {
    if (isSales) return invoices.map((i) => ({ id: i.id, number: i.invoice_number, name: i.customer_name, issue_date: i.issue_date, total: i.total, currency: i.currency }));
    return purchases.map((p) => ({ id: p.id, number: p.purchase_number, name: p.supplier_name, issue_date: p.issue_date, total: p.total, currency: p.currency }));
  }, [invoices, purchases, isSales]);

  // Group by day (YYYY-MM-DD) or month (YYYY-MM)
  const groups = useMemo(() => {
    const map = new Map<string, NormItem[]>();
    const sorted = [...normItems].sort((a, b) => b.issue_date.localeCompare(a.issue_date));
    for (const inv of sorted) {
      const key = groupBy === "day" ? inv.issue_date : inv.issue_date.slice(0, 7);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(inv);
    }
    return [...map.entries()];
  }, [normItems, groupBy]);

  const toggleOne = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleGroup = (ids: number[]) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const allSelected = ids.every((id) => next.has(id));
      if (allSelected) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  };

  const formatGroupLabel = (key: string) => {
    if (groupBy === "day") return key;
    const [y, m] = key.split("-");
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${months[Number(m) - 1]} ${y}`;
  };

  // Fetch full invoice details + render to PNG blob for each selected invoice
  const renderSelected = async (): Promise<{ label: string; blob: Blob }[]> => {
    const ids = [...selected];
    const results: { label: string; blob: Blob }[] = [];
    for (let i = 0; i < ids.length; i++) {
      setWorking(`Preparing ${i + 1} of ${ids.length}…`);
      if (isSales) {
        const detail = await api.getInvoice({ id: ids[i] });
        const blob = await renderInvoicePng(detail.invoice, settings, language);
        results.push({ label: detail.invoice.invoice_number, blob });
      } else {
        const detail = await api.getPurchaseInvoice({ id: ids[i] });
        const blob = await renderPurchasePng(detail.purchase, settings, language);
        results.push({ label: detail.purchase.purchase_number, blob });
      }
    }
    return results;
  };

  const blobToDataUrl = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const handleDownloadImages = async () => {
    if (!selected.size || working) return;
    setError(null);
    try {
      const rendered = await renderSelected();
      for (let i = 0; i < rendered.length; i++) {
        const { label, blob } = rendered[i];
        downloadBlob(blob, `${isSales ? "invoice" : "purchase"}-${label}.png`);
        if (i < rendered.length - 1) await new Promise((r) => setTimeout(r, 400));
      }
      setSuccess(`${rendered.length} invoice${rendered.length === 1 ? "" : "s"} downloaded as images ✓`);
      setTimeout(() => setSuccess(null), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not prepare the images.");
    } finally {
      setWorking(null);
    }
  };

  const handleDownloadPdf = async () => {
    if (!selected.size || working) return;
    setError(null);
    try {
      const rendered = await renderSelected();
      const pdf = new jsPDF({ unit: "mm", format: pdfSize, orientation: "portrait" });
      const w = pdf.internal.pageSize.getWidth();
      const h = pdf.internal.pageSize.getHeight();
      const margin = 4;
      for (let i = 0; i < rendered.length; i++) {
        if (i > 0) pdf.addPage(pdfSize, "portrait");
        const dataUrl = await blobToDataUrl(rendered[i].blob);
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const el = new Image();
          el.onload = () => resolve(el);
          el.onerror = reject;
          el.src = dataUrl;
        });
        const pageW = w - margin * 2;
        const pageH = h - margin * 2;
        const ratio = Math.min(pageW / img.width, pageH / img.height);
        const dw = img.width * ratio;
        const dh = img.height * ratio;
        const dx = (w - dw) / 2;
        const dy = (h - dh) / 2;
        pdf.addImage(dataUrl, "PNG", dx, dy, dw, dh);
      }
      const today = new Date().toISOString().slice(0, 10);
      pdf.save(`invoices-${today}.pdf`);
      setSuccess(`PDF with ${rendered.length} invoice${rendered.length === 1 ? "" : "s"} downloaded ✓`);
      setTimeout(() => setSuccess(null), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the PDF.");
    } finally {
      setWorking(null);
    }
  };

  return (
    <div className="bulk-modal-backdrop" onClick={onClose}>
      <div className="bulk-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Download invoices">
        <header className="bulk-modal-head">
          <div>
            <p className="eyebrow">BULK DOWNLOAD</p>
            <h2>Download {isSales ? "invoices" : "supplier invoices"}</h2>
          </div>
          <button type="button" className="bulk-modal-close" onClick={onClose} aria-label="Close">✕</button>
        </header>

        <div className="bulk-group-toggle" role="tablist" aria-label="Group invoices by">
          <button type="button" role="tab" aria-selected={groupBy === "day"} className={groupBy === "day" ? "active" : ""} onClick={() => setGroupBy("day")}>By day</button>
          <button type="button" role="tab" aria-selected={groupBy === "month"} className={groupBy === "month" ? "active" : ""} onClick={() => setGroupBy("month")}>By month</button>
        </div>

        <div className="bulk-list">
          {groups.length === 0 ? (
            <p className="bulk-empty">No invoices to download.</p>
          ) : groups.map(([key, list]) => {
            const ids = list.map((i) => i.id);
            const allChecked = ids.every((id) => selected.has(id));
            const someChecked = ids.some((id) => selected.has(id));
            return (
              <section key={key} className="bulk-group">
                <label className="bulk-group-head">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    ref={(el) => { if (el) el.indeterminate = !allChecked && someChecked; }}
                    onChange={() => toggleGroup(ids)}
                  />
                  <strong>{formatGroupLabel(key)}</strong>
                  <span className="bulk-count">{list.length} invoice{list.length === 1 ? "" : "s"}</span>
                </label>
                <div className="bulk-items">
                  {list.map((inv) => (
                    <label key={inv.id} className="bulk-item">
                      <input type="checkbox" checked={selected.has(inv.id)} onChange={() => toggleOne(inv.id)} />
                      <span className="bulk-item-main">
                        <strong>{inv.number}</strong>
                        <small>{inv.name} · {inv.issue_date}</small>
                      </span>
                      <span className="bulk-item-amount">{money(inv.total, inv.currency)}</span>
                    </label>
                  ))}
                </div>
              </section>
            );
          })}
        </div>

        {error ? <p className="bulk-error" role="alert">{error}</p> : null}
        {success ? <div className="bulk-success-popup" role="status"><span className="bulk-success-icon">✓</span><p>{success}</p><button type="button" onClick={() => setSuccess(null)} aria-label="Dismiss">✕</button></div> : null}
        {working ? <p className="bulk-working" role="status">{working}</p> : null}

        <footer className="bulk-foot">
          <div className="bulk-size-row">
            <span>PDF size:</span>
            <div className="bulk-size-pills" role="radiogroup" aria-label="PDF page size">
              {(Object.keys(PDF_SIZES) as PdfPageSize[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={pdfSize === s}
                  className={pdfSize === s ? "active" : ""}
                  onClick={() => setPdfSize(s)}
                >{PDF_SIZES[s].label}</button>
              ))}
            </div>
          </div>
          <div className="bulk-actions">
            <button type="button" className="secondary" disabled={!selected.size || !!working} onClick={() => void handleDownloadImages()}>
              {working ? "Working…" : `Images (${selected.size})`}
            </button>
            <button type="button" className="primary" disabled={!selected.size || !!working} onClick={() => void handleDownloadPdf()}>
              {working ? "Working…" : `PDF (${selected.size})`}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}


function TrashDeleteDialog({ kind, id, label, onClose, onDeleted }: {
  kind: "sales" | "purchases";
  id: number;
  label: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [pin, setPin] = useState("");
  const [reason, setReason] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const queryClient = useQueryClient();

  const handleTrash = async () => {
    if (pin.length !== 4 || reason.trim().length < 3 || working) return;
    setWorking(true);
    setError(null);
    try {
      if (kind === "sales") await api.trashInvoice({ invoice_id: id, pin, reason: reason.trim() });
      else await api.trashPurchase({ purchase_id: id, pin, reason: reason.trim() });
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not move to trash");
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="bulk-modal-backdrop" onClick={onClose}>
      <div className="bulk-modal trash-delete-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Move to trash">
        <header className="bulk-modal-head">
          <div>
            <p className="eyebrow">MOVE TO TRASH</p>
            <h2>{label}</h2>
          </div>
          <button type="button" className="bulk-modal-close" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="trash-delete-body">
          <p>This invoice will be moved to the trash. You can restore it later.</p>
          <label><span>Account PIN</span>
            <span className="password-field">
              <input aria-label="Account PIN" type={showPin ? "text" : "password"} inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="••••" />
              <button type="button" className="password-toggle" aria-label={showPin ? "Hide PIN" : "Show PIN"} onClick={() => setShowPin(!showPin)}>{showPin ? <Icon name="eye-off" /> : <Icon name="eye" />}</button>
            </span>
          </label>
          <label><span>Reason for deletion</span>
            <input aria-label="Reason" type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Duplicate entry, wrong customer…" maxLength={300} />
          </label>
          {reason.trim().length > 0 && reason.trim().length < 3 ? <p className="bulk-error" role="alert">Please give a reason (at least 3 characters).</p> : null}
          {error ? <p className="bulk-error" role="alert">{error}</p> : null}
          <div className="trash-delete-actions">
            <button type="button" className="secondary" onClick={onClose}>Cancel</button>
            <button type="button" className="danger" disabled={pin.length !== 4 || reason.trim().length < 3 || working} onClick={handleTrash}>{working ? "Moving…" : "Move to trash"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

type TrashedInvoice = {
  id: number; invoice_number: string; customer_name: string;
  issue_date: string; total: number; currency: string;
  delete_reason: string; deleted_at: string | null;
};
type TrashedPurchase = {
  id: number; purchase_number: string; supplier_name: string;
  issue_date: string; total: number; currency: string;
  delete_reason: string; deleted_at: string | null;
};

function TrashModal({ onClose }: { onClose: () => void }) {
  const { language } = useLanguage();
  const [pin, setPin] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [tab, setTab] = useState<"sales" | "purchases">("sales");
  const [invoices, setInvoices] = useState<TrashedInvoice[]>([]);
  const [purchases, setPurchases] = useState<TrashedPurchase[]>([]);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ kind: "sales" | "purchases"; id: number; label: string } | null>(null);
  const [showPin, setShowPin] = useState(false);
  const queryClient = useQueryClient();

  const loadTrash = async (pinCode: string) => {
    setVerifying(true);
    setPinError(null);
    try {
      const result = await api.listTrashed({ pin: pinCode });
      setInvoices(result.invoices as TrashedInvoice[]);
      setPurchases(result.purchases as TrashedPurchase[]);
      setUnlocked(true);
    } catch (e) {
      setPinError(e instanceof Error ? e.message : "Incorrect PIN");
    } finally {
      setVerifying(false);
    }
  };

  const refresh = async () => {
    try {
      const result = await api.listTrashed({ pin });
      setInvoices(result.invoices as TrashedInvoice[]);
      setPurchases(result.purchases as TrashedPurchase[]);
      queryClient.invalidateQueries({ queryKey: ["workspace"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not refresh trash");
    }
  };

  const handleRestore = async (kind: "sales" | "purchases", id: number) => {
    setWorking("Restoring…");
    setError(null);
    try {
      if (kind === "sales") await api.restoreInvoice({ invoice_id: id, pin });
      else await api.restorePurchase({ purchase_id: id, pin });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not restore");
    } finally {
      setWorking(null);
    }
  };

  const handleDeleteForever = async () => {
    if (!confirmDelete) return;
    setWorking("Deleting…");
    setError(null);
    try {
      if (confirmDelete.kind === "sales") await api.deleteInvoiceForever({ invoice_id: confirmDelete.id, pin });
      else await api.deletePurchaseForever({ purchase_id: confirmDelete.id, pin });
      setConfirmDelete(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete");
    } finally {
      setWorking(null);
    }
  };

  const fmtDate = (iso: string | null) => {
    if (!iso) return "—";
    try { return new Date(iso).toLocaleDateString(); } catch { return iso; }
  };

  return (
    <div className="bulk-modal-backdrop" onClick={onClose}>
      <div className="bulk-modal trash-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Trash">
        <header className="bulk-modal-head">
          <div>
            <p className="eyebrow">TRASH</p>
            <h2>Deleted invoices</h2>
          </div>
          <button type="button" className="bulk-modal-close" onClick={onClose} aria-label="Close">✕</button>
        </header>

        {!unlocked ? (
          <div className="trash-gate">
            <p>Enter your 4-digit PIN to open the trash.</p>
            <label><span>PIN</span>
              <span className="password-field">
                <input aria-label="Account PIN" type={showPin ? "text" : "password"} inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="••••" />
                <button type="button" className="password-toggle" aria-label={showPin ? "Hide PIN" : "Show PIN"} onClick={() => setShowPin(!showPin)}>{showPin ? <Icon name="eye-off" /> : <Icon name="eye" />}</button>
              </span>
            </label>
            {pinError ? <p className="bulk-error" role="alert">{pinError}</p> : null}
            <button type="button" className="primary wide" disabled={pin.length !== 4 || verifying} onClick={() => loadTrash(pin)}>{verifying ? "Checking…" : "Open trash"}</button>
          </div>
        ) : (
          <>
            <div className="bulk-group-toggle" role="tablist" aria-label="Trash contents">
              <button type="button" role="tab" aria-selected={tab === "sales"} className={tab === "sales" ? "active" : ""} onClick={() => setTab("sales")}>Sales ({invoices.length})</button>
              <button type="button" role="tab" aria-selected={tab === "purchases"} className={tab === "purchases" ? "active" : ""} onClick={() => setTab("purchases")}>Supplier ({purchases.length})</button>
            </div>
            <div className="bulk-list trash-list">
              {(tab === "sales" ? invoices.length === 0 : purchases.length === 0) ? (
                <p className="bulk-empty">Trash is empty.</p>
              ) : (tab === "sales" ? invoices : purchases).map((item) => {
                const isInv = tab === "sales";
                const num = isInv ? (item as TrashedInvoice).invoice_number : (item as TrashedPurchase).purchase_number;
                const name = isInv ? (item as TrashedInvoice).customer_name : (item as TrashedPurchase).supplier_name;
                return (
                  <article key={item.id} className="trash-row">
                    <div className="trash-row-main">
                      <strong>{num}</strong>
                      <small>{name} · {item.issue_date} · {money(item.total, item.currency)}</small>
                      <small className="trash-reason">Reason: {item.delete_reason || "—"}</small>
                      <small className="trash-date">Deleted {fmtDate(item.deleted_at)}</small>
                    </div>
                    <div className="trash-row-actions">
                      <button type="button" className="secondary small" disabled={!!working} onClick={() => handleRestore(tab, item.id)}>Restore</button>
                      <button type="button" className="danger small" disabled={!!working} onClick={() => setConfirmDelete({ kind: tab, id: item.id, label: num })}>Delete forever</button>
                    </div>
                  </article>
                );
              })}
            </div>
            {error ? <p className="bulk-error" role="alert">{error}</p> : null}
            {working ? <p className="bulk-working" role="status">{working}</p> : null}
            {confirmDelete ? (
              <div className="trash-confirm-backdrop" onClick={() => setConfirmDelete(null)}>
                <div className="trash-confirm" onClick={(e) => e.stopPropagation()} role="alertdialog" aria-label="Confirm permanent deletion">
                  <h3>Delete forever?</h3>
                  <p>{confirmDelete.label} will be permanently deleted. This cannot be undone.</p>
                  <div className="trash-confirm-actions">
                    <button type="button" className="secondary" onClick={() => setConfirmDelete(null)}>Cancel</button>
                    <button type="button" className="danger" disabled={!!working} onClick={handleDeleteForever}>{working ? "Deleting…" : "Delete forever"}</button>
                  </div>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function HistoryView({ invoices, purchases, settings, onOpen, onOpenPurchase, onOpenContact }: { invoices: Workspace["invoices"]; purchases: Workspace["purchases"]; settings: Workspace["settings"]; onOpen: (id: number) => void; onOpenPurchase: (id: number) => void; onOpenContact: (id: number) => void }) {
  const { language } = useLanguage();
  const [kind, setKind] = useState<"sales" | "purchases">("sales");
  const [salesFilter, setSalesFilter] = useState<"all" | "paid" | "unpaid" | "overdue">("all");
  const [purchaseFilter, setPurchaseFilter] = useState<"all" | "orders" | "delivered">("all");
  const [search, setSearch] = useState("");
  const [showBulkDownload, setShowBulkDownload] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  const today = localDate();
  const isOverdue = (invoice: Workspace["invoices"][number]) => invoice.payment_status === "pending" && Boolean(invoice.due_date && invoice.due_date < today);
  const salesCounts = { paid: invoices.filter((invoice) => invoice.payment_status === "paid").length, unpaid: invoices.filter((invoice) => invoice.payment_status === "pending" && !isOverdue(invoice)).length, overdue: invoices.filter(isOverdue).length, draft: 0 };
  const normalizedSearch = search.trim().toLowerCase();
  const visibleInvoices = invoices.filter((invoice) => {
    const statusMatches = salesFilter === "all" || (salesFilter === "paid" && invoice.payment_status === "paid") || (salesFilter === "unpaid" && invoice.payment_status === "pending" && !isOverdue(invoice)) || (salesFilter === "overdue" && isOverdue(invoice));
    return statusMatches && (!normalizedSearch || invoice.customer_name.toLowerCase().includes(normalizedSearch) || invoice.invoice_number.toLowerCase().includes(normalizedSearch));
  });
  const visiblePurchases = purchases.filter((purchase) => {
    const typeMatches = purchaseFilter === "all" || (purchaseFilter === "orders" && purchase.document_type === "purchase_order") || (purchaseFilter === "delivered" && purchase.delivery_status === "delivered");
    return typeMatches && (!normalizedSearch || purchase.supplier_name.toLowerCase().includes(normalizedSearch) || purchase.purchase_number.toLowerCase().includes(normalizedSearch));
  });
  return <section className="manage-view bills-view">
    <div className="manage-head"><div><p className="eyebrow">BILLING RECORDS</p><h1>{ui(language, "Bills")}</h1><p>Find, review and follow up on every invoice.</p></div><div className="bills-head-actions">{(kind === "sales" ? invoices.length > 0 : purchases.length > 0) ? <button type="button" className="bills-download-btn" onClick={() => setShowBulkDownload(true)} aria-label="Download invoices"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg></button> : null}<button type="button" className="bills-trash-btn" onClick={() => setShowTrash(true)} aria-label="Open trash"><Icon name="trash" /></button></div></div>
    {showBulkDownload ? <BulkDownloadModal invoices={kind === "sales" ? invoices : []} purchases={kind === "purchases" ? purchases : []} kind={kind} settings={settings} onClose={() => setShowBulkDownload(false)} /> : null}
    {showTrash ? <TrashModal onClose={() => setShowTrash(false)} /> : null}
    <section className="bill-summary"><div><span>Paid</span><strong>{salesCounts.paid}</strong></div><div><span>Unpaid</span><strong>{salesCounts.unpaid}</strong></div><div><span>Overdue</span><strong>{salesCounts.overdue}</strong></div><div><span>Draft</span><strong>{salesCounts.draft}</strong></div></section>
    <div className="filter-tabs bill-kind-tabs"><button className={kind === "sales" ? "active" : ""} onClick={() => setKind("sales")}>Sales invoices</button><button className={kind === "purchases" ? "active" : ""} onClick={() => setKind("purchases")}>Supplier invoices</button></div>
    <label className="bill-search"><span className="sr-only">Search bills</span><Icon name="history" /><input aria-label="Search bills" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name or invoice number" /></label>
    {kind === "sales" ? <div className="filter-tabs bill-status-tabs" aria-label="Invoice status filter">{(["all", "paid", "unpaid", "overdue"] as const).map((status) => <button key={status} className={salesFilter === status ? "active" : ""} onClick={() => setSalesFilter(status)}>{status[0]?.toUpperCase()}{status.slice(1)}</button>)}</div> : <div className="filter-tabs purchase-status-tabs" aria-label="Supplier document type filter"><button className={purchaseFilter === "all" ? "active" : ""} onClick={() => setPurchaseFilter("all")}>{ui(language, "All")}</button><button className={purchaseFilter === "orders" ? "active" : ""} onClick={() => setPurchaseFilter("orders")}>Purchase Orders</button><button className={purchaseFilter === "delivered" ? "active" : ""} onClick={() => setPurchaseFilter("delivered")}>Delivered</button></div>}
    {kind === "sales" ? (visibleInvoices.length ? <div className="invoice-list structured-invoice-list">{visibleInvoices.map((invoice) => {
      const overdue = isOverdue(invoice); const status = overdue ? "overdue" : invoice.payment_status;
      return <article className={`history-invoice-row ${status}`} key={invoice.id}><button type="button" className="history-contact-avatar" onClick={() => onOpenContact(invoice.customer_id)} aria-label={`View ${invoice.customer_name} history`}><ContactAvatar name={invoice.customer_name} kind="customer" contactKey={String(invoice.customer_id)} /></button><button className="invoice-main" onClick={() => onOpen(invoice.id)}><span className="invoice-customer"><strong>{invoice.customer_name}</strong><small>{invoice.invoice_number} · {invoice.issue_date}{invoice.due_date ? ` · due ${invoice.due_date}` : ""}</small></span><span className="invoice-amount"><strong>{money(invoice.total, invoice.currency)}</strong><small className={`mini-status ${status}`}>{status}</small></span><span className="chevron">›</span></button>{overdue ? <button className="reminder-button" disabled={!whatsappDigits(invoice.customer_phone)} onClick={() => openWhatsAppReminder(invoice, settings.business_name, language)}><Icon name="whatsapp" />{whatsappDigits(invoice.customer_phone) ? "Send Reminder on WhatsApp" : "WhatsApp number missing"}</button> : null}</article>;
    })}</div> : <Empty title="No matching invoices" body="Try a different search or status filter." />) : (visiblePurchases.length ? <div className="invoice-list structured-invoice-list">{visiblePurchases.map((purchase) => <article className="history-invoice-row" key={purchase.id}><button type="button" className="history-contact-avatar" onClick={() => onOpenContact(purchase.supplier_id)} aria-label={`View ${purchase.supplier_name} history`}><ContactAvatar name={purchase.supplier_name} kind="supplier" contactKey={String(purchase.supplier_id)} /></button><button className="invoice-main" onClick={() => onOpenPurchase(purchase.id)}><span className="invoice-customer"><strong>{purchase.supplier_name}</strong><small>{purchase.document_type === "purchase_order" ? "Purchase Order" : "Delivered Purchase"} · {purchase.purchase_number} · {purchase.issue_date}{purchase.due_date ? ` · due ${purchase.due_date}` : ""}</small></span><span className="invoice-amount"><strong>{money(purchase.total, purchase.currency)}</strong><small className={`mini-status ${purchase.delivery_status === "pending" ? "pending-delivery" : purchase.payment_status}`}>{purchase.delivery_status === "pending" ? "Pending delivery" : purchase.payment_status}</small></span><span className="chevron">›</span></button></article>)}</div> : <Empty title="No matching supplier invoices" body="Try a different search." />)}
  </section>;
}

