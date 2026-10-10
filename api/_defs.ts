// Shared action contracts for Daybill (Vercel port).
//
// Request/response zod schemas extracted VERBATIM from the canonical
// artifact server/src/actions.ts. This module is browser-safe (zod only):
// the web client imports it for types, the API imports it for validation.
import { z } from "zod";

const sessionKindSchema = z.enum(["user", "admin"]);
const notificationShape = z.object({
  id: z.number(),
  type: z.string(),
  title: z.string(),
  message: z.string(),
  is_read: z.boolean(),
  created_at: z.string(),
});

const authFields = {
  account_id: z.number().int().positive(),
  session_token: z.string().min(20).max(200),
  session_kind: sessionKindSchema,
};

const phoneSchema = z.string().regex(/^03\d{2}-\d{7}$/, "Use the local 0300-0000000 format").transform((value) => `92${value.replace(/\D/g, "").slice(1)}`);
const adminEmailSchema = z.string().trim().toLowerCase().email().max(254);
const adminPasswordSchema = z.string().min(10, "Use at least 10 characters").max(128);

const settingsShape = z.object({
  business_name: z.string(),
  phone: z.string(),
  address: z.string(),
  currency: z.string(),
  accent_color: z.string(),
  logo_url: z.string().nullable(),
  avatar_choice: z.string().optional(),
  bank_name: z.string().optional(),
  bank_account_title: z.string().optional(),
  bank_account_number: z.string().optional(),
  bank_iban: z.string().optional(),
});

const contactShape = z.object({
  id: z.number(),
  name: z.string(),
  phone: z.string(),
  address: z.string(),
  kind: z.enum(["customer", "supplier"]),
});

const productShape = z.object({
  id: z.number(),
  name: z.string(),
  unit: z.string(),
  unit_price: z.number(),
  unit_cost: z.number(),
  stock_quantity: z.number(),
  supplier_id: z.number().nullable(),
  supplier_name: z.string().nullable(),
  brand: z.string().optional(),
  product_type: z.string().optional(),
  shelf_code: z.string().optional(),
  category: z.string().optional(),
  is_featured: z.boolean().optional(),
  sizes: z.string().optional(),
  image_url: z.string().nullable().optional(),
});

const invoiceSummaryShape = z.object({
  id: z.number(),
  invoice_number: z.string(),
  customer_id: z.number(),
  customer_name: z.string(),
  customer_phone: z.string(),
  customer_address: z.string(),
  issue_date: z.string(),
  due_date: z.string().nullable(),
  payment_status: z.enum(["pending", "paid"]),
  payment_method: z.enum(["card", "cash", "transfer", "credit"]),
  discount_amount: z.number(),
  total: z.number(),
  cost_total: z.number(),
  currency: z.string(),
});

const invoiceDetailShape = z.object({
  id: z.number(),
  invoice_number: z.string(),
  customer_id: z.number(),
  customer_name: z.string(),
  customer_phone: z.string(),
  customer_address: z.string(),
  issue_date: z.string(),
  due_date: z.string().nullable(),
  payment_status: z.enum(["pending", "paid"]),
  payment_method: z.enum(["card", "cash", "transfer", "credit"]),
  discount_type: z.enum(["none", "percentage", "fixed"]),
  discount_value: z.number(),
  discount_amount: z.number(),
  notes: z.string(),
  subtotal: z.number(),
  total: z.number(),
  currency: z.string(),
  items: z.array(z.object({
    id: z.number(),
    description: z.string(),
    unit: z.string(),
    quantity: z.number(),
    unit_price: z.number(),
    line_total: z.number(),
  })),
});

const purchaseSummaryShape = z.object({
  id: z.number(),
  purchase_number: z.string(),
  supplier_id: z.number(),
  supplier_name: z.string(),
  supplier_phone: z.string(),
  supplier_address: z.string(),
  issue_date: z.string(),
  due_date: z.string().nullable(),
  document_type: z.enum(["purchase_order", "delivered_purchase"]),
  delivery_status: z.enum(["pending", "delivered"]),
  payment_status: z.enum(["pending", "paid"]),
  payment_method: z.enum(["card", "cash", "transfer", "credit"]),
  supplier_reference: z.string(),
  total: z.number(),
  currency: z.string(),
});

const trashedInvoiceShape = invoiceSummaryShape.extend({
  delete_reason: z.string(),
  deleted_at: z.string().nullable(),
});

