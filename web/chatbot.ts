// Daybill Assistant — rule-based chatbot brain.
// Answers app-help questions and account-data questions from workspace data.
// Runs fully client-side: no network, works offline.

export type ChatInvoice = {
  id: number;
  invoice_number: string;
  customer_id: number;
  customer_name: string;
  issue_date: string;
  due_date: string | null;
  payment_status: "pending" | "paid";
  total: number;
  cost_total: number;
};

export type ChatContact = {
  id: number;
  name: string;
  phone: string;
  kind: "customer" | "supplier";
};

export type ChatProduct = {
  id: number;
  name: string;
  unit_price: number;
  stock_quantity: number;
  category?: string;
};

export type ChatPurchase = {
  id: number;
  purchase_number: string;
  supplier_id: number;
  supplier_name: string;
  issue_date: string;
  document_type: "purchase_order" | "delivered_purchase";
  payment_status: "pending" | "paid";
  total: number;
};

export type ChatDashboard = {
  revenue: number;
  cost: number;
  profit: number;
  outstanding: number;
  payables: number;
};

export type ChatContext = {
  invoices: ChatInvoice[];
  contacts: ChatContact[];
  products: ChatProduct[];
  purchases: ChatPurchase[];
  dashboard: ChatDashboard;
  currency: string;
  language: "en" | "ur";
};

type Lang = "en" | "ur";

const norm = (s: string) =>
  s.toLowerCase().replace(/[؟?.,!،]/g, " ").replace(/\s+/g, " ").trim();

function money(n: number, currency: string) {
  return `${currency} ${Math.round(n / 100).toLocaleString("en-PK")}`;
}

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function invoicesThisMonth(ctx: ChatContext) {
  const mk = monthKey(new Date());
  return ctx.invoices.filter((i) => i.issue_date.slice(0, 7) === mk);
}

// ---- name matching ----
function findContact(ctx: ChatContext, q: string): ChatContact | null {
  const nq = norm(q);
  const cands = ctx.contacts.filter((c) => c.kind === "customer");
  // longest name match wins
  let best: ChatContact | null = null;
  for (const c of cands) {
    const nm = norm(c.name);
    if (nm.length >= 3 && nq.includes(nm)) {
      if (!best || nm.length > norm(best.name).length) best = c;
    }
  }
  return best;
}

function findSupplier(ctx: ChatContext, q: string): ChatContact | null {
  const nq = norm(q);
  const cands = ctx.contacts.filter((c) => c.kind === "supplier");
  let best: ChatContact | null = null;
  for (const c of cands) {
    const nm = norm(c.name);
    if (nm.length >= 3 && nq.includes(nm)) {
      if (!best || nm.length > norm(best.name).length) best = c;
    }
  }
  return best;
}

function findProduct(ctx: ChatContext, q: string): ChatProduct | null {
  const nq = norm(q);
  let best: ChatProduct | null = null;
  for (const p of ctx.products) {
    const nm = norm(p.name);
    if (nm.length >= 3 && nq.includes(nm)) {
      if (!best || nm.length > norm(best.name).length) best = p;
    }
  }
  return best;
}

// ---- help knowledge base ----
type HelpEntry = { keys: string[]; en: string; ur: string; roman?: string };

