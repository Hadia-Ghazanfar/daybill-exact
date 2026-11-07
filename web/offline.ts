// Offline layer for Daybill: IndexedDB cache + mutation outbox + sync engine.
//
// The app shell is already cached by the service worker; this layer covers
// the DATA side so the app keeps working without internet:
//
// - getWorkspace responses are cached (per account) and served when the
//   network fails, so dashboard / bills / stock / contacts render offline.
// - Queueable mutations made offline are stored in an outbox with a stable
//   idempotency key, applied optimistically to the cached workspace, and
//   replayed in order when the connection returns. A retried sync can never
//   create a duplicate: the server dedupes on the same key.
// - Entities created offline get a negative temp id; when the server returns
//   the real id, the temp id is recorded in tempIdMap so detail views keep
//   resolving to the real record.
//
// No new dependencies: the IndexedDB access below is a hand-rolled ~80 line
// promise wrapper. This module never imports the api client (the raw POST
// function and the session getter are injected by main.tsx) so there is no
// import cycle: api-client -> offline, main -> offline + api-client.
import { useEffect, useState } from "react";
import type { QueryClient } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SyncStatus = {
  online: boolean;
  pending: number;
  syncing: boolean;
  failed: number;
};

export type OutboxItem = {
  /** Client uuid — doubles as the server idempotency key. */
  id: string;
  action: string;
  /** User args only (no session fields); the session is attached at replay. */
  args: Record<string, unknown>;
  idem: string;
  /** Negative temp id for creates that return an { id }, so the real id can
   *  be mapped back after the replay succeeds. */
  tempId?: number;
  accountId: number;
  createdAt: number;
  attempts: number;
};

type RawPost = (name: string, args: Record<string, unknown>) => Promise<any>;
type SessionGetter = () => { account_id: number } | null;

// Workspace payloads are plain JSON; the optimistic code works on loose
// shapes (see api/_defs.ts for the authoritative field lists).
type AnyWs = any;

// ---------------------------------------------------------------------------
// IndexedDB (hand-rolled promise wrapper)
// ---------------------------------------------------------------------------

const DB_NAME = "daybill-offline-v1";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv", { keyPath: "key" });
      if (!db.objectStoreNames.contains("outbox")) db.createObjectStore("outbox", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Could not open offline database"));
  });
  return dbPromise;
}

function idb<T>(run: (db: IDBDatabase) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        let req: IDBRequest<T>;
        try {
          req = run(db);
        } catch (err) {
          reject(err);
          return;
        }
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("Offline database request failed"));
      }),
  );
}

async function kvGet(key: string): Promise<any> {
  try {
    const row = await idb<any>((db) =>
      db.transaction("kv", "readonly").objectStore("kv").get(key),
    );
    return row?.value ?? null;
  } catch {
    return null;
  }
}

async function kvPut(key: string, value: any): Promise<void> {
  await idb((db) =>
    db.transaction("kv", "readwrite").objectStore("kv").put({ key, value }),
  );
}

async function outboxAll(): Promise<OutboxItem[]> {
  try {
    const rows = await idb<any[]>((db) =>
      db.transaction("outbox", "readonly").objectStore("outbox").getAll(),
    );
    return (rows ?? []) as OutboxItem[];
  } catch {
    return [];
  }
}

async function outboxPut(item: OutboxItem): Promise<void> {
  await idb((db) =>
    db.transaction("outbox", "readwrite").objectStore("outbox").put(item),
  );
}

async function outboxDelete(id: string): Promise<void> {
  await idb((db) =>
    db.transaction("outbox", "readwrite").objectStore("outbox").delete(id),
  );
}

// ---------------------------------------------------------------------------
// Sync status (observable by the UI)
// ---------------------------------------------------------------------------

let status: SyncStatus = {
  online: typeof navigator !== "undefined" ? navigator.onLine : true,
  pending: 0,
  syncing: false,
  failed: 0,
};

const statusListeners = new Set<(s: SyncStatus) => void>();

function emitStatus(): void {
  const snap = { ...status };
  statusListeners.forEach((cb) => cb(snap));
}

