// Daybill schema for Postgres (Vercel port).
//
// Direct port of the canonical artifact server/src/schema.ts
// (drizzle-orm/sqlite-core) to drizzle-orm/pg-core. Same 9 tables, same
// columns, same defaults, same enum value sets (as Postgres enums, matching
// the sqlite TEXT+CHECK columns the artifact used).
import { boolean, integer, pgEnum, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const feedbackCategoryEnum = pgEnum("feedback_category", ["bug", "suggestion", "other"]);
export const contactKindEnum = pgEnum("contact_kind", ["customer", "supplier"]);
export const paymentStatusEnum = pgEnum("payment_status", ["pending", "paid"]);
export const paymentMethodEnum = pgEnum("payment_method", ["card", "cash", "transfer", "credit"]);
export const discountTypeEnum = pgEnum("discount_type", ["none", "percentage", "fixed"]);
export const documentTypeEnum = pgEnum("document_type", ["purchase_order", "delivered_purchase"]);
export const deliveryStatusEnum = pgEnum("delivery_status", ["pending", "delivered"]);

export const accounts = pgTable("accounts", {
  id: serial("id").primaryKey(),
  shopkeeperName: text("shopkeeper_name").notNull().default(""),
  phone: text("phone").unique(),
  pinSalt: text("pin_salt"),
  pinHash: text("pin_hash"),
  sessionToken: text("session_token"),
  claimed: boolean("claimed").notNull().default(false),
  isOwner: boolean("is_owner").notNull().default(false),
  adminEmail: text("admin_email").unique(),
  adminPasswordSalt: text("admin_password_salt"),
  adminPasswordHash: text("admin_password_hash"),
  adminSessionToken: text("admin_session_token"),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().$defaultFn(() => new Date()),
});

export const userFeedback = pgTable("user_feedback", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").notNull(),
  senderName: text("sender_name").notNull(),
  shopName: text("shop_name").notNull(),
  phone: text("phone").notNull().default(""),
  category: feedbackCategoryEnum("category"),
  message: text("message").notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().$defaultFn(() => new Date()),
});

export const businessSettings = pgTable("business_settings", {
  id: integer("id").primaryKey(),
  accountId: integer("account_id").notNull(),
  businessName: text("business_name").notNull(),
  phone: text("phone").notNull().default(""),
  address: text("address").notNull().default(""),
  currency: text("currency").notNull().default("PKR"),
  accentColor: text("accent_color").notNull().default("#17765A"),
  logoBlobKey: text("logo_blob_key"),
  avatarChoice: text("avatar_choice").notNull().default(""),
  bankName: text("bank_name").notNull().default(""),
  bankAccountTitle: text("bank_account_title").notNull().default(""),
  bankAccountNumber: text("bank_account_number").notNull().default(""),
  bankIban: text("bank_iban").notNull().default(""),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
});

export const contacts = pgTable("contacts", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").notNull(),
  name: text("name").notNull(),
  phone: text("phone").notNull().default(""),
  address: text("address").notNull().default(""),
  kind: contactKindEnum("kind").notNull().default("customer"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().$defaultFn(() => new Date()),
});

export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").notNull(),
  name: text("name").notNull(),
  unit: text("unit").notNull().default("item"),
  unitPrice: integer("unit_price").notNull(),
  unitCost: integer("unit_cost").notNull().default(0),
  stockQuantity: integer("stock_quantity").notNull().default(0),
  supplierId: integer("supplier_id"),
  brand: text("brand").notNull().default(""),
  productType: text("product_type").notNull().default(""),
  shelfCode: text("shelf_code").notNull().default(""),
  imageBlobKey: text("image_blob_key"),
  category: text("category").notNull().default(""),
  isFeatured: boolean("is_featured").notNull().default(false),
  sizes: text("sizes").notNull().default(""),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().$defaultFn(() => new Date()),
});

export const invoices = pgTable("invoices", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").notNull(),
  invoiceNumber: text("invoice_number").notNull().unique(),
  customerId: integer("customer_id").notNull(),
  customerName: text("customer_name").notNull(),
  customerPhone: text("customer_phone").notNull().default(""),
  customerAddress: text("customer_address").notNull().default(""),
  issueDate: text("issue_date").notNull(),
  dueDate: text("due_date"),
  paymentStatus: paymentStatusEnum("payment_status").notNull().default("pending"),
  paymentMethod: paymentMethodEnum("payment_method").notNull().default("cash"),
  discountType: discountTypeEnum("discount_type").notNull().default("none"),
  discountValue: integer("discount_value").notNull().default(0),
  discountAmount: integer("discount_amount").notNull().default(0),
  notes: text("notes").notNull().default(""),
  currency: text("currency").notNull(),
  subtotal: integer("subtotal").notNull(),
  total: integer("total").notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().$defaultFn(() => new Date()),
});

export const invoiceItems = pgTable("invoice_items", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull(),
  productId: integer("product_id"),
  description: text("description").notNull(),
  unit: text("unit").notNull().default("item"),
  quantity: integer("quantity").notNull(),
  unitPrice: integer("unit_price").notNull(),
  unitCost: integer("unit_cost").notNull().default(0),
  lineTotal: integer("line_total").notNull(),
});

export const purchaseInvoices = pgTable("purchase_invoices", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").notNull(),
  purchaseNumber: text("purchase_number").notNull().unique(),
  supplierId: integer("supplier_id").notNull(),
  supplierName: text("supplier_name").notNull(),
  supplierPhone: text("supplier_phone").notNull().default(""),
  supplierAddress: text("supplier_address").notNull().default(""),
  issueDate: text("issue_date").notNull(),
  dueDate: text("due_date"),
  documentType: documentTypeEnum("document_type").notNull().default("delivered_purchase"),
  deliveryStatus: deliveryStatusEnum("delivery_status").notNull().default("delivered"),
  paymentStatus: paymentStatusEnum("payment_status").notNull().default("pending"),
  paymentMethod: paymentMethodEnum("payment_method").notNull().default("credit"),
  supplierReference: text("supplier_reference").notNull().default(""),
  notes: text("notes").notNull().default(""),
  currency: text("currency").notNull(),
  total: integer("total").notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().$defaultFn(() => new Date()),
});

export const purchaseInvoiceItems = pgTable("purchase_invoice_items", {
  id: serial("id").primaryKey(),
  purchaseInvoiceId: integer("purchase_invoice_id").notNull(),
  productId: integer("product_id").notNull(),
  description: text("description").notNull(),
  unit: text("unit").notNull().default("item"),
  quantity: integer("quantity").notNull(),
  unitCost: integer("unit_cost").notNull(),
  lineTotal: integer("line_total").notNull(),
});
