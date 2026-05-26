// Assumptions:
// - The storage bucket is public.
// - Files are stored under the pattern: media/{parent_id}/{type}/{id}.{extension}
// - getStorageKey returns the key/path inside the bucket (no bucket name).
// - NEXT_PUBLIC_SUPABASE_URL must be set in the environment for public URL generation.

import { STORAGE_BUCKET } from "@/utils/supabase/buckets"
import type { Database } from "@/lib/types/db.types"
import { createClient } from "@/utils/supabase/client"

export type MediaRow = Database["public"]["Tables"]["media"]["Row"]

/**
 * Compose the storage key for a media row.
 * Expected format: "{parent_id}/{type}/{id}.{extension}"
 */
export const getStorageKey = (media: MediaRow): string => {
  if (!media) {
    throw new Error("Invalid media: media is required")
  }

  const parentId = media.parent_id
  const type = media.type
  const id = media.id
  const extension = media.extension

  if (!parentId || String(parentId).trim() === "") {
    throw new Error("Invalid media: parent_id is required")
  }
  if (!type || String(type).trim() === "") {
    throw new Error("Invalid media: type is required")
  }
  if (!id || String(id).trim() === "") {
    throw new Error("Invalid media: id is required")
  }
  if (!extension || String(extension).trim() === "") {
    throw new Error("Invalid media: extension is required")
  }

  // Normalize pieces to strings (in case of enums)
  const normalizedType = String(type)
  const normalizedParentId = String(parentId)
  const normalizedId = String(id)
  const normalizedExt = String(extension).replace(/^\./, "")

  return `${normalizedParentId}/${normalizedType}/${normalizedId}.${normalizedExt}`
}

/* ---- Shared internal helpers ---- */

export interface ImageTransformOptions {
  width?: number
  height?: number
  quality?: number
  resize?: 'cover' | 'contain' | 'fill'
  format?: 'origin'
}

/**
 * Build a direct storage URL for a given key.
 * Always returns the /storage/v1/object/public/ path (no Supabase transforms).
 */
function buildStorageUrl(key: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "")
  if (!base) {
    throw new Error("Environment variable NEXT_PUBLIC_SUPABASE_URL is not set")
  }
  return `${base}/storage/v1/object/public/${STORAGE_BUCKET}/${encodeURI(key)}`
}

/* ---- Public API ---- */

export interface GeneratePublicUrlOptions {
  /**
   * When true, generates a Supabase-transformed URL instead of a direct storage URL.
   * Used only for email rendering (email clients don't go through Next.js <Image>).
   * Requires Supabase Pro plan for the /render/image/ endpoint.
   */
  forceTransform?: boolean
}

/**
 * Generate a public URL for a given media row.
 *
 * By default returns a direct /storage/v1/object/public/ URL which relies on
 * Next.js <Image> optimization for resizing and format conversion.
 *
 * Pass { forceTransform: true } when the URL will be used outside of Next.js
 * rendering (e.g. email <img> tags), to get a Supabase-transformed WebP URL.
 *
 * For videos and other media types, always returns the direct public URL.
 */
export const generatePublicUrl = (
  media: MediaRow,
  options?: GeneratePublicUrlOptions,
): string => {
  const key = getStorageKey(media)

  if (
    media.type === "IMAGE" &&
    options?.forceTransform
  ) {
    // Supabase transform — used by email where <Image> optimization isn't available
    const { data } = createClient().storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(key, {
        transform: {
          width: 800,
          height: 800,
          quality: 85,
          resize: "cover",
        },
      })
    return data.publicUrl
  }

  return buildStorageUrl(key)
}

/**
 * Generate a thumbnail URL for progressive image loading (blur-up effect).
 * Returns a Next.js /_next/image URL optimized to 16px at low quality.
 * The caller should render this via <Image unoptimized={true}> with CSS blur.
 * Returns undefined when the URL cannot be constructed.
 */
export const generateThumbnailUrl = (media: MediaRow): string | undefined => {
  if (media.type !== "IMAGE") return undefined

  try {
    const directUrl = buildStorageUrl(getStorageKey(media))
    const encodedUrl = encodeURIComponent(directUrl)
    return `/_next/image?url=${encodedUrl}&w=16&q=20`
  } catch (error) {
    console.warn("Failed to generate thumbnail URL:", error)
    return undefined
  }
}

/**
 * Derive a displayable URL from a media object that may carry either a storage
 * id (preferred) or a legacy image_url string. Used uniformly across card and
 * modal components so the logic is never duplicated.
 */
export const getImageSrc = (image: { id?: string; image_url?: string }): string => {
  if (image.id) {
    try {
      return generatePublicUrl(image as unknown as MediaRow)
    } catch {
      return image.image_url || ""
    }
  }
  return image.image_url || ""
}

/**
 * Derive a thumbnail URL for progressive blur-up loading. Returns undefined
 * when thumbnail generation is not possible -- callers should skip progressive
 * loading in that case and render the full image directly.
 */
export const getThumbnailSrc = (image: { id?: string; image_url?: string }): string | undefined => {
  if (image.id) {
    try {
      return generateThumbnailUrl(image as unknown as MediaRow)
    } catch {
      return undefined
    }
  }
  return undefined
}

/**
 * Generate a public URL directly from a storage key (no bucket name).
 */
export const getPublicUrlFromKey = (key: string): string => {
  if (!key || key.trim() === "") {
    throw new Error("Storage key is required")
  }
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!base) {
    throw new Error("Environment variable NEXT_PUBLIC_SUPABASE_URL is not set")
  }
  return `${base.replace(/\/$/, "")}/storage/v1/object/public/${STORAGE_BUCKET}/${encodeURI(key)}`
}

/**
 * Upload a file to the storage bucket at path getStorageKey(media)
 *
 * Note: callers should provide a supabase client instance (do not construct one here).
 */
export async function uploadFile(
  supabaseClient: ReturnType<
    typeof import("@/utils/supabase/client").createClient
  >,
  media: MediaRow,
  file: File | Blob | Buffer,
  opts?: { cacheControl?: string; upsert?: boolean; contentType?: string },
): Promise<{ error: unknown | null; data?: unknown }> {
  if (!supabaseClient) {
    throw new Error("supabaseClient is required")
  }
  if (!file) {
    throw new Error("file is required")
  }

  const path = getStorageKey(media)

  const options: {
    cacheControl?: string
    upsert?: boolean
    contentType?: string
  } = {}
  if (opts?.cacheControl) options.cacheControl = opts.cacheControl
  if (typeof opts?.upsert === "boolean") options.upsert = opts.upsert
  if (opts?.contentType) options.contentType = opts.contentType

  const result = await supabaseClient.storage
    .from(STORAGE_BUCKET)
    .upload(path, file, options)
  // result is in shape { data, error } from supabase-js
  return { error: result.error ?? null, data: result.data }
}

/**
 * Delete a file from the storage bucket at path getStorageKey(media)
 */
export async function deleteFile(
  supabaseClient: ReturnType<
    typeof import("@/utils/supabase/client").createClient
  >,
  media: MediaRow,
): Promise<{ error: unknown | null; data?: unknown }> {
  if (!supabaseClient) {
    throw new Error("supabaseClient is required")
  }

  const path = getStorageKey(media)
  const result = await supabaseClient.storage
    .from(STORAGE_BUCKET)
    .remove([path])
  return { error: result.error ?? null, data: result.data }
}