export function getSyncStatus(): SyncStatus {
  return { ...status };
}

export function subscribeSyncStatus(cb: (s: SyncStatus) => void): () => void {
  statusListeners.add(cb);
  return () => {
    statusListeners.delete(cb);
  };
}

export function useSyncStatus(): SyncStatus {
  const [s, setS] = useState<SyncStatus>(() => getSyncStatus());
  useEffect(() => subscribeSyncStatus(setS), []);
  return s;
}

let sessionGetter: SessionGetter | null = null;

function currentAccountId(): number | null {
  try {
    return sessionGetter?.()?.account_id ?? null;
  } catch {
    return null;
  }
}

async function refreshCounts(accountId?: number): Promise<void> {
  const id = accountId ?? currentAccountId();
  if (id == null) {
    status = { ...status, pending: 0, failed: 0 };
    emitStatus();
    return;
  }
  const items = await outboxAll();
  const failedList = ((await kvGet(`failed:${id}`)) as any[]) ?? [];
  status = {
    ...status,
    pending: items.filter((i) => i.accountId === id).length,
    failed: failedList.length,
  };
  emitStatus();
}

function setOnline(online: boolean): void {
  if (status.online === online) return;
  status = { ...status, online };
  emitStatus();
}

function setSyncing(syncing: boolean): void {
  if (status.syncing === syncing) return;
  status = { ...status, syncing };
  emitStatus();
}

// ---------------------------------------------------------------------------
// Query client binding (workspace cache)
// ---------------------------------------------------------------------------

const WS_KEY = ["workspace"] as const;

let queryClient: QueryClient | null = null;

export function bindOfflineQueryClient(client: QueryClient): void {
  queryClient = client;
}

function clone<T>(value: T): T {
  return value == null ? value : (JSON.parse(JSON.stringify(value)) as T);
}

// ---------------------------------------------------------------------------
// Workspace cache (IndexedDB, per account) + temp-id map
// ---------------------------------------------------------------------------

export async function getCachedWorkspace(accountId: number): Promise<AnyWs | null> {
  const fromQuery = queryClient?.getQueryData(WS_KEY) as AnyWs | undefined;
  if (fromQuery) return fromQuery;
  const row = await kvGet(`workspace:${accountId}`);
  return row?.data ?? null;
}

export async function saveWorkspaceCache(accountId: number, ws: AnyWs): Promise<void> {
  try {
    await kvPut(`workspace:${accountId}`, { data: ws, savedAt: Date.now() });
  } catch {
    // The cache is best-effort; never break a live call on an IDB failure.
  }
}

export async function getTempIdMap(accountId: number): Promise<Record<string, number>> {
  const row = await kvGet(`tempIdMap:${accountId}`);
  return (row as Record<string, number>) ?? {};
}

export async function recordTempId(accountId: number, tempId: number, realId: number): Promise<void> {
  const map = await getTempIdMap(accountId);
  map[String(tempId)] = realId;
  try {
    await kvPut(`tempIdMap:${accountId}`, map);
  } catch {
    // Best-effort.
  }
}

/** Resolve a temp (negative) id to its real server id after a sync, or null. */
export async function resolveTempId(tempId: number): Promise<number | null> {
  const session = sessionGetter?.();
  if (!session) return null;
  const map = await getTempIdMap(session.account_id);
  return map[String(tempId)] ?? null;
}

/** Replace a temp entry in the cached workspace with its real id/number. */
export async function replaceTempEntry(
  accountId: number,
  tempId: number,
  realId: number,
  realNumber?: string,
): Promise<void> {
  const ws = await getCachedWorkspace(accountId);
  if (!ws) return;
  const next = clone(ws);
  let changed = false;
  for (const list of [next.invoices, next.purchases, next.products, next.contacts, next.categories]) {
    if (!Array.isArray(list)) continue;
    const entry = list.find((x: any) => x.id === tempId);
    if (!entry) continue;
    entry.id = realId;
    if (realNumber) {
      if (entry.invoice_number) entry.invoice_number = realNumber;
      if (entry.purchase_number) entry.purchase_number = realNumber;
    }
    changed = true;
  }
  if (!changed) return;
  queryClient?.setQueryData(WS_KEY, next);
  await saveWorkspaceCache(accountId, next);
}

