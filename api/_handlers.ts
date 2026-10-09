// Daybill action handlers for the Vercel API.
//
// Mechanically ported from the canonical artifact server/src/actions.ts.
// Every handler body is VERBATIM — same queries, same validation flow, same
// business rules, same error messages. Only the plumbing changed:
//   - `defineAction`/`Ctx` come from local shims (same inference behavior)
//   - `ctx.db` -> `ctx.db` (drizzle postgres-js)
//   - `ctx.blobs` -> Supabase Storage wrapper (same put/getUrl/delete)
//   - `ctx.invalidateQueries()` -> no-op (the web client invalidates via
//     react-query directly, exactly as the artifact UI already did)
// Request/response zod schemas live in ./_defs.ts (extracted verbatim).
import { z } from "zod";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import * as schema from "./_schema";
import { actionDefs, type ActionName } from "./_defs";
import { hashAdminPassword, hashPin, randomSalt, requireAccount, requireAdminAccount, requireUserAccount, secureEqual } from "./_auth";
import type { Db } from "./_db";
import type { Blobs } from "./_blobs";

export type Ctx = {
  db: Db;
  blobs: Blobs;
  /** No-op on the server: the web client invalidates react-query directly. */
  invalidateQueries: () => void;
};

function defineAction<R extends z.ZodTypeAny, S extends z.ZodTypeAny>(def: {
  request: R;
  response: S;
  handler: (ctx: Ctx, args: z.infer<R>) => Promise<z.infer<S>>;
}) {
  return def;
}

type ActionsModule = Record<
  string,
  { request: z.ZodTypeAny; response: z.ZodTypeAny; handler: (ctx: Ctx, args: any) => Promise<any> }
>;


