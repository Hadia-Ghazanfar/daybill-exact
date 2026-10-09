// Postgres connection + schema bootstrap for the Daybill Vercel API.
//
// Uses postgres-js through drizzle-orm with `prepare: false` (simple query
// protocol) so it works against the Supabase Session pooler from serverless
// functions. `ensureInit()` creates the 9 tables with IF NOT EXISTS —
// matching what the artifact's drizzle migrations produced on sqlite — and
// is safe to run on every cold start.
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./_schema.js";

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured");
  return url;
}

let client: ReturnType<typeof postgres> | null = null;
let dbInstance: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getSql() {
  if (!client) {
    client = postgres(connectionString(), { prepare: false, max: 1 });
  }
  return client;
}

export function getDb() {
  if (!dbInstance) {
    dbInstance = drizzle(getSql(), { schema });
  }
  return dbInstance;
}

export type Db = ReturnType<typeof getDb>;

const ENUM_STATEMENTS: string[] = [
  `DO $$ BEGIN
  CREATE TYPE feedback_category AS ENUM ('bug', 'suggestion', 'other');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;`,
  `DO $$ BEGIN
  CREATE TYPE contact_kind AS ENUM ('customer', 'supplier');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;`,
  `DO $$ BEGIN
  CREATE TYPE payment_status AS ENUM ('pending', 'paid');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;`,
  `DO $$ BEGIN
  CREATE TYPE payment_method AS ENUM ('card', 'cash', 'transfer', 'credit');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;`,
  `DO $$ BEGIN
  CREATE TYPE discount_type AS ENUM ('none', 'percentage', 'fixed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;`,
  `DO $$ BEGIN
  CREATE TYPE document_type AS ENUM ('purchase_order', 'delivered_purchase');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;`,
  `DO $$ BEGIN
  CREATE TYPE delivery_status AS ENUM ('pending', 'delivered');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;`,
];

const MIGRATION_SQL = `

CREATE TABLE IF NOT EXISTS accounts (
  id SERIAL PRIMARY KEY,
  shopkeeper_name TEXT NOT NULL DEFAULT '',
  phone TEXT UNIQUE,
  pin_salt TEXT,
  pin_hash TEXT,
  session_token TEXT,
  claimed BOOLEAN NOT NULL DEFAULT FALSE,
  is_owner BOOLEAN NOT NULL DEFAULT FALSE,
  admin_email TEXT UNIQUE,
  admin_password_salt TEXT,
  admin_password_hash TEXT,
  admin_session_token TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS user_feedback (
  id SERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL,
  sender_name TEXT NOT NULL,
  shop_name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  category feedback_category,
  message TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS business_settings (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL,
  business_name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'PKR',
  accent_color TEXT NOT NULL DEFAULT '#17765A',
  logo_blob_key TEXT,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS contacts (
  id SERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  kind contact_kind NOT NULL DEFAULT 'customer',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'item',
  unit_price INTEGER NOT NULL,
  unit_cost INTEGER NOT NULL DEFAULT 0,
  stock_quantity INTEGER NOT NULL DEFAULT 0,
  supplier_id INTEGER,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS invoices (
  id SERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL,
  invoice_number TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL DEFAULT '',
  customer_address TEXT NOT NULL DEFAULT '',
  issue_date TEXT NOT NULL,
  due_date TEXT,
  payment_status payment_status NOT NULL DEFAULT 'pending',
  payment_method payment_method NOT NULL DEFAULT 'cash',
  discount_type discount_type NOT NULL DEFAULT 'none',
  discount_value INTEGER NOT NULL DEFAULT 0,
  discount_amount INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL,
  subtotal INTEGER NOT NULL,
  total INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS invoice_items (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER NOT NULL,
  product_id INTEGER,
  description TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'item',
  quantity INTEGER NOT NULL,
  unit_price INTEGER NOT NULL,
  unit_cost INTEGER NOT NULL DEFAULT 0,
  line_total INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS purchase_invoices (
  id SERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL,
  purchase_number TEXT NOT NULL UNIQUE,
  supplier_id INTEGER NOT NULL,
  supplier_name TEXT NOT NULL,
  supplier_phone TEXT NOT NULL DEFAULT '',
  supplier_address TEXT NOT NULL DEFAULT '',
  issue_date TEXT NOT NULL,
  due_date TEXT,
  document_type document_type NOT NULL DEFAULT 'delivered_purchase',
  delivery_status delivery_status NOT NULL DEFAULT 'delivered',
  payment_status payment_status NOT NULL DEFAULT 'pending',
  payment_method payment_method NOT NULL DEFAULT 'credit',
  supplier_reference TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL,
  total INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS purchase_invoice_items (
  id SERIAL PRIMARY KEY,
  purchase_invoice_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  description TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'item',
  quantity INTEGER NOT NULL,
  unit_cost INTEGER NOT NULL,
  line_total INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invoices_account ON invoices(account_id);
CREATE INDEX IF NOT EXISTS idx_contacts_account ON contacts(account_id);
CREATE INDEX IF NOT EXISTS idx_products_account ON products(account_id);
CREATE INDEX IF NOT EXISTS idx_purchases_account ON purchase_invoices(account_id);`;

let migrated = false;

export async function ensureInit(): Promise<void> {
  if (migrated) return;
  // One-time: if old rebuild tables exist with incompatible schema
  // (missing account_id), drop them so the exact schema can be created.
  // This only runs when the schema is wrong, never on normal starts.
  try {
    const check = await getSql().unsafe(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'products' AND column_name = 'account_id'
    `);
    if (check.length === 0) {
      // products exists but has old schema (or doesn't exist) — drop conflicts
      const drops = [
        "DROP TABLE IF EXISTS invoice_items",
        "DROP TABLE IF EXISTS purchase_invoice_items",
        "DROP TABLE IF EXISTS invoices",
        "DROP TABLE IF EXISTS purchase_invoices",
        "DROP TABLE IF EXISTS products",
      ];
      for (const sql of drops) {
        try { await getSql().unsafe(sql); } catch { /* ignore */ }
      }
    }
  } catch { /* ignore — tables don't exist yet */ }
  const sql = getSql();
  // Enum types first (each DO block is one statement; never split these).
  for (const stmt of ENUM_STATEMENTS) {
    await sql.unsafe(stmt);
  }
  // Tables + indexes: one statement per semicolon-separated chunk.
  for (const stmt of MIGRATION_SQL.split(";")) {
    const trimmed = stmt.trim();
    if (trimmed) await sql.unsafe(trimmed);
  }
  // Create owner admin account if none exists (for first-time setup)
  try {
    const ownerCheck = await getSql().unsafe("SELECT id FROM accounts WHERE is_owner = true LIMIT 1");
    if (ownerCheck.length === 0) {
      await getSql().unsafe(`
        INSERT INTO accounts (shopkeeper_name, admin_email, is_owner, claimed, created_at, updated_at)
        VALUES ('Hadia', 'hadiaghazanfar354@gmail.com', true, true, NOW(), NOW())
      `);
    }
  } catch { /* ignore */ }
  migrated = true;
}