// ---------------------------------------------------------------------------
// Temp ids + idempotency keys
// ---------------------------------------------------------------------------

let tempSeq = 0;

/** Negative, (practically) unique id for an entity created offline. */
export function makeTempId(): number {
  tempSeq = (tempSeq + 1) % 1000;
  return -(Date.now() * 1000 + tempSeq);
}

export function newIdem(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to the fallback below.
  }
  return `idem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// Outbox
// ---------------------------------------------------------------------------

export async function queueMutation(item: {
  action: string;
  args: Record<string, unknown>;
  idem: string;
  tempId?: number;
  accountId: number;
}): Promise<OutboxItem> {
  const full: OutboxItem = {
    id: item.idem,
    action: item.action,
    args: item.args,
    idem: item.idem,
    tempId: item.tempId,
    accountId: item.accountId,
    createdAt: Date.now(),
    attempts: 0,
  };
  await outboxPut(full);
  await refreshCounts(item.accountId);
  return full;
}

async function recordFailed(accountId: number, item: OutboxItem, err: unknown): Promise<void> {
  const key = `failed:${accountId}`;
  const list = (((await kvGet(key)) as any[]) ?? []).slice();
  list.unshift({
    id: item.id,
    action: item.action,
    args: item.args,
    error: err instanceof Error ? err.message : String(err),
    failedAt: Date.now(),
  });
  try {
    await kvPut(key, list.slice(0, 20));
  } catch {
    // Best-effort.
  }
}

// ---------------------------------------------------------------------------
// Cached detail builders (temp ids, and any id when offline)
// ---------------------------------------------------------------------------

export async function serveCachedInvoice(accountId: number, id: number): Promise<any | null> {
  const ws = await getCachedWorkspace(accountId);
  let inv = ws?.invoices?.find((i: any) => i.id === id);
  if (!inv && id < 0) {
    // Already synced: the cache now holds the real id.
    const map = await getTempIdMap(accountId);
    const realId = map[String(id)];
    if (realId !== undefined) inv = ws?.invoices?.find((i: any) => i.id === realId);
  }
  if (!inv) return null;
  const d = (inv as any).__detail ?? {};
  return {
    invoice: {
      ...inv,
      discount_type: d.discount_type ?? "none",
      discount_value: d.discount_value ?? 0,
      notes: d.notes ?? "",
      subtotal: d.subtotal ?? inv.total,
      tax_percent: d.tax_percent ?? 0,
      tax_amount: d.tax_amount ?? 0,
      template: d.template ?? "classic",
      items: (inv.items ?? []).map((it: any) => ({
        id: it.id,
        description: it.description,
        unit: it.unit,
        quantity: it.quantity,
        unit_price: it.unit_price,
        line_total: it.line_total,
      })),
    },
  };
}

export async function serveCachedPurchase(accountId: number, id: number): Promise<any | null> {
  const ws = await getCachedWorkspace(accountId);
  let pur = ws?.purchases?.find((p: any) => p.id === id);
  if (!pur && id < 0) {
    // Already synced: the cache now holds the real id.
    const map = await getTempIdMap(accountId);
    const realId = map[String(id)];
    if (realId !== undefined) pur = ws?.purchases?.find((p: any) => p.id === realId);
  }
  if (!pur) return null;
  const d = (pur as any).__detail ?? {};
  return {
    purchase: {
      ...pur,
      notes: d.notes ?? "",
      items: (pur.items ?? []).map((it: any) => ({
        id: it.id,
        product_id: it.product_id,
        description: it.description,
        unit: it.unit,
        quantity: it.quantity,
        unit_cost: it.unit_cost,
        line_total: it.line_total,
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// Optimistic updates (React Query cache + IndexedDB cache, kept in sync)
// ---------------------------------------------------------------------------

/** Recompute the dashboard aggregates from the lists, mirroring the server. */
function recomputeDashboard(ws: AnyWs): void {
  const revenue = (ws.invoices ?? []).reduce((s: number, i: any) => s + (i.total || 0), 0);
  const outstanding = (ws.invoices ?? [])
    .filter((i: any) => i.payment_status === "pending")
    .reduce((s: number, i: any) => s + (i.total || 0), 0);
  const delivered = (ws.purchases ?? []).filter((p: any) => p.delivery_status === "delivered");
  const purchaseTotal = delivered.reduce((s: number, p: any) => s + (p.total || 0), 0);
  const payables = delivered
    .filter((p: any) => p.payment_status === "pending")
    .reduce((s: number, p: any) => s + (p.total || 0), 0);
  ws.dashboard = {
    revenue,
    cost: purchaseTotal,
    profit: revenue - purchaseTotal,
    outstanding,
    payables,
    purchases: purchaseTotal,
    low_stock_count: (ws.products ?? []).filter((p: any) => (p.stock_quantity ?? 0) <= 5).length,
  };
}

function sortByName(list: any[]): void {
  list.sort((a: any, b: any) => String(a.name ?? "").localeCompare(String(b.name ?? "")));
}

function findProduct(ws: AnyWs, id: number): any | undefined {
  return (ws.products ?? []).find((p: any) => p.id === id);
}

/** Add stock for a delivered purchase, mirroring the server's weighted cost. */
function addDeliveredStock(ws: AnyWs, productId: number, qty: number, lineTotal: number, supplierId: number): void {
  const p = findProduct(ws, productId);
  if (!p) return;
  const oldStock = p.stock_quantity ?? 0;
  const newStock = oldStock + qty;
  p.unit_cost =
    newStock > 0
      ? Math.round((oldStock * (p.unit_cost ?? 0) + lineTotal) / newStock)
      : (p.unit_cost ?? 0);
  p.stock_quantity = newStock;
  p.supplier_id = supplierId;
}

export async function applyOptimistic(
  action: string,
  args: Record<string, any>,
  accountId: number,
  tempId?: number,
): Promise<void> {
  const current = await getCachedWorkspace(accountId);
  if (!current) return;
  const ws: AnyWs = clone(current);
  const a = args;

  switch (action) {
    case "createInvoice": {
      const contact = (ws.contacts ?? []).find((c: any) => c.id === a.customer_id);
      const resolved = (a.items as any[]).map((it: any) => {
        const p = findProduct(ws, it.product_id);
        return { product: p, quantity: it.quantity, unit_price: p?.unit_price ?? 0, unit_cost: p?.unit_cost ?? 0 };
      });
      const subtotal = resolved.reduce((s, r) => s + r.unit_price * r.quantity, 0);
      const rawDiscount =
        a.discount_type === "percentage"
          ? Math.round((subtotal * (a.discount_value ?? 0)) / 10000)
          : a.discount_type === "fixed"
            ? (a.discount_value ?? 0)
            : 0;
      const discountAmount = Math.min(subtotal, rawDiscount);
      const taxAmount = Math.round(((subtotal - discountAmount) * (a.tax_percent ?? 0)) / 10000);
      const total = subtotal - discountAmount + taxAmount;
      const summary = {
        id: tempId,
        invoice_number: `TMP-${Math.abs(tempId ?? 0)}`,
        customer_id: a.customer_id,
        customer_name: contact?.name ?? "",
        customer_phone: contact?.phone ?? "",
        customer_address: contact?.address ?? "",
        issue_date: a.issue_date,
        due_date: a.due_date ?? null,
        payment_status: "pending",
        payment_method: a.payment_method,
        discount_amount: discountAmount,
        total,
        cost_total: resolved.reduce((s, r) => s + r.unit_cost * r.quantity, 0),
        currency: ws.settings.currency,
        items: resolved.map((r, i) => ({
          id: (tempId ?? -1) - i - 1,
          product_id: r.product?.id,
          description: r.product?.name ?? "",
          unit: r.product?.unit ?? "item",
          quantity: r.quantity,
          unit_price: r.unit_price,
          line_total: r.unit_price * r.quantity,
        })),
        __detail: {
          discount_type: a.discount_type ?? "none",
          discount_value: a.discount_value ?? 0,
          notes: a.notes ?? "",
          subtotal,
          tax_percent: a.tax_percent ?? 0,
          tax_amount: taxAmount,
          template: a.template ?? "classic",
        },
      };
      ws.invoices.unshift(summary);
      const byProduct = new Map<number, number>();
      for (const it of a.items as any[]) {
        byProduct.set(it.product_id, (byProduct.get(it.product_id) ?? 0) + it.quantity);
      }
      for (const [pid, qty] of byProduct) {
        const p = findProduct(ws, pid);
        if (p) p.stock_quantity = Math.max(0, (p.stock_quantity ?? 0) - qty);
      }
      break;
    }
    case "createPurchaseInvoice": {
      const supplier = (ws.contacts ?? []).find((c: any) => c.id === a.supplier_id);
      const items = (a.items as any[]).map((it: any, i: number) => {
        const p = findProduct(ws, it.product_id);
        return {
          id: (tempId ?? -1) - i - 1,
          product_id: it.product_id,
          description: p?.name ?? "",
          quantity: it.quantity,
          unit_cost: it.unit_cost,
          line_total: it.unit_cost * it.quantity,
          unit: p?.unit ?? "item",
        };
      });
      const total = items.reduce((s, it) => s + it.line_total, 0);
      const summary = {
        id: tempId,
        purchase_number: `TMP-${Math.abs(tempId ?? 0)}`,
        supplier_id: a.supplier_id,
        supplier_name: supplier?.name ?? "",
        supplier_phone: supplier?.phone ?? "",
        supplier_address: supplier?.address ?? "",
        issue_date: a.issue_date,
        due_date: a.due_date ?? null,
        document_type: a.document_type,
        delivery_status: a.document_type === "purchase_order" ? "pending" : "delivered",
        payment_status: a.payment_status,
        payment_method: a.payment_method,
        supplier_reference: a.supplier_reference ?? "",
        total,
        currency: ws.settings.currency,
        items,
        __detail: { notes: a.notes ?? "" },
      };
      ws.purchases.unshift(summary);
      if (a.document_type === "delivered_purchase") {
        const byProduct = new Map<number, { qty: number; costTotal: number }>();
        for (const it of items) {
          const cur = byProduct.get(it.product_id) ?? { qty: 0, costTotal: 0 };
          cur.qty += it.quantity;
          cur.costTotal += it.line_total;
          byProduct.set(it.product_id, cur);
        }
        for (const [pid, add] of byProduct) {
          addDeliveredStock(ws, pid, add.qty, add.costTotal, a.supplier_id);
        }
      }
      break;
    }
    case "setInvoicePaymentStatus": {
      const inv = (ws.invoices ?? []).find((i: any) => i.id === a.id);
      if (inv) inv.payment_status = a.status;
      break;
    }
    case "setPurchasePaymentStatus": {
      const pur = (ws.purchases ?? []).find((p: any) => p.id === a.id);
      if (pur) pur.payment_status = a.status;
      break;
    }
    case "markPurchaseDelivered": {
      const pur = (ws.purchases ?? []).find((p: any) => p.id === a.id);
      if (pur && pur.delivery_status !== "delivered") {
        pur.delivery_status = "delivered";
        const byProduct = new Map<number, { qty: number; costTotal: number }>();
        for (const it of pur.items ?? []) {
          const cur = byProduct.get(it.product_id) ?? { qty: 0, costTotal: 0 };
          cur.qty += it.quantity;
          cur.costTotal += it.line_total;
          byProduct.set(it.product_id, cur);
        }
        for (const [pid, add] of byProduct) {
          addDeliveredStock(ws, pid, add.qty, add.costTotal, pur.supplier_id);
        }
      }
      break;
    }
    case "saveProduct": {
      if (a.id) {
        const p = findProduct(ws, a.id);
        if (p) {
          Object.assign(p, {
            name: a.name,
            unit: a.unit,
            unit_price: a.unit_price,
            unit_cost: a.unit_cost,
            stock_quantity: a.stock_quantity,
            supplier_id: a.supplier_id ?? null,
            brand: a.brand ?? "",
            product_type: a.product_type ?? "",
            shelf_code: a.shelf_code ?? "",
            category: a.category ?? "",
            is_featured: a.is_featured ?? false,
            sizes: a.sizes ?? "",
          });
          p.supplier_name = a.supplier_id
            ? ((ws.contacts ?? []).find((c: any) => c.id === a.supplier_id)?.name ?? null)
            : null;
        }
      } else {
        const supplier = a.supplier_id
          ? (ws.contacts ?? []).find((c: any) => c.id === a.supplier_id)
          : null;
        ws.products.push({
          id: tempId,
          name: a.name,
          unit: a.unit,
          unit_price: a.unit_price,
          unit_cost: a.unit_cost,
          stock_quantity: a.stock_quantity,
          supplier_id: a.supplier_id ?? null,
          supplier_name: supplier?.name ?? null,
          brand: a.brand ?? "",
          product_type: a.product_type ?? "",
          shelf_code: a.shelf_code ?? "",
          category: a.category ?? "",
          is_featured: a.is_featured ?? false,
          sizes: a.sizes ?? "",
          image_url: null,
          updated_at: null,
        });
        sortByName(ws.products);
      }
      break;
    }
    case "archiveProduct": {
      ws.products = (ws.products ?? []).filter((p: any) => p.id !== a.id);
      break;
    }
    case "adjustStock": {
      const p = findProduct(ws, a.product_id);
      if (p) p.stock_quantity = Math.max(0, (p.stock_quantity ?? 0) + a.adjustment);
      break;
    }
    case "saveContact": {
      const existing = (ws.contacts ?? []).find((c: any) => c.id === (a.id ?? tempId));
      const row = { id: a.id ?? tempId, name: a.name, phone: a.phone, address: a.address, kind: a.kind };
      if (existing) Object.assign(existing, row);
      else ws.contacts.push(row);
      sortByName(ws.contacts);
      break;
    }
    case "archiveContact": {
      ws.contacts = (ws.contacts ?? []).filter((c: any) => c.id !== a.id);
      break;
    }
    case "saveCategory": {
      const existing = (ws.categories ?? []).find((c: any) => c.id === (a.id ?? tempId));
      if (existing) existing.name = a.name;
      else ws.categories.push({ id: a.id ?? tempId, name: a.name });
      sortByName(ws.categories);
      break;
    }
    case "deleteCategory": {
      ws.categories = (ws.categories ?? []).filter((c: any) => c.id !== a.id);
      break;
    }
    case "saveSettings": {
      const next: Record<string, unknown> = {
        business_name: a.business_name,
        phone: a.phone,
        address: a.address,
        currency: a.currency,
        accent_color: a.accent_color,
      };
      for (const key of ["avatar_choice", "bank_name", "bank_account_title", "bank_account_number", "bank_iban"] as const) {
        if (a[key] !== undefined) next[key] = a[key];
      }
      Object.assign(ws.settings, next);
      break;
    }
    case "trashInvoice": {
      const idx = (ws.invoices ?? []).findIndex((i: any) => i.id === a.invoice_id);
      if (idx >= 0) {
        const [inv] = ws.invoices.splice(idx, 1);
        for (const it of inv.items ?? []) {
          const p =
            (it.product_id ? findProduct(ws, it.product_id) : undefined) ??
            (ws.products ?? []).find((x: any) => x.name === it.description);
          if (p) p.stock_quantity = (p.stock_quantity ?? 0) + it.quantity;
        }
      }
      break;
    }
    case "trashPurchase": {
      const idx = (ws.purchases ?? []).findIndex((p: any) => p.id === a.purchase_id);
      if (idx >= 0) {
        const [pur] = ws.purchases.splice(idx, 1);
        if (pur.delivery_status === "delivered") {
          for (const it of pur.items ?? []) {
            const p = it.product_id ? findProduct(ws, it.product_id) : undefined;
            if (p) p.stock_quantity = Math.max(0, (p.stock_quantity ?? 0) - it.quantity);
          }
        }
      }
      break;
    }
    case "restoreInvoice":
    case "restorePurchase":
    case "deleteInvoiceForever":
    case "deletePurchaseForever":
    case "submitFeedback":
    case "markNotificationRead":
    case "markAllNotificationsRead": {
      // Queue only — no local cache change (trashed rows and notifications
      // are not in the workspace payload).
      break;
    }
    default:
      break;
  }

  recomputeDashboard(ws);
  queryClient?.setQueryData(WS_KEY, ws);
  await saveWorkspaceCache(accountId, ws);
}

// ---------------------------------------------------------------------------
// Sync engine
// ---------------------------------------------------------------------------

let rawPostFn: RawPost | null = null;
let engineStarted = false;
let passRunning = false;

function isOnlineNow(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

/** Replace any temp id (from any account's map is impossible — ids are
 *  negative and unique per account map) with its real id, recursively. */
function translateTempIds(value: any, map: Record<string, number>): any {
  if (Array.isArray(value)) return value.map((v) => translateTempIds(v, map));
  if (value && typeof value === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) out[k] = translateTempIds(v, map);
    return out;
  }
  if (typeof value === "number" && map[String(value)] !== undefined) return map[String(value)];
  return value;
}

export async function runSyncPass(): Promise<void> {
  if (passRunning) return;
  const session = sessionGetter?.();
  if (!session || !rawPostFn) return;
  const accountId = session.account_id;
  if (!isOnlineNow()) return;
  const items = (await outboxAll())
    .filter((i) => i.accountId === accountId)
    .sort((x, y) => x.createdAt - y.createdAt);
  if (items.length === 0) {
    await refreshCounts(accountId);
    return;
  }
  passRunning = true;
  setSyncing(true);
  let stopped = false;
  try {
    for (const item of items) {
      const map = await getTempIdMap(accountId);
      const args = translateTempIds(clone(item.args), map);
      try {
        const result = await rawPostFn(item.action, { ...args, __idem: item.idem });
        await outboxDelete(item.id);
        if (item.tempId && result && typeof result.id === "number") {
          await recordTempId(accountId, item.tempId, result.id);
          const realNumber = result.invoice_number ?? result.purchase_number;
          await replaceTempEntry(accountId, item.tempId, result.id, realNumber);
          // The saved-invoice detail query is keyed by the temp id; make it
          // refetch so it resolves to the real record through tempIdMap.
          queryClient?.invalidateQueries({ queryKey: ["invoice", item.tempId] });
          queryClient?.invalidateQueries({ queryKey: ["purchase", item.tempId] });
        }
      } catch (err) {
        const st = (err as any)?.status;
        if (typeof st === "number" && st >= 400 && st < 500) {
          // Permanent failure (validation / auth): drop it to the failed
          // list instead of retrying forever, and keep going.
          await outboxDelete(item.id);
          await recordFailed(accountId, item, err);
          continue;
        }
        // 5xx or network: stop this pass, leave the rest queued for later.
        stopped = true;
        break;
      }
    }
  } finally {
    passRunning = false;
    setSyncing(false);
    await refreshCounts(accountId);
  }
  if (!stopped) {
    // Everything that could sync did — refresh from the server.
    queryClient?.invalidateQueries({ queryKey: WS_KEY });
  }
}

export function startSyncEngine(rawPost: RawPost, getSession: SessionGetter): void {
  rawPostFn = rawPost;
  sessionGetter = getSession;
  if (engineStarted) return;
  engineStarted = true;
  window.addEventListener("online", () => {
    setOnline(true);
    void runSyncPass();
  });
  window.addEventListener("offline", () => {
    setOnline(false);
    void refreshCounts();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void runSyncPass();
  });
  window.setInterval(() => {
    void runSyncPass();
  }, 30000);
  void refreshCounts();
  void runSyncPass();
}

/** Called when the api session is (re)loaded — e.g. app start. The engine
 *  starts before App mounts, so its first count runs with no session and
 *  sees zero pending items; this re-counts (and replays, if online) once
 *  the account is known. */
export function notifySessionChanged(): void {
  if (!engineStarted) return;
  void refreshCounts();
  if (isOnlineNow()) void runSyncPass();
}