const HELP: HelpEntry[] = [
  {
    keys: ["add product", "add a product", "new product", "create product", "create a product", "product add", "add item", "add an item", "new item"],
    en: "To add a product: go to Stock (sidebar) → tap New Product → fill name, price, cost and opening stock → Save. If you add a supplier + opening stock, a purchase invoice is created automatically.",
    ur: "پروڈکٹ شامل کرنے کے لیے: سائڈبار میں Stock پر جائیں → New Product دبائیں → نام، قیمت اور اسٹاک لکھیں → Save کریں۔",
  },
  {
    keys: ["create invoice", "create an invoice", "new invoice", "make invoice", "make an invoice", "make bill", "make a bill", "new bill", "billing"],
    en: "To create an invoice: tap Create (sidebar) → choose Sales invoice → pick a customer (Step 1) → add products (Step 2) → review and Save (Step 3). You can then share it on WhatsApp as an image.",
    ur: "انوائس بنانے کے لیے: Create دبائیں → Sales invoice منتخب کریں → کسٹمر چنیں → پروڈکٹس شامل کریں → Save کریں۔",
  },
  {
    keys: ["add customer", "add a customer", "new customer", "create customer", "create a customer", "customer add"],
    en: "To add a customer: go to Contacts (sidebar) → tap Add → choose Customer → enter name and phone → Save. You can also add one while creating an invoice via 'Add customer'.",
    ur: "کسٹمر شامل کرنے کے لیے: Contacts میں جائیں → Add دبائیں → Customer منتخب کریں → نام اور فون لکھیں → Save کریں۔",
  },
  {
    keys: ["add supplier", "add a supplier", "new supplier", "supplier add", "create supplier", "create a supplier"],
    en: "To add a supplier: go to Contacts → tap Add → choose Supplier → enter name and phone → Save.",
    ur: "سپلائر شامل کرنے کے لیے: Contacts میں جائیں → Add دبائیں → Supplier منتخب کریں → نام اور فون لکھیں → Save کریں۔",
  },
  {
    keys: ["purchase", "supplier invoice", "supplier bill", "stock in", "buy stock"],
    en: "To record a supplier purchase: tap Create → choose Supplier invoice → pick the supplier → add products with cost → save as Purchase Order or Delivered Purchase. Only delivered purchases count toward payables and add stock.",
    ur: "سپلائر سے خریداری ریکارڈ کرنے کے لیے: Create → Supplier invoice → سپلائر چنیں → پروڈکٹس شامل کریں → Delivered Purchase کے طور پر محفوظ کریں۔",
  },
  {
    keys: ["mark paid", "mark as paid", "paid invoice", "payment received", "receive payment"],
    en: "To mark an invoice paid: go to Bills → open the invoice → tap 'Mark as paid'. Pending dues on your Overview will update automatically.",
    ur: "انوائس کو paid کرنے کے لیے: Bills میں جائیں → انوائس کھولیں → 'Mark as paid' دبائیں۔",
  },
  {
    keys: ["whatsapp", "share invoice", "send invoice"],
    en: "To share an invoice on WhatsApp: open the invoice → tap Share → WhatsApp. It sends as an invoice image (never as plain text).",
    ur: "انوائس WhatsApp پر بھیجنے کے لیے: انوائس کھولیں → Share → WhatsApp دبائیں۔ یہ تصویر کے طور پر بھیجے گی۔",
  },
  {
    keys: ["qr", "qr code", "scan to pay", "online payment", "bank", "iban", "raast"],
    en: "To show a payment QR on invoices: go to Profile → Payment account → add your bank name, account title and IBAN → Save. The QR then appears on every invoice so customers can scan and pay.",
    ur: "انوائس پر QR دکھانے کے لیے: Profile → Payment account میں بینک اور IBAN شامل کریں → Save کریں۔",
  },
  {
    keys: ["logo", "shop logo", "avatar", "profile picture"],
    en: "To add your shop logo: go to Profile → Edit shop details → upload your logo (or pick an avatar). It appears on your invoices and profile.",
    ur: "دکان کا لوگو لگانے کے لیے: Profile → Edit shop details → لوگو اپ لوڈ کریں۔",
  },
  {
    keys: ["dark mode", "dark theme", "light mode", "theme", "mode switch"],
    en: "To switch theme: tap the moon/sun button in the top-right corner of the header (before the notification bell).",
    ur: "تھیم بدلنے کے لیے: اوپر دائیں کونے میں چاند/سورج کا بٹن دبائیں۔",
  },
  {
    keys: ["urdu", "language", "english", "zuban", "bhasha"],
    en: "To change language: go to Profile → Language → choose English or اردو.",
    ur: "زبان بدلنے کے لیے: Profile → Language میں English یا اردو منتخب کریں۔",
  },
  {
    keys: ["feedback", "bug", "suggestion", "report", "problem", "help center"],
    en: "To send feedback: open the sidebar → tap Help near the bottom → choose Bug, Suggestion or Other → send. It goes straight to the Daybill team.",
    ur: "فیڈبیک بھیجنے کے لیے: سائڈبار میں نیچے Help دبائیں → Bug یا Suggestion منتخب کریں۔",
  },
  {
    keys: ["discount"],
    en: "To add a discount: while creating an invoice (Step 2/3), use the discount option — you can set a percentage or a fixed amount off the total.",
    ur: "رعایت دینے کے لیے: انوائس بناتے وقت discount کا آپشن استعمال کریں۔",
  },
  {
    keys: ["due date", "payment due", "overdue"],
    en: "You can set a payment due date in Step 1 of creating an invoice. Invoices past their due date show as Overdue in Bills, and the bell icon on Overview lists payment alerts.",
    ur: "انوائس بناتے وقت Step 1 میں واجب الادا تاریخ لگائیں۔ میعاد گزرنے پر انوائس Overdue نظر آئے گی۔",
  },
  {
    keys: ["delete", "remove"],
    en: "To delete: open the item (product, invoice, contact) and use the delete/trash option. Deleted sales invoices also restore the stock they had used.",
    ur: "حذف کرنے کے لیے: متعلقہ آئٹم کھولیں اور delete کا آپشن استعمال کریں۔",
  },
  {
    keys: ["category", "featured"],
    en: "You can organize products with Category and mark special ones as ★ Featured when creating or editing a product in Stock. Use the filter chips on the Stock page to browse by category.",
    ur: "پروڈکٹس کو Category دیں اور خاص پروڈکٹس کو ★ Featured نشان زد کریں۔",
  },
  {
    keys: ["backup", "data safe", "lose data"],
    en: "Your data is stored securely in the cloud under your account — it stays even if you change phones. Just log in with your phone number on the new device.",
    ur: "آپ کا ڈیٹا آپ کے اکاؤنٹ کے ساتھ کلاؤڈ میں محفوظ ہے — فون بدلنے پر بھی رہے گا۔",
  },
  {
    keys: ["kitny product", "kitne product", "kam stock", "se kam", "stock kam", "inventory ma"],
    en: "",
    ur: "",
    roman: "stock_low",
  },
  {
    keys: ["pese", "paisa", "udhaar", "udhar", "baqaya", "kon deta", "kis ne dena"],
    en: "",
    ur: "",
    roman: "dues",
  },
  {
    keys: ["kamai", "aamdani", "income", "kitni kamai", "is mahine"],
    en: "",
    ur: "",
    roman: "revenue",
  },
  {
    keys: ["munafa", "faida", "profit"],
    en: "",
    ur: "",
    roman: "profit",
  },
  {
    keys: ["product kese", "product kaise", "naya product", "saman kese"],
    en: "",
    ur: "",
    roman: "add_product",
  },
  {
    keys: ["bill kese", "bill kaise", "invoice kese", "invoice kaise", "parchi"],
    en: "",
    ur: "",
    roman: "create_invoice",
  },
];