const trashedPurchaseShape = purchaseSummaryShape.extend({
  delete_reason: z.string(),
  deleted_at: z.string().nullable(),
});

const registeredAccountShape = z.object({
  id: z.number(),
  account_holder_name: z.string(),
  phone: z.string(),
  shop_name: z.string(),
  shop_address: z.string(),
  created_at: z.number(),
  invoice_count: z.number(),
  customer_count: z.number(),
  supplier_count: z.number(),
});

const feedbackShape = z.object({
  id: z.number(),
  account_id: z.number(),
  sender_name: z.string(),
  shop_name: z.string(),
  phone: z.string(),
  category: z.enum(["bug", "suggestion", "other"]).nullable(),
  message: z.string(),
  created_at: z.number(),
});

const adminDashboardShape = z.object({
  totals: z.object({
    registered_accounts: z.number(),
    invoices: z.number(),
    customers: z.number(),
    suppliers: z.number(),
    feedback: z.number(),
  }),
  accounts: z.array(registeredAccountShape),
  feedback: z.array(feedbackShape),
});

const purchaseDetailShape = z.object({
  id: z.number(),
  purchase_number: z.string(),
  supplier_id: z.number(),
  supplier_name: z.string(),
  supplier_phone: z.string(),
  supplier_address: z.string(),
  issue_date: z.string(),
  due_date: z.string().nullable(),
  document_type: z.enum(["purchase_order", "delivered_purchase"]),
  delivery_status: z.enum(["pending", "delivered"]),
  payment_status: z.enum(["pending", "paid"]),
  payment_method: z.enum(["card", "cash", "transfer", "credit"]),
  supplier_reference: z.string(),
  notes: z.string(),
  total: z.number(),
  currency: z.string(),
  items: z.array(z.object({
    id: z.number(),
    product_id: z.number(),
    description: z.string(),
    unit: z.string(),
    quantity: z.number(),
    unit_cost: z.number(),
    line_total: z.number(),
  })),
});


type ActionDef = { request: z.ZodTypeAny; response: z.ZodTypeAny };