export const Actions = {
  getAdminLoginStatus: defineAction({
    ...actionDefs.getAdminLoginStatus,
    async handler(ctx, args) {
      const db = ctx.db;
      const rows = await db.select({
        id: schema.accounts.id,
        isOwner: schema.accounts.isOwner,
        passwordHash: schema.accounts.adminPasswordHash,
      }).from(schema.accounts).where(eq(schema.accounts.adminEmail, args.email)).limit(1);
      const account = rows[0];
      return {
        recognized: Boolean(account?.isOwner),
        setup_required: Boolean(account?.isOwner && !account.passwordHash),
      };
    },
  }),
  adminLogin: defineAction({
    ...actionDefs.adminLogin,
    async handler(ctx, args): Promise<{ account_id: number; session_token: string; session_kind: "admin"; shopkeeper_name: string; phone: string }> {
      const db = ctx.db;
      const rows = await db.select().from(schema.accounts).where(and(
        eq(schema.accounts.adminEmail, args.email),
        eq(schema.accounts.isOwner, true),
      )).limit(1);
      const account = rows[0];
      if (!account) throw new Error("Email or password is incorrect");

      if (!account.adminPasswordHash || !account.adminPasswordSalt) {
        if (args.confirm_password === null || args.password !== args.confirm_password) throw new Error("Passwords do not match");
        const salt = randomSalt();
        const passwordHash = await hashAdminPassword(args.password, salt);
        const sessionToken = `${crypto.randomUUID()}${crypto.randomUUID()}`;
        await db.update(schema.accounts).set({
          adminPasswordSalt: salt,
          adminPasswordHash: passwordHash,
          adminSessionToken: sessionToken,
          updatedAt: new Date(),
        }).where(and(eq(schema.accounts.id, account.id), eq(schema.accounts.isOwner, true)));
        return { account_id: account.id, session_token: sessionToken, session_kind: "admin", shopkeeper_name: account.shopkeeperName, phone: account.phone ?? "" };
      }

      const candidate = await hashAdminPassword(args.password, account.adminPasswordSalt);
      if (!secureEqual(candidate, account.adminPasswordHash)) throw new Error("Email or password is incorrect");
      const sessionToken = `${crypto.randomUUID()}${crypto.randomUUID()}`;
      await db.update(schema.accounts).set({ adminSessionToken: sessionToken, updatedAt: new Date() }).where(and(eq(schema.accounts.id, account.id), eq(schema.accounts.isOwner, true)));
      return { account_id: account.id, session_token: sessionToken, session_kind: "admin", shopkeeper_name: account.shopkeeperName, phone: account.phone ?? "" };
    },
  }),
  createAccount: defineAction({
    ...actionDefs.createAccount,
    async handler(ctx, args) {
      const db = ctx.db;
      const existingPhone = await db.select({ id: schema.accounts.id }).from(schema.accounts).where(eq(schema.accounts.phone, args.phone)).limit(1);
      if (existingPhone[0]) throw new Error("An account already exists with this phone number. Please log in.");
      const salt = crypto.randomUUID();
      const pinHash = await hashPin(args.pin, salt);
      const sessionToken = `${crypto.randomUUID()}${crypto.randomUUID()}`;
      const unclaimed = await db.select().from(schema.accounts).where(eq(schema.accounts.claimed, false)).orderBy(asc(schema.accounts.id)).limit(1);
      const legacy = unclaimed[0];
      if (legacy) {
        await db.update(schema.accounts).set({
          shopkeeperName: args.shopkeeper_name,
          phone: args.phone,
          pinSalt: salt,
          pinHash,
          sessionToken,
          claimed: true,
          updatedAt: new Date(),
        }).where(eq(schema.accounts.id, legacy.id));
        const legacySettings = await db.select().from(schema.businessSettings).where(eq(schema.businessSettings.accountId, legacy.id)).limit(1);
        const savedSettings = legacySettings[0];
        if (savedSettings) {
          await db.update(schema.businessSettings).set({
            businessName: args.shop_name,
            phone: args.phone,
            address: args.shop_address,
            updatedAt: new Date(),
          }).where(eq(schema.businessSettings.accountId, legacy.id));
        } else {
          await db.insert(schema.businessSettings).values({
            id: legacy.id,
            accountId: legacy.id,
            businessName: args.shop_name,
            phone: args.phone,
            address: args.shop_address,
            currency: "PKR",
            accentColor: "#17765A",
            updatedAt: new Date(),
          });
        }
        ctx.invalidateQueries();
        return { account_id: legacy.id, session_token: sessionToken, session_kind: "user" as const, shopkeeper_name: args.shopkeeper_name, phone: args.phone, claimed_existing_data: true };
      }
      const rows = await db.insert(schema.accounts).values({
        shopkeeperName: args.shopkeeper_name,
        phone: args.phone,
        pinSalt: salt,
        pinHash,
        sessionToken,
        claimed: true,
      }).returning({ id: schema.accounts.id });
      const created = rows[0];
      if (!created) throw new Error("Could not create the account");
      await db.insert(schema.businessSettings).values({
        id: created.id,
        accountId: created.id,
        businessName: args.shop_name,
        phone: args.phone,
        address: args.shop_address,
        currency: "PKR",
        accentColor: "#17765A",
        updatedAt: new Date(),
      });
      ctx.invalidateQueries();
      return { account_id: created.id, session_token: sessionToken, session_kind: "user" as const, shopkeeper_name: args.shopkeeper_name, phone: args.phone, claimed_existing_data: false };
    },
  }),
  login: defineAction({
    ...actionDefs.login,
    async handler(ctx, args): Promise<{ account_id: number; session_token: string; session_kind: "user"; shopkeeper_name: string; phone: string }> {
      const db = ctx.db;
      const rows = await db.select().from(schema.accounts).where(and(eq(schema.accounts.phone, args.phone), eq(schema.accounts.claimed, true))).limit(1);
      const account = rows[0];
      if (!account?.pinSalt || !account.pinHash) throw new Error("Phone number or PIN is incorrect");
      const candidate = await hashPin(args.pin, account.pinSalt);
      if (candidate !== account.pinHash) throw new Error("Phone number or PIN is incorrect");
      const sessionToken = `${crypto.randomUUID()}${crypto.randomUUID()}`;
      await db.update(schema.accounts).set({ sessionToken, updatedAt: new Date() }).where(eq(schema.accounts.id, account.id));
      return { account_id: account.id, session_token: sessionToken, session_kind: "user", shopkeeper_name: account.shopkeeperName, phone: account.phone ?? args.phone };
    },
  }),
  getAdminDashboard: defineAction({
    ...actionDefs.getAdminDashboard,
    async handler(ctx, args) {
      const db = ctx.db;
      await requireAdminAccount(ctx, args);
      const [accountRows, invoiceRows, contactRows, feedbackRows] = await Promise.all([
        db.select({
          id: schema.accounts.id,
          accountHolderName: schema.accounts.shopkeeperName,
          phone: schema.accounts.phone,
          createdAt: schema.accounts.createdAt,
          shopName: schema.businessSettings.businessName,
          shopAddress: schema.businessSettings.address,
        }).from(schema.accounts)
          .leftJoin(schema.businessSettings, eq(schema.businessSettings.accountId, schema.accounts.id))
          .where(eq(schema.accounts.claimed, true))
          .orderBy(desc(schema.accounts.createdAt), desc(schema.accounts.id)),
        db.select({ accountId: schema.invoices.accountId }).from(schema.invoices),
        db.select({ accountId: schema.contacts.accountId, kind: schema.contacts.kind }).from(schema.contacts).where(eq(schema.contacts.active, true)),
        db.select().from(schema.userFeedback).orderBy(desc(schema.userFeedback.createdAt), desc(schema.userFeedback.id)),
      ]);
      const invoiceCounts = new Map<number, number>();
      const customerCounts = new Map<number, number>();
      const supplierCounts = new Map<number, number>();
      for (const row of invoiceRows) invoiceCounts.set(row.accountId, (invoiceCounts.get(row.accountId) ?? 0) + 1);
      for (const row of contactRows) {
        const target = row.kind === "customer" ? customerCounts : supplierCounts;
        target.set(row.accountId, (target.get(row.accountId) ?? 0) + 1);
      }
      const accounts = accountRows.map((row) => ({
        id: row.id,
        account_holder_name: row.accountHolderName,
        phone: row.phone ?? "",
        shop_name: row.shopName ?? "",
        shop_address: row.shopAddress ?? "",
        created_at: row.createdAt.getTime(),
        invoice_count: invoiceCounts.get(row.id) ?? 0,
        customer_count: customerCounts.get(row.id) ?? 0,
        supplier_count: supplierCounts.get(row.id) ?? 0,
      }));
      return {
        totals: {
          registered_accounts: accounts.length,
          invoices: accounts.reduce((sum, row) => sum + row.invoice_count, 0),
          customers: accounts.reduce((sum, row) => sum + row.customer_count, 0),
          suppliers: accounts.reduce((sum, row) => sum + row.supplier_count, 0),
          feedback: feedbackRows.length,
        },
        accounts,
        feedback: feedbackRows.map((row) => ({
          id: row.id,
          account_id: row.accountId,
          sender_name: row.senderName,
          shop_name: row.shopName,
          phone: row.phone,
          category: row.category,
          message: row.message,
          created_at: row.createdAt.getTime(),
        })),
      };
    },
  }),
  submitFeedback: defineAction({
    ...actionDefs.submitFeedback,
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db;
      const account = await requireUserAccount(ctx, args);
      const settingsRows = await db.select({ shopName: schema.businessSettings.businessName })
        .from(schema.businessSettings)
        .where(eq(schema.businessSettings.accountId, account.id))
        .limit(1);
      await db.insert(schema.userFeedback).values({
        accountId: account.id,
        senderName: account.shopkeeperName,
        shopName: settingsRows[0]?.shopName ?? "",
        phone: account.phone ?? "",
        category: args.category,
        message: args.message.trim(),
        createdAt: new Date(),
      });
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),
  getWorkspace: defineAction({
    ...actionDefs.getWorkspace,
    async handler(ctx, args) {
      const db = ctx.db;
      const account = await requireUserAccount(ctx, args);
      const [settingsRows, contactRows, productRows, invoiceRows, purchaseRows] = await Promise.all([
        db.select().from(schema.businessSettings).where(eq(schema.businessSettings.accountId, account.id)).limit(1),
        db.select().from(schema.contacts).where(and(eq(schema.contacts.accountId, account.id), eq(schema.contacts.active, true))).orderBy(asc(schema.contacts.name)),
        db.select().from(schema.products).where(and(eq(schema.products.accountId, account.id), eq(schema.products.active, true))).orderBy(asc(schema.products.name)),
        db.select().from(schema.invoices).where(eq(schema.invoices.accountId, account.id)).orderBy(desc(schema.invoices.id)),
        db.select().from(schema.purchaseInvoices).where(eq(schema.purchaseInvoices.accountId, account.id)).orderBy(desc(schema.purchaseInvoices.id)),
      ]);
      const invoiceIds = invoiceRows.map((row) => row.id);
      const itemRows = invoiceIds.length ? await db.select().from(schema.invoiceItems).where(inArray(schema.invoiceItems.invoiceId, invoiceIds)) : [];
      const saved = settingsRows[0];
      const logoUrl = saved?.logoBlobKey ? await ctx.blobs.getUrl(saved.logoBlobKey) : null;
      const revenue = invoiceRows.reduce((sum, row) => sum + row.total, 0);
      const contactsById = new Map(contactRows.map((row) => [row.id, row]));
      const cost = itemRows.reduce((sum, row) => sum + row.unitCost * row.quantity, 0);
      const costByInvoice = new Map<number, number>();
      for (const item of itemRows) costByInvoice.set(item.invoiceId, (costByInvoice.get(item.invoiceId) ?? 0) + item.unitCost * item.quantity);
      const outstanding = invoiceRows.filter((row) => row.paymentStatus === "pending").reduce((sum, row) => sum + row.total, 0);
      const deliveredPurchases = purchaseRows.filter((row) => row.deliveryStatus === "delivered");
      const payables = deliveredPurchases.filter((row) => row.paymentStatus === "pending").reduce((sum, row) => sum + row.total, 0);
      const purchaseTotal = deliveredPurchases.reduce((sum, row) => sum + row.total, 0);
      return {
        account: {
          shopkeeper_name: account.shopkeeperName,
          phone: account.phone ?? "",
          is_owner: account.isOwner && args.session_kind === "admin",
          admin_email: args.session_kind === "admin" ? account.adminEmail : null,
          session_kind: args.session_kind,
        },
        settings: {
          business_name: saved?.businessName ?? "",
          phone: saved?.phone ?? "",
          address: saved?.address ?? "",
          currency: saved?.currency ?? "PKR",
          accent_color: saved?.accentColor ?? "#17765A",
          logo_url: logoUrl,
        },
        contacts: contactRows.map((row) => ({ id: row.id, name: row.name, phone: row.phone, address: row.address, kind: row.kind })),
        products: productRows.map((row) => ({
          id: row.id, name: row.name, unit: row.unit, unit_price: row.unitPrice, unit_cost: row.unitCost,
          stock_quantity: row.stockQuantity, supplier_id: row.supplierId,
          supplier_name: row.supplierId ? contactsById.get(row.supplierId)?.name ?? null : null,
        })),
        invoices: invoiceRows.map((row) => {
          const contact = contactsById.get(row.customerId);
          return {
            id: row.id, invoice_number: row.invoiceNumber, customer_id: row.customerId,
            customer_name: contact?.name ?? row.customerName, customer_phone: contact?.phone ?? row.customerPhone,
            customer_address: contact?.address ?? row.customerAddress,
            issue_date: row.issueDate, due_date: row.dueDate, payment_status: row.paymentStatus, payment_method: row.paymentMethod,
            discount_amount: row.discountAmount, total: row.total, cost_total: costByInvoice.get(row.id) ?? 0, currency: row.currency,
          };
        }),
        purchases: purchaseRows.map((row) => {
          const contact = contactsById.get(row.supplierId);
          return {
            id: row.id, purchase_number: row.purchaseNumber, supplier_id: row.supplierId,
            supplier_name: contact?.name ?? row.supplierName, supplier_phone: contact?.phone ?? row.supplierPhone,
            supplier_address: contact?.address ?? row.supplierAddress,
            issue_date: row.issueDate, due_date: row.dueDate, document_type: row.documentType, delivery_status: row.deliveryStatus,
            payment_status: row.paymentStatus, payment_method: row.paymentMethod, supplier_reference: row.supplierReference, total: row.total, currency: row.currency,
          };
        }),
        dashboard: { revenue, cost, profit: revenue - cost, outstanding, payables, purchases: purchaseTotal, low_stock_count: productRows.filter((row) => row.stockQuantity <= 5).length },
      };
    },
  }),
  saveSettings: defineAction({
    ...actionDefs.saveSettings,
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db;
      const account = await requireUserAccount(ctx, args);
      await db.insert(schema.businessSettings).values({
        id: account.id,
        accountId: account.id,
        businessName: args.business_name,
        phone: args.phone,
        address: args.address,
        currency: args.currency.toUpperCase(),
        accentColor: args.accent_color,
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: schema.businessSettings.id,
        set: {
          businessName: args.business_name,
          phone: args.phone,
          address: args.address,
          currency: args.currency.toUpperCase(),
          accentColor: args.accent_color,
          updatedAt: new Date(),
        },
      });
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),
  uploadLogo: defineAction({
    ...actionDefs.uploadLogo,
    async handler(ctx, args) {
      const db = ctx.db;
      const account = await requireUserAccount(ctx, args);
      const existing = await db.select().from(schema.businessSettings).where(eq(schema.businessSettings.accountId, account.id)).limit(1);
      const oldKey = existing[0]?.logoBlobKey;
      const ext = args.mime_type === "image/png" ? "png" : "jpg";
      const key = `business/${account.id}/logo-${Date.now()}.${ext}`;
      const bytes = Uint8Array.from(Buffer.from(args.data_base64, "base64"));
      await ctx.blobs.put(key, bytes, { contentType: args.mime_type });
      const current = existing[0];
      if (current) {
        await db.update(schema.businessSettings).set({ logoBlobKey: key, updatedAt: new Date() }).where(eq(schema.businessSettings.accountId, account.id));
      } else {
        await db.insert(schema.businessSettings).values({
          id: account.id,
          accountId: account.id,
          businessName: "My shop",
          phone: "",
          address: "",
          currency: "PKR",
          accentColor: "#17765A",
          logoBlobKey: key,
          updatedAt: new Date(),
        });
      }
      if (oldKey && oldKey !== key) await ctx.blobs.delete(oldKey);
      ctx.invalidateQueries();
      return { logo_url: await ctx.blobs.getUrl(key) };
    },
  }),
  saveContact: defineAction({
    ...actionDefs.saveContact,
    async handler(ctx, args) {
      const db = ctx.db;
      const account = await requireUserAccount(ctx, args);
      if (args.id) {
        const rows = await db.update(schema.contacts).set({
          name: args.name,
          phone: args.phone,
          address: args.address,
          kind: args.kind,
          updatedAt: new Date(),
        }).where(and(eq(schema.contacts.id, args.id), eq(schema.contacts.accountId, account.id))).returning({ id: schema.contacts.id });
        const updated = rows[0];
        if (!updated) throw new Error("Contact not found");
        await db.update(schema.invoices).set({
          customerName: args.name,
          customerPhone: args.phone,
          customerAddress: args.address,
        }).where(and(eq(schema.invoices.customerId, args.id), eq(schema.invoices.accountId, account.id)));
        await db.update(schema.purchaseInvoices).set({
          supplierName: args.name,
          supplierPhone: args.phone,
          supplierAddress: args.address,
        }).where(and(eq(schema.purchaseInvoices.supplierId, args.id), eq(schema.purchaseInvoices.accountId, account.id)));
        ctx.invalidateQueries();
        return { id: updated.id };
      }
      const rows = await db.insert(schema.contacts).values({
        accountId: account.id,
        name: args.name,
        phone: args.phone,
        address: args.address,
        kind: args.kind,
      }).returning({ id: schema.contacts.id });
      const inserted = rows[0];
      if (!inserted) throw new Error("Could not save contact");
      ctx.invalidateQueries();
      return { id: inserted.id };
    },
  }),
  archiveContact: defineAction({
    ...actionDefs.archiveContact,
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db;
      const account = await requireUserAccount(ctx, args);
      await db.update(schema.contacts).set({ active: false, updatedAt: new Date() }).where(and(eq(schema.contacts.id, args.id), eq(schema.contacts.accountId, account.id)));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),
  saveProduct: defineAction({
    ...actionDefs.saveProduct,
    async handler(ctx, args) {
      const db = ctx.db;
      const account = await requireUserAccount(ctx, args);
      if (args.supplier_id) {
        const supplierRows = await db.select().from(schema.contacts).where(and(eq(schema.contacts.id, args.supplier_id), eq(schema.contacts.accountId, account.id), eq(schema.contacts.active, true))).limit(1);
        if (supplierRows[0]?.kind !== "supplier") throw new Error("Choose an active supplier");
      }
      if (args.id) {
        const rows = await db.update(schema.products).set({
          name: args.name,
          unit: args.unit,
          unitPrice: args.unit_price,
          unitCost: args.unit_cost,
          stockQuantity: args.stock_quantity,
          supplierId: args.supplier_id,
          updatedAt: new Date(),
        }).where(and(eq(schema.products.id, args.id), eq(schema.products.accountId, account.id))).returning({ id: schema.products.id });
        const updated = rows[0];
        if (!updated) throw new Error("Product not found");
        ctx.invalidateQueries();
        return { id: updated.id };
      }
      const rows = await db.insert(schema.products).values({
        accountId: account.id,
        name: args.name,
        unit: args.unit,
        unitPrice: args.unit_price,
        unitCost: args.unit_cost,
        stockQuantity: args.stock_quantity,
        supplierId: args.supplier_id,
      }).returning({ id: schema.products.id });
      const inserted = rows[0];
      if (!inserted) throw new Error("Could not save product");
      ctx.invalidateQueries();
      return { id: inserted.id };
    },
  }),
  archiveProduct: defineAction({
    ...actionDefs.archiveProduct,
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db;
      const account = await requireUserAccount(ctx, args);
      await db.update(schema.products).set({ active: false, updatedAt: new Date() }).where(and(eq(schema.products.id, args.id), eq(schema.products.accountId, account.id)));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),
  createInvoice: defineAction({
    ...actionDefs.createInvoice,
    async handler(ctx, args) {
      const db = ctx.db;
      const account = await requireUserAccount(ctx, args);
      if (args.due_date && args.due_date < args.issue_date) throw new Error("Due date cannot be before the invoice date");
      const contacts = await db.select().from(schema.contacts).where(and(eq(schema.contacts.id, args.customer_id), eq(schema.contacts.accountId, account.id), eq(schema.contacts.active, true))).limit(1);
      const customer = contacts[0];
      if (!customer || customer.kind !== "customer") throw new Error("Choose an active customer");
      const settingsRows = await db.select().from(schema.businessSettings).where(eq(schema.businessSettings.accountId, account.id)).limit(1);
      const settings = settingsRows[0];
      if (!settings?.businessName) throw new Error("Add business details before creating an invoice");
      const productIds = [...new Set(args.items.map((item) => item.product_id))];
      const productRows = await db.select().from(schema.products).where(and(inArray(schema.products.id, productIds), eq(schema.products.accountId, account.id), eq(schema.products.active, true)));
      const byId = new Map(productRows.map((product) => [product.id, product]));
      const requestedByProduct = new Map<number, number>();
      for (const item of args.items) requestedByProduct.set(item.product_id, (requestedByProduct.get(item.product_id) ?? 0) + item.quantity);
      for (const [productId, quantity] of requestedByProduct) {
        const product = byId.get(productId);
        if (!product) throw new Error("One of the selected products is unavailable");
        if (product.stockQuantity < quantity) throw new Error(`${product.name} only has ${product.stockQuantity} ${product.unit} in stock`);
      }
      const itemRows = args.items.map((item) => {
        const product = byId.get(item.product_id);
        if (!product) throw new Error("One of the selected products is unavailable");
        if (product.stockQuantity < item.quantity) throw new Error(`${product.name} only has ${product.stockQuantity} ${product.unit} in stock`);
        return {
          productId: product.id,
          description: product.name,
          unit: product.unit,
          quantity: item.quantity,
          unitPrice: product.unitPrice,
          unitCost: product.unitCost,
          lineTotal: product.unitPrice * item.quantity,
        };
      });
      const subtotal = itemRows.reduce((sum, item) => sum + item.lineTotal, 0);
      if (args.discount_type === "percentage" && args.discount_value > 10_000) throw new Error("Percentage discount cannot be more than 100%");
      const rawDiscount = args.discount_type === "percentage"
        ? Math.round(subtotal * args.discount_value / 10_000)
        : args.discount_type === "fixed" ? args.discount_value : 0;
      const discountAmount = Math.min(subtotal, rawDiscount);
      const total = subtotal - discountAmount;
      const tempNumber = `PENDING-${crypto.randomUUID()}`;
      const insertedRows = await db.insert(schema.invoices).values({
        accountId: account.id,
        invoiceNumber: tempNumber,
        customerId: customer.id,
        customerName: customer.name,
        customerPhone: customer.phone,
        customerAddress: customer.address,
        issueDate: args.issue_date,
        dueDate: args.due_date,
        paymentStatus: "pending",
        paymentMethod: args.payment_method,
        discountType: args.discount_type,
        discountValue: args.discount_type === "none" ? 0 : args.discount_value,
        discountAmount,
        notes: args.notes,
        currency: settings.currency,
        subtotal,
        total,
      }).returning({ id: schema.invoices.id });
      const inserted = insertedRows[0];
      if (!inserted) throw new Error("Could not create invoice");
      const invoiceNumber = `INV-${String(inserted.id).padStart(4, "0")}`;
      await db.update(schema.invoices).set({ invoiceNumber }).where(and(eq(schema.invoices.id, inserted.id), eq(schema.invoices.accountId, account.id)));
      await db.insert(schema.invoiceItems).values(itemRows.map((item) => ({ ...item, invoiceId: inserted.id })));
      for (const [productId, quantity] of requestedByProduct) {
        const product = byId.get(productId);
        if (product) await db.update(schema.products).set({ stockQuantity: product.stockQuantity - quantity, updatedAt: new Date() }).where(and(eq(schema.products.id, productId), eq(schema.products.accountId, account.id)));
      }
      ctx.invalidateQueries();
      return { id: inserted.id, invoice_number: invoiceNumber };
    },
  }),
  createPurchaseInvoice: defineAction({
    ...actionDefs.createPurchaseInvoice,
    async handler(ctx, args) {
      const db = ctx.db;
      const account = await requireUserAccount(ctx, args);
      if (args.due_date && args.due_date < args.issue_date) throw new Error("Due date cannot be before the purchase date");
      const supplierRows = await db.select().from(schema.contacts).where(and(eq(schema.contacts.id, args.supplier_id), eq(schema.contacts.accountId, account.id), eq(schema.contacts.active, true))).limit(1);
      const supplier = supplierRows[0];
      if (!supplier || supplier.kind !== "supplier") throw new Error("Choose an active supplier");
      const settingsRows = await db.select().from(schema.businessSettings).where(eq(schema.businessSettings.accountId, account.id)).limit(1);
      const settings = settingsRows[0];
      if (!settings?.businessName) throw new Error("Add business details before recording a purchase");
      const productIds = [...new Set(args.items.map((item) => item.product_id))];
      const productRows = await db.select().from(schema.products).where(and(inArray(schema.products.id, productIds), eq(schema.products.accountId, account.id), eq(schema.products.active, true)));
      const byId = new Map(productRows.map((product) => [product.id, product]));
      const itemRows = args.items.map((item) => {
        const product = byId.get(item.product_id);
        if (!product) throw new Error("One of the selected products is unavailable");
        return {
          productId: product.id,
          description: product.name,
          unit: product.unit,
          quantity: item.quantity,
          unitCost: item.unit_cost,
          lineTotal: item.unit_cost * item.quantity,
        };
      });
      const total = itemRows.reduce((sum, item) => sum + item.lineTotal, 0);
      const tempNumber = `PENDING-${crypto.randomUUID()}`;
      const insertedRows = await db.insert(schema.purchaseInvoices).values({
        accountId: account.id,
        purchaseNumber: tempNumber,
        supplierId: supplier.id,
        supplierName: supplier.name,
        supplierPhone: supplier.phone,
        supplierAddress: supplier.address,
        issueDate: args.issue_date,
        dueDate: args.due_date,
        documentType: args.document_type,
        deliveryStatus: args.document_type === "purchase_order" ? "pending" : "delivered",
        paymentStatus: args.payment_status,
        paymentMethod: args.payment_method,
        supplierReference: args.supplier_reference,
        notes: args.notes,
        currency: settings.currency,
        total,
      }).returning({ id: schema.purchaseInvoices.id });
      const inserted = insertedRows[0];
      if (!inserted) throw new Error("Could not create purchase invoice");
      const purchaseNumber = `${args.document_type === "purchase_order" ? "PO" : "PUR"}-${String(inserted.id).padStart(4, "0")}`;
      await db.update(schema.purchaseInvoices).set({ purchaseNumber }).where(and(eq(schema.purchaseInvoices.id, inserted.id), eq(schema.purchaseInvoices.accountId, account.id)));
      await db.insert(schema.purchaseInvoiceItems).values(itemRows.map((item) => ({ ...item, purchaseInvoiceId: inserted.id })));
      if (args.document_type === "delivered_purchase") {
        const additions = new Map<number, { quantity: number; costTotal: number }>();
        for (const item of itemRows) {
          const current = additions.get(item.productId) ?? { quantity: 0, costTotal: 0 };
          additions.set(item.productId, { quantity: current.quantity + item.quantity, costTotal: current.costTotal + item.lineTotal });
        }
        for (const [productId, addition] of additions) {
          const product = byId.get(productId);
          if (!product) continue;
          const newStock = product.stockQuantity + addition.quantity;
          const newCost = newStock > 0 ? Math.round((product.stockQuantity * product.unitCost + addition.costTotal) / newStock) : product.unitCost;
          await db.update(schema.products).set({ stockQuantity: newStock, unitCost: newCost, supplierId: supplier.id, updatedAt: new Date() }).where(and(eq(schema.products.id, productId), eq(schema.products.accountId, account.id)));
        }
      }
      ctx.invalidateQueries();
      return { id: inserted.id, purchase_number: purchaseNumber };
    },
  }),
  markPurchaseDelivered: defineAction({
    ...actionDefs.markPurchaseDelivered,
    async handler(ctx, args): Promise<{ ok: true; already_delivered: boolean }> {
      const db = ctx.db;
      const account = await requireUserAccount(ctx, args);
      const purchaseRows = await db.select().from(schema.purchaseInvoices).where(and(eq(schema.purchaseInvoices.id, args.id), eq(schema.purchaseInvoices.accountId, account.id))).limit(1);
      const purchase = purchaseRows[0];
      if (!purchase) throw new Error("Purchase order not found");
      if (purchase.deliveryStatus === "delivered") return { ok: true, already_delivered: true };
      if (purchase.documentType !== "purchase_order") throw new Error("Only purchase orders can be marked delivered");
      const items = await db.select().from(schema.purchaseInvoiceItems).where(eq(schema.purchaseInvoiceItems.purchaseInvoiceId, purchase.id));
      const productIds = [...new Set(items.map((item) => item.productId))];
      const productRows = productIds.length ? await db.select().from(schema.products).where(and(inArray(schema.products.id, productIds), eq(schema.products.accountId, account.id), eq(schema.products.active, true))) : [];
      const byId = new Map(productRows.map((product) => [product.id, product]));
      const additions = new Map<number, { quantity: number; costTotal: number }>();
      for (const item of items) {
        const current = additions.get(item.productId) ?? { quantity: 0, costTotal: 0 };
        additions.set(item.productId, { quantity: current.quantity + item.quantity, costTotal: current.costTotal + item.lineTotal });
      }
      for (const [productId, addition] of additions) {
        const product = byId.get(productId);
        if (!product) throw new Error("A product on this purchase order is no longer available");
        const newStock = product.stockQuantity + addition.quantity;
        const newCost = newStock > 0 ? Math.round((product.stockQuantity * product.unitCost + addition.costTotal) / newStock) : product.unitCost;
        await db.update(schema.products).set({ stockQuantity: newStock, unitCost: newCost, supplierId: purchase.supplierId, updatedAt: new Date() }).where(and(eq(schema.products.id, productId), eq(schema.products.accountId, account.id)));
      }
      await db.update(schema.purchaseInvoices).set({ deliveryStatus: "delivered" }).where(and(eq(schema.purchaseInvoices.id, purchase.id), eq(schema.purchaseInvoices.accountId, account.id), eq(schema.purchaseInvoices.deliveryStatus, "pending")));
      ctx.invalidateQueries();
      return { ok: true, already_delivered: false };
    },
  }),
  setPurchasePaymentStatus: defineAction({
    ...actionDefs.setPurchasePaymentStatus,
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db;
      const account = await requireUserAccount(ctx, args);
      await db.update(schema.purchaseInvoices).set({ paymentStatus: args.status }).where(and(eq(schema.purchaseInvoices.id, args.id), eq(schema.purchaseInvoices.accountId, account.id)));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),
  getPurchaseInvoice: defineAction({
    ...actionDefs.getPurchaseInvoice,
    async handler(ctx, args) {
      const db = ctx.db;
      const account = await requireUserAccount(ctx, args);
      const rows = await db.select().from(schema.purchaseInvoices).where(and(eq(schema.purchaseInvoices.id, args.id), eq(schema.purchaseInvoices.accountId, account.id))).limit(1);
      const purchase = rows[0];
      if (!purchase) throw new Error("Purchase invoice not found");
      const [items, currentContactRows] = await Promise.all([
        db.select().from(schema.purchaseInvoiceItems).where(eq(schema.purchaseInvoiceItems.purchaseInvoiceId, args.id)).orderBy(asc(schema.purchaseInvoiceItems.id)),
        db.select().from(schema.contacts).where(and(eq(schema.contacts.id, purchase.supplierId), eq(schema.contacts.accountId, account.id))).limit(1),
      ]);
      const currentContact = currentContactRows[0];
      return {
        purchase: {
          id: purchase.id,
          purchase_number: purchase.purchaseNumber,
          supplier_id: purchase.supplierId,
          supplier_name: currentContact?.name ?? purchase.supplierName,
          supplier_phone: currentContact?.phone ?? purchase.supplierPhone,
          supplier_address: currentContact?.address ?? purchase.supplierAddress,
          issue_date: purchase.issueDate,
          due_date: purchase.dueDate,
          document_type: purchase.documentType,
          delivery_status: purchase.deliveryStatus,
          payment_status: purchase.paymentStatus,
          payment_method: purchase.paymentMethod,
          supplier_reference: purchase.supplierReference,
          notes: purchase.notes,
          total: purchase.total,
          currency: purchase.currency,
          items: items.map((item) => ({
            id: item.id,
            product_id: item.productId,
            description: item.description,
            unit: item.unit,
            quantity: item.quantity,
            unit_cost: item.unitCost,
            line_total: item.lineTotal,
          })),
        },
      };
    },
  }),
  setInvoicePaymentStatus: defineAction({
    ...actionDefs.setInvoicePaymentStatus,
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db;
      const account = await requireUserAccount(ctx, args);
      await db.update(schema.invoices).set({ paymentStatus: args.status }).where(and(eq(schema.invoices.id, args.id), eq(schema.invoices.accountId, account.id)));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),
  getInvoice: defineAction({
    ...actionDefs.getInvoice,
    async handler(ctx, args) {
      const db = ctx.db;
      const account = await requireUserAccount(ctx, args);
      const rows = await db.select().from(schema.invoices).where(and(eq(schema.invoices.id, args.id), eq(schema.invoices.accountId, account.id))).limit(1);
      const invoice = rows[0];
      if (!invoice) throw new Error("Invoice not found");
      const [items, currentContactRows] = await Promise.all([
        db.select().from(schema.invoiceItems).where(eq(schema.invoiceItems.invoiceId, args.id)).orderBy(asc(schema.invoiceItems.id)),
        db.select().from(schema.contacts).where(and(eq(schema.contacts.id, invoice.customerId), eq(schema.contacts.accountId, account.id))).limit(1),
      ]);
      const currentContact = currentContactRows[0];
      return {
        invoice: {
          id: invoice.id,
          invoice_number: invoice.invoiceNumber,
          customer_id: invoice.customerId,
          customer_name: currentContact?.name ?? invoice.customerName,
          customer_phone: currentContact?.phone ?? invoice.customerPhone,
          customer_address: currentContact?.address ?? invoice.customerAddress,
          issue_date: invoice.issueDate,
          due_date: invoice.dueDate,
          payment_status: invoice.paymentStatus,
          payment_method: invoice.paymentMethod,
          discount_type: invoice.discountType,
          discount_value: invoice.discountValue,
          discount_amount: invoice.discountAmount,
          notes: invoice.notes,
          subtotal: invoice.subtotal,
          total: invoice.total,
          currency: invoice.currency,
          items: items.map((item) => ({
            id: item.id,
            description: item.description,
            unit: item.unit,
            quantity: item.quantity,
            unit_price: item.unitPrice,
            line_total: item.lineTotal,
          })),
        },
      };
    },
  }),
} satisfies ActionsModule;
