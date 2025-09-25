// Assumptions:
// - The storage bucket is public.
// - Files are stored under the pattern: media/{parent_id}/{type}/{id}.{extension}
// - getStorageKey returns the key/path inside the bucket (no bucket name).
// - NEXT_PUBLIC_SUPABASE_URL must be set in the environment for public URL generation.

import { STORAGE_BUCKET } from "@/utils/supabase/buckets";
import type { Database } from "@/lib/types/db.types";

export type MediaRow = Database["public"]["Tables"]["media"]["Row"];

/**
 * Compose the storage key for a media row.
 * Expected format: "{parent_id}/{type}/{id}.{extension}"
 */
export const getStorageKey = (media: MediaRow): string => {
  if (!media) {
    throw new Error("Invalid media: media is required");
  }

  const parentId = media.parent_id;
  const type = media.type;
  const id = media.id;
  const extension = media.extension;

  if (!parentId || String(parentId).trim() === "") {
    throw new Error("Invalid media: parent_id is required");
  }
  if (!type || String(type).trim() === "") {
    throw new Error("Invalid media: type is required");
  }
  if (!id || String(id).trim() === "") {
    throw new Error("Invalid media: id is required");
  }
  if (!extension || String(extension).trim() === "") {
    throw new Error("Invalid media: extension is required");
  }

  // Normalize pieces to strings (in case of enums)
  const normalizedType = String(type);
  const normalizedParentId = String(parentId);
  const normalizedId = String(id);
  const normalizedExt = String(extension).replace(/^\./, "");

  return `${normalizedParentId}/${normalizedType}/${normalizedId}.${normalizedExt}`;
};

/**
 * Generate the public URL for a given media row.
 * Format:
 * `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${getStorageKey(media)}`
 */
export const generatePublicUrl = (media: MediaRow): string => {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) {
    throw new Error("Environment variable NEXT_PUBLIC_SUPABASE_URL is not set");
  }

  const key = getStorageKey(media);
  return `${base.replace(/\/$/, "")}/storage/v1/object/public/${STORAGE_BUCKET}/${encodeURI(key)}`;
};

/**
 * Generate a public URL directly from a storage key (no bucket name).
 */
export const getPublicUrlFromKey = (key: string): string => {
  if (!key || key.trim() === "") {
    throw new Error("Storage key is required");
  }
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) {
    throw new Error("Environment variable NEXT_PUBLIC_SUPABASE_URL is not set");
  }
  return `${base.replace(/\/$/, "")}/storage/v1/object/public/${STORAGE_BUCKET}/${encodeURI(key)}`;
};

/**
 * Upload a file to the storage bucket at path getStorageKey(media)
 *
 * Note: callers should provide a supabase client instance (do not construct one here).
 */
export async function uploadFile(
  supabaseClient: ReturnType<typeof import("@/utils/supabase/client").createClient>,
  media: MediaRow,
  file: File | Blob | Buffer,
  opts?: { cacheControl?: string; upsert?: boolean; contentType?: string }
): Promise<{ error: any | null; data?: any }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!supabaseClient) {
    throw new Error("supabaseClient is required");
  }
  if (!file) {
    throw new Error("file is required");
  }

  const path = getStorageKey(media);

  const options: { cacheControl?: string; upsert?: boolean; contentType?: string } = {};
  if (opts?.cacheControl) options.cacheControl = opts.cacheControl;
  if (typeof opts?.upsert === "boolean") options.upsert = opts.upsert;
  if (opts?.contentType) options.contentType = opts.contentType;

  const result = await supabaseClient.storage.from(STORAGE_BUCKET).upload(path, file as any, options); // eslint-disable-line @typescript-eslint/no-explicit-any
  // result is in shape { data, error } from supabase-js
  return { error: result.error ?? null, data: result.data };
}

/**
 * Delete a file from the storage bucket at path getStorageKey(media)
 */
export async function deleteFile(
  supabaseClient: ReturnType<typeof import("@/utils/supabase/client").createClient>,
  media: MediaRow
): Promise<{ error: any | null; data?: any }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!supabaseClient) {
    throw new Error("supabaseClient is required");
  }

  const path = getStorageKey(media);
  const result = await supabaseClient.storage.from(STORAGE_BUCKET).remove([path]);
  return { error: result.error ?? null, data: result.data };
}