export const actionDefs = {
  getAdminLoginStatus: {
    request: z.object({ email: adminEmailSchema }),
    response: z.object({ recognized: z.boolean(), setup_required: z.boolean() }),
  },
  adminLogin: {
    request: z.object({
      email: adminEmailSchema,
      password: adminPasswordSchema,
      confirm_password: z.string().max(128).nullable(),
    }),
    response: z.object({
      account_id: z.number(),
      session_token: z.string(),
      session_kind: z.literal("admin"),
      shopkeeper_name: z.string(),
      phone: z.string(),
    }),
  },
  createAccount: {
    request: z.object({
      shopkeeper_name: z.string().trim().min(2).max(120),
      shop_name: z.string().trim().min(2).max(120),
      shop_address: z.string().trim().min(3).max(300),
      phone: phoneSchema,
      pin: z.string().regex(/^\d{4}$/, "PIN must be exactly 4 digits"),
      otp_code: z.string().regex(/^\d{3,8}$/, "Invalid verification code"),
    }),
    response: z.object({ account_id: z.number(), session_token: z.string(), session_kind: z.literal("user"), shopkeeper_name: z.string(), phone: z.string(), claimed_existing_data: z.boolean() }),
  },
  login: {
    request: z.object({ phone: phoneSchema, pin: z.string().regex(/^\d{4}$/) }),
    response: z.object({ account_id: z.number(), session_token: z.string(), session_kind: z.literal("user"), shopkeeper_name: z.string(), phone: z.string() }),
  },
  sendOtpCode: {
    request: z.object({ phone: phoneSchema }),
    response: z.object({ sent: z.literal(true), expires_at: z.string() }),
  },
  resetPin: {
    request: z.object({
      phone: phoneSchema,
      new_pin: z.string().regex(/^\d{4}$/, "PIN must be exactly 4 digits"),
      otp_code: z.string().regex(/^\d{3,8}$/, "Invalid verification code"),
    }),
    response: z.object({ ok: z.literal(true) }),
  },
  getAdminDashboard: {
    request: z.object({ ...authFields }),
    response: adminDashboardShape,
  },
  submitFeedback: {
    request: z.object({
      ...authFields,
      category: z.enum(["bug", "suggestion", "other"]).nullable(),
      message: z.string().trim().min(5, "Please write at least 5 characters").max(1000, "Feedback must be 1,000 characters or less"),
    }),
    response: z.object({ ok: z.literal(true) }),
  },
  getWorkspace: {
    request: z.object({ ...authFields }),
    response: z.object({
      account: z.object({ shopkeeper_name: z.string(), phone: z.string(), is_owner: z.boolean(), admin_email: z.string().nullable(), session_kind: sessionKindSchema }),
      settings: settingsShape,
      contacts: z.array(contactShape),
      products: z.array(productShape),
      invoices: z.array(invoiceSummaryShape),
      purchases: z.array(purchaseSummaryShape),
      dashboard: z.object({
        revenue: z.number(),
        cost: z.number(),
        profit: z.number(),
        outstanding: z.number(),
        payables: z.number(),
        purchases: z.number(),
        low_stock_count: z.number(),
      }),
    }),
  },
  saveSettings: {
    request: z.object({
      ...authFields,
      business_name: z.string().trim().min(1).max(120),
      phone: z.string().trim().max(40),
      address: z.string().trim().max(300),
      currency: z.string().trim().min(3).max(6),
      accent_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
      avatar_choice: z.string().trim().max(20).optional(),
      bank_name: z.string().trim().max(120).optional(),
      bank_account_title: z.string().trim().max(120).optional(),
      bank_account_number: z.string().trim().max(60).optional(),
      bank_iban: z.string().trim().max(60).optional(),
    }),
    response: z.object({ ok: z.literal(true) }),
  },
  uploadLogo: {
    request: z.object({
      ...authFields,
      data_base64: z.string().min(1).max(6_000_000),
      mime_type: z.enum(["image/jpeg", "image/png"]),
    }),
    response: z.object({ logo_url: z.string() }),
  },
  saveContact: {
    request: z.object({
      ...authFields,
      id: z.number().int().positive().optional(),
      name: z.string().trim().min(1).max(120),
      phone: z.string().trim().max(40),
      address: z.string().trim().max(300),
      kind: z.enum(["customer", "supplier"]),
    }),
    response: z.object({ id: z.number() }),
  },
  archiveContact: {
    request: z.object({
      ...authFields, id: z.number().int().positive() }),
    response: z.object({ ok: z.literal(true) }),
  },
  saveProduct: {
    request: z.object({
      ...authFields,
      id: z.number().int().positive().optional(),
      name: z.string().trim().min(1).max(120),
      unit: z.string().trim().min(1).max(30),
      unit_price: z.number().int().nonnegative().max(100_000_000_000),
      unit_cost: z.number().int().nonnegative().max(100_000_000_000),
      stock_quantity: z.number().int().nonnegative().max(100_000_000),
      supplier_id: z.number().int().positive().nullable(),
      brand: z.string().trim().max(80).optional(),
      product_type: z.string().trim().max(60).optional(),
      shelf_code: z.string().trim().max(40).optional(),
      category: z.string().trim().max(60).optional(),
      is_featured: z.boolean().optional(),
      sizes: z.string().trim().max(120).optional(),
      image_data_base64: z.string().max(6_000_000).optional(),
      image_mime_type: z.enum(["image/jpeg", "image/png"]).optional(),
    }),
    response: z.object({ id: z.number() }),
  },
  archiveProduct: {
    request: z.object({
      ...authFields, id: z.number().int().positive() }),
    response: z.object({ ok: z.literal(true) }),
  },
  createInvoice: {
    request: z.object({
      ...authFields,
      customer_id: z.number().int().positive(),
      issue_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
      payment_method: z.enum(["card", "cash", "transfer", "credit"]),
      discount_type: z.enum(["none", "percentage", "fixed"]),
      discount_value: z.number().int().nonnegative().max(100_000_000_000),
      notes: z.string().trim().max(500),
      items: z.array(z.object({
        product_id: z.number().int().positive(),
        quantity: z.number().int().positive().max(100_000),
      })).min(1).max(100),
    }),
    response: z.object({ id: z.number(), invoice_number: z.string() }),
  },
  createPurchaseInvoice: {
    request: z.object({
      ...authFields,
      supplier_id: z.number().int().positive(),
      document_type: z.enum(["purchase_order", "delivered_purchase"]),
      issue_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
      payment_method: z.enum(["card", "cash", "transfer", "credit"]),
      payment_status: z.enum(["pending", "paid"]),
      supplier_reference: z.string().trim().max(120),
      notes: z.string().trim().max(500),
      items: z.array(z.object({
        product_id: z.number().int().positive(),
        quantity: z.number().int().positive().max(100_000),
        unit_cost: z.number().int().nonnegative().max(100_000_000_000),
      })).min(1).max(100),
    }),
    response: z.object({ id: z.number(), purchase_number: z.string() }),
  },
  markPurchaseDelivered: {
    request: z.object({ ...authFields, id: z.number().int().positive() }),
    response: z.object({ ok: z.literal(true), already_delivered: z.boolean() }),
  },
  setPurchasePaymentStatus: {
    request: z.object({
      ...authFields, id: z.number().int().positive(), status: z.enum(["pending", "paid"]) }),
    response: z.object({ ok: z.literal(true) }),
  },
  getPurchaseInvoice: {
    request: z.object({
      ...authFields, id: z.number().int().positive() }),
    response: z.object({ purchase: purchaseDetailShape }),
  },
  setInvoicePaymentStatus: {
    request: z.object({
      ...authFields, id: z.number().int().positive(), status: z.enum(["pending", "paid"]) }),
    response: z.object({ ok: z.literal(true) }),
  },
  getInvoice: {
    request: z.object({
      ...authFields, id: z.number().int().positive() }),
    response: z.object({ invoice: invoiceDetailShape }),
  },
  trashInvoice: {
    request: z.object({
      ...authFields,
      invoice_id: z.number().int().positive(),
      pin: z.string().regex(/^\d{4}$/, "PIN must be exactly 4 digits"),
      reason: z.string().trim().min(3, "Please give a reason").max(300),
    }),
    response: z.object({ ok: z.literal(true) }),
  },
  trashPurchase: {
    request: z.object({
      ...authFields,
      purchase_id: z.number().int().positive(),
      pin: z.string().regex(/^\d{4}$/, "PIN must be exactly 4 digits"),
      reason: z.string().trim().min(3, "Please give a reason").max(300),
    }),
    response: z.object({ ok: z.literal(true) }),
  },
  listTrashed: {
    request: z.object({
      ...authFields,
      pin: z.string().regex(/^\d{4}$/, "PIN must be exactly 4 digits"),
    }),
    response: z.object({
      invoices: z.array(trashedInvoiceShape),
      purchases: z.array(trashedPurchaseShape),
    }),
  },
  restoreInvoice: {
    request: z.object({
      ...authFields,
      invoice_id: z.number().int().positive(),
      pin: z.string().regex(/^\d{4}$/, "PIN must be exactly 4 digits"),
    }),
    response: z.object({ ok: z.literal(true) }),
  },
  restorePurchase: {
    request: z.object({
      ...authFields,
      purchase_id: z.number().int().positive(),
      pin: z.string().regex(/^\d{4}$/, "PIN must be exactly 4 digits"),
    }),
    response: z.object({ ok: z.literal(true) }),
  },
  deleteInvoiceForever: {
    request: z.object({
      ...authFields,
      invoice_id: z.number().int().positive(),
      pin: z.string().regex(/^\d{4}$/, "PIN must be exactly 4 digits"),
    }),
    response: z.object({ ok: z.literal(true) }),
  },
  deletePurchaseForever: {
    request: z.object({
      ...authFields,
      purchase_id: z.number().int().positive(),
      pin: z.string().regex(/^\d{4}$/, "PIN must be exactly 4 digits"),
    }),
    response: z.object({ ok: z.literal(true) }),
  },
  listNotifications: {
    request: z.object({ ...authFields }),
    response: z.object({
      notifications: z.array(notificationShape),
      unreadCount: z.number(),
    }),
  },
  markNotificationRead: {
    request: z.object({ ...authFields, id: z.number().int().positive() }),
    response: z.object({ ok: z.literal(true) }),
  },
  markAllNotificationsRead: {
    request: z.object({ ...authFields }),
    response: z.object({ ok: z.literal(true) }),
  },
} satisfies Record<string, ActionDef>;

export type ActionName = keyof typeof actionDefs;
export type ActionRequest<N extends ActionName> = z.input<(typeof actionDefs)[N]["request"]>;
export type ActionResponse<N extends ActionName> = z.output<(typeof actionDefs)[N]["response"]>;
export type Actions = { [N in ActionName]: (args: ActionRequest<N>) => Promise<ActionResponse<N>> };