const ROMAN_ANSWERS: Record<string, { en: string; ur: string }> = {
  stock_low: {
    en: "To check low stock, ask me like: 'kitny products 30 se kam hn?' and I'll list them.",
    ur: "کم اسٹاک چیک کرنے کے لیے پوچھیں: 'کتنے پروڈکٹس 30 سے کم ہیں؟'",
  },
  dues: {
    en: "Ask 'kon pese deta hai?' and I'll list who owes you and how much.",
    ur: "'کون پیسے دیتا ہے؟' پوچھیں۔",
  },
  revenue: {
    en: "Ask 'is mahine kitni kamai hui?' for this month's collected revenue.",
    ur: "'اس مہینے کتنی کمائی ہوئی؟' پوچھیں۔",
  },
  profit: {
    en: "Ask 'is mahine kitna munafa hua?' for this month's profit.",
    ur: "'اس مہینے کتنا منافع ہوا؟' پوچھیں۔",
  },
  add_product: {
    en: "Product add karne ke liye: sidebar me Stock → New Product → naam, qeemat aur stock likhein → Save.",
    ur: "پروڈکٹ شامل کرنے کے لیے: Stock → New Product → نام، قیمت اور اسٹاک لکھیں → Save کریں۔",
  },
  create_invoice: {
    en: "Bill banane ke liye: Create dabayein → Sales invoice → customer chunein → products add karein → Save.",
    ur: "انوائس بنانے کے لیے: Create → Sales invoice → کسٹمر چنیں → پروڈکٹس شامل کریں → Save کریں۔",
  },
};

const FALLBACK = {
  en: "I can help with using Daybill and with your shop's numbers. Try asking things like:\n• How do I add a product?\n• Is Fajar's invoice paid?\n• Total revenue this month?\n• Stock of Sugar?\n• Who owes me money?",
  ur: "میں Daybill کے استعمال اور آپ کی دکان کے حساب کتاب میں مدد کر سکتا ہوں۔ مثلاً پوچھیں:\n• پروڈکٹ کیسے شامل کروں؟\n• فجر کا انوائس paid ہے؟\n• اس مہینے کی آمدنی؟",
};

