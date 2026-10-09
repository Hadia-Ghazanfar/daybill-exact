// Blob storage for the Daybill Vercel API.
//
// The artifact used the space runtime's blob store (ctx.blobs.put/getUrl/
// delete) for shop logos. This port implements the same three-method
// interface on Supabase Storage so the uploadLogo handler logic stays
// identical.
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Optional env: LOGO_BUCKET (default "shop-logos"). The bucket is created
// as public on first use if it does not exist yet.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;
let bucketReady = false;

function bucketName(): string {
  return process.env.LOGO_BUCKET || "shop-logos";
}

function getClient(): SupabaseClient {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured for logo storage");
    client = createClient(url, key);
  }
  return client;
}

async function ensureBucket(): Promise<void> {
  if (bucketReady) return;
  const supabase = getClient();
  const bucket = bucketName();
  const { data } = await supabase.storage.listBuckets();
  if (!data?.some((b) => b.name === bucket)) {
    const { error } = await supabase.storage.createBucket(bucket, { public: true });
    // Race-safe: another instance may have created it concurrently.
    if (error && !/already exists/i.test(error.message)) throw new Error(`Could not create logo bucket: ${error.message}`);
  }
  bucketReady = true;
}

export interface Blobs {
  put(key: string, bytes: Uint8Array, opts: { contentType: string }): Promise<void>;
  getUrl(key: string): Promise<string>;
  delete(key: string): Promise<void>;
}

export function isBlobStorageConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export const blobs: Blobs = {
  async put(key, bytes, opts) {
    await ensureBucket();
    const { error } = await getClient().storage.from(bucketName()).upload(key, bytes, {
      contentType: opts.contentType,
      upsert: true,
    });
    if (error) throw new Error(`Logo upload failed: ${error.message}`);
  },
  async getUrl(key) {
    if (key.startsWith("data:")) return key;
    await ensureBucket();
    const { data } = getClient().storage.from(bucketName()).getPublicUrl(key);
    return data.publicUrl;
  },
  async delete(key) {
    const { error } = await getClient().storage.from(bucketName()).remove([key]);
    if (error) throw new Error(`Logo delete failed: ${error.message}`);
  },
};