const GREETINGS = ["hello", "hi", "hey", "salam", "assalam", "aoa", "aoa,"];
const THANKS = ["thanks", "thank", "shukria", "shukriya", "meherbani"];

// ---- main answer function ----
export function answerQuestion(raw: string, ctx: ChatContext): string {
  const lang: Lang = ctx.language === "ur" ? "ur" : "en";
  const q = norm(raw);
  if (!q) return lang === "ur" ? "کچھ پوچھیں؟" : "Ask me something?";

  // greetings
  if (GREETINGS.some((g) => q === g || q.startsWith(g + " "))) {
    return lang === "ur"
      ? "السلام علیکم! میں Daybill اسسٹنٹ ہوں۔ ایپ کے استعمال یا آپ کی دکان کے حساب کے بارے میں پوچھیں۔"
      : "Hello! I'm the Daybill assistant. Ask me how to use the app, or about your shop's numbers — like revenue, dues, or stock.";
  }
  if (THANKS.some((t) => q.includes(t))) {
    return lang === "ur" ? "خوش آمدید! اور کچھ پوچھنا ہو تو بتائیں۔" : "You're welcome! Ask me anything else.";
  }

  // ---- data questions first (they're more specific) ----

  // customer invoice paid?
  const contact = findContact(ctx, q);
  const paidWords = ["paid", "pay", "clear", "settle"];
  const unpaidWords = ["pending", "unpaid", "due", "owe", "owes", "udhaar"];
  if (contact && (paidWords.some((w) => q.includes(w)) || unpaidWords.some((w) => q.includes(w)) || q.includes("invoice"))) {
    const invs = ctx.invoices
      .filter((i) => i.customer_id === contact.id)
      .sort((a, b) => b.issue_date.localeCompare(a.issue_date));
    if (!invs.length) {
      return lang === "ur"
        ? `${contact.name} کا کوئی انوائس نہیں ملا۔`
        : `No invoices found for ${contact.name}.`;
    }
    const lines = invs.slice(0, 5).map(
      (i) => `• ${i.invoice_number} (${i.issue_date}): ${money(i.total, ctx.currency)} — ${i.payment_status === "paid" ? (lang === "ur" ? "ادا شدہ ✓" : "PAID ✓") : (lang === "ur" ? "باقی ⏳" : "PENDING ⏳")}`
    );
    const unpaid = invs.filter((i) => i.payment_status !== "paid");
    const head =
      lang === "ur"
        ? `${contact.name} کے ${invs.length} انوائس:`
        : `${contact.name} — ${invs.length} invoice(s):`;
    const tail =
      unpaid.length && lang === "en"
        ? `\nUnpaid total: ${money(unpaid.reduce((s, i) => s + i.total, 0), ctx.currency)}`
        : unpaid.length
          ? `\nباقی رقم: ${money(unpaid.reduce((s, i) => s + i.total, 0), ctx.currency)}`
          : lang === "ur" ? "\nسب ادا شدہ ہیں ✓" : "\nAll paid ✓";
    return head + "\n" + lines.join("\n") + tail;
  }

  // supplier payables for a named supplier
  const supplier = findSupplier(ctx, q);
  if (supplier && (q.includes("payable") || q.includes("owe") || q.includes("due") || q.includes("pending") || q.includes("bill"))) {
    const ps = ctx.purchases.filter(
      (p) => p.supplier_id === supplier.id && p.document_type === "delivered_purchase" && p.payment_status !== "paid"
    );
    const total = ps.reduce((s, p) => s + p.total, 0);
    return lang === "ur"
      ? `${supplier.name} کو ${money(total, ctx.currency)} واجب الادا ہیں (${ps.length} خریداری)۔`
      : `You owe ${supplier.name} ${money(total, ctx.currency)} across ${ps.length} delivered purchase(s).`;
  }

  // revenue — incl. Roman Urdu "is mahine kitni kamai"
  if (q.includes("revenue") || q.includes("sales total") || q.includes("kamai") || q.includes("aamdani") || q.includes("income") || (q.includes("total") && q.includes("sale"))) {
    const m = invoicesThisMonth(ctx).filter((i) => i.payment_status === "paid");
    const sum = m.reduce((s, i) => s + i.total, 0);
    return lang === "ur"
      ? `اس مہینے کی وصول شدہ آمدنی: ${money(sum, ctx.currency)} (${m.length} ادا شدہ انوائس)۔\nکل آمدنی (تمام وقت): ${money(ctx.dashboard.revenue, ctx.currency)}۔`
      : `Revenue collected this month: ${money(sum, ctx.currency)} (${m.length} paid invoices).\nAll-time revenue: ${money(ctx.dashboard.revenue, ctx.currency)}.`;
  }

  // profit
  if (q.includes("profit") || q.includes("munafa") || q.includes("faida") || q.includes("nafa")) {
    const m = invoicesThisMonth(ctx).filter((i) => i.payment_status === "paid");
    const rev = m.reduce((s, i) => s + i.total, 0);
    const cost = m.reduce((s, i) => s + i.cost_total, 0);
    return lang === "ur"
      ? `اس مہینے کا منافع: ${money(rev - cost, ctx.currency)} (آمدنی ${money(rev, ctx.currency)} − لاگت ${money(cost, ctx.currency)})۔`
      : `This month's profit: ${money(rev - cost, ctx.currency)} (revenue ${money(rev, ctx.currency)} − cost ${money(cost, ctx.currency)}).`;
  }

  // pending dues / who owes
  if ((q.includes("due") || q.includes("owe") || q.includes("owes") || q.includes("udhaar") || q.includes("udhar") || q.includes("baqaya") || q.includes("pese") || q.includes("paisa") || q.includes("deta hai") || q.includes("dena hai")) && !contact) {
    const unpaid = ctx.invoices.filter((i) => i.payment_status !== "paid");
    if (!unpaid.length) {
      return lang === "ur" ? "کوئی واجب الادا رقم نہیں — سب وصول ہو گیا ✓" : "No pending dues — everything is collected ✓";
    }
    const byCust = new Map<string, number>();
    for (const i of unpaid) byCust.set(i.customer_name, (byCust.get(i.customer_name) ?? 0) + i.total);
    const top = [...byCust.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const lines = top.map(([n, t]) => `• ${n}: ${money(t, ctx.currency)}`);
    return (lang === "ur" ? `کل واجب الادا: ${money(ctx.dashboard.outstanding, ctx.currency)} (${unpaid.length} انوائس)\n` : `Total pending dues: ${money(ctx.dashboard.outstanding, ctx.currency)} (${unpaid.length} invoices)\n`) + lines.join("\n");
  }

  // payables
  if (q.includes("payable") || (q.includes("supplier") && (q.includes("owe") || q.includes("due") || q.includes("pay")))) {
    return lang === "ur"
      ? `سپلائرز کو کل واجب الادا: ${money(ctx.dashboard.payables, ctx.currency)}۔`
      : `Total supplier payables: ${money(ctx.dashboard.payables, ctx.currency)}.`;
  }

  // stock of a product
  const product = findProduct(ctx, q);
  if (product && (q.includes("stock") || q.includes("left") || q.includes("quantity") || q.includes("kitna") || q.includes("available") || q.includes("how much") || q.includes("ands"))) {
    return lang === "ur"
      ? `${product.name} کا اسٹاک: ${product.stock_quantity} یونٹ (قیمت ${money(product.unit_price, ctx.currency)})۔`
      : `${product.name}: ${product.stock_quantity} in stock at ${money(product.unit_price, ctx.currency)} each.`;
  }
  // "is any product quantity below 32" / "30 unit se kam" — parse threshold
  const belowMatch = q.match(/(?:below|under|less than|kam)\s*(\d+)/) || q.match(/(\d+)\s*(?:unit\s*)?se\s*kam/);
  if (belowMatch && (q.includes("product") || q.includes("prduct") || q.includes("prodct") || q.includes("quantity") || q.includes("stock") || q.includes("item") || q.includes("inventory") || q.includes("kitny") || q.includes("kitne"))) {
    const limit = parseInt(belowMatch[1], 10);
    const matches = ctx.products.filter((p) => p.stock_quantity < limit).sort((a, b) => a.stock_quantity - b.stock_quantity);
    if (!matches.length) {
      return lang === "ur"
        ? `کوئی پروڈکٹ ${limit} سے کم اسٹاک میں نہیں ✓`
        : `No products below ${limit} in stock ✓`;
    }
    const lines = matches.slice(0, 10).map((p) => `• ${p.name}: ${p.stock_quantity}`);
    const more = matches.length > 10 ? (lang === "ur" ? `\n...اور ${matches.length - 10} مزید` : `\n...and ${matches.length - 10} more`) : "";
    return (lang === "ur" ? `${limit} سے کم اسٹاک (${matches.length} پروڈکٹس):\n` : `Products below ${limit} in stock (${matches.length}):\n`) + lines.join("\n") + more;
  }
  // low stock
  if (q.includes("low stock") || (q.includes("stock") && (q.includes("low") || q.includes("kam") || q.includes("finish")))) {
    const low = ctx.products.filter((p) => p.stock_quantity <= 5).sort((a, b) => a.stock_quantity - b.stock_quantity).slice(0, 8);
    if (!low.length) return lang === "ur" ? "کوئی پروڈکٹ کم اسٹاک میں نہیں ✓" : "No low-stock products ✓";
    return (lang === "ur" ? "کم اسٹاک والے پروڈکٹس:\n" : "Low-stock products:\n") +
      low.map((p) => `• ${p.name}: ${p.stock_quantity}`).join("\n");
  }

  // counts — English, Roman Urdu (kitny/kitne), Urdu (کتنے)
  const isCountQ = q.includes("how many") || q.includes("kitny") || q.includes("kitne") || q.includes("کتنے");
  const isBelowQ = q.includes("se kam") || q.includes("below") || q.includes("under") || q.includes("less than");
  if (isCountQ && !isBelowQ && (q.includes("customer") || q.includes("gahak") || q.includes("کسٹمر"))) {
    const n = ctx.contacts.filter((c) => c.kind === "customer").length;
    if (q.includes("kitny") || q.includes("kitne")) return `Apke pas kul ${n} customers hn.`;
    return lang === "ur" ? `کل ${n} کسٹمر ہیں۔` : `You have ${n} customers.`;
  }
  if (isCountQ && !isBelowQ && (q.includes("product") || q.includes("inventory") || q.includes("stock") || q.includes("پروڈکٹ"))) {
    const n = ctx.products.length;
    if (q.includes("kitny") || q.includes("kitne")) return `Apki inventory ma kul ${n} products hn.`;
    return lang === "ur" ? `کل ${n} پروڈکٹس ہیں۔` : `You have ${n} products.`;
  }
  if (isCountQ && !isBelowQ && (q.includes("invoice") || q.includes("bill") || q.includes("انوائس"))) {
    const n = ctx.invoices.length;
    if (q.includes("kitny") || q.includes("kitne")) return `Kul ${n} invoices hn.`;
    return lang === "ur" ? `کل ${n} انوائس ہیں۔` : `You have ${n} invoices.`;
  }
  if (isCountQ && !isBelowQ && (q.includes("supplier") || q.includes("سپلائر"))) {
    const n = ctx.contacts.filter((c) => c.kind === "supplier").length;
    if (q.includes("kitny") || q.includes("kitne")) return `Apke pas kul ${n} suppliers hn.`;
    return lang === "ur" ? `کل ${n} سپلائر ہیں۔` : `You have ${n} suppliers.`;
  }

  // top customer
  if (q.includes("top customer") || q.includes("best customer")) {
    const byCust = new Map<string, number>();
    for (const i of ctx.invoices) byCust.set(i.customer_name, (byCust.get(i.customer_name) ?? 0) + i.total);
    const top = [...byCust.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!top) return lang === "ur" ? "ابھی کوئی انوائس نہیں۔" : "No invoices yet.";
    return lang === "ur"
      ? `سب سے بڑا کسٹمر: ${top[0]} (${money(top[1], ctx.currency)} کی خریداری)۔`
      : `Top customer: ${top[0]} (${money(top[1], ctx.currency)} in purchases).`;
  }

  // ---- help knowledge base ----
  for (const entry of HELP) {
    if (entry.keys.some((k) => k && q.includes(k))) {
      if (entry.roman && ROMAN_ANSWERS[entry.roman]) {
        // Roman Urdu question — answer in Roman Urdu style (English letters)
        return ROMAN_ANSWERS[entry.roman].en;
      }
      return lang === "ur" ? entry.ur : entry.en;
    }
  }

  return lang === "ur" ? FALLBACK.ur : FALLBACK.en;
}

export const QUICK_CHIPS: { en: string; ur: string }[] = [
  { en: "How do I add a product?", ur: "پروڈکٹ کیسے شامل کروں؟" },
  { en: "Total revenue this month?", ur: "اس مہینے کی آمدنی؟" },
  { en: "Who owes me money?", ur: "کون پیسے دیتا ہے؟" },
  { en: "How do I share on WhatsApp?", ur: "WhatsApp پر کیسے بھیجوں؟" },
];
