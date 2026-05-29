// Assumptions:
// - The storage bucket is public.
// - Files are stored under the pattern: media/{parent_id}/{type}/{id}.{extension}
// - getStorageKey returns the key/path inside the bucket (no bucket name).
// - NEXT_PUBLIC_SUPABASE_URL must be set in the environment for public URL generation.

import { STORAGE_BUCKET } from "@/utils/supabase/buckets"
import type { Database } from "@/lib/types/db.types"

export type MediaRow = Database["public"]["Tables"]["media"]["Row"]

type MediaImage = Partial<
  Pick<MediaRow, "id" | "parent_id" | "type" | "extension">
> & {
  image_url?: string | null
}

type StorageListClient = {
  storage: {
    from: (bucket: string) => {
      list: (
        path: string,
        options?: { limit?: number; search?: string },
      ) => Promise<{
        data: Array<{ name: string }> | null
        error: { message?: string } | null
      }>
    }
  }
}

export interface ExternalImageOptions {
  width?: number
  height?: number
  quality?: number
  resize?: "cover" | "contain" | "fill"
  format?: "origin"
}

const getSupabaseBaseUrl = (): string => {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!base) {
    throw new Error("Environment variable NEXT_PUBLIC_SUPABASE_URL is not set")
  }
  return base.replace(/\/$/, "")
}

const encodeStoragePath = (path: string): string =>
  path.split("/").map(encodeURIComponent).join("/")

const buildTransformQuery = (options: ExternalImageOptions): string => {
  const params = new URLSearchParams()
  if (options.width) params.set("width", String(options.width))
  if (options.height) params.set("height", String(options.height))
  if (options.quality) params.set("quality", String(options.quality))
  if (options.resize) params.set("resize", options.resize)
  if (options.format) params.set("format", options.format)
  return params.toString()
}

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

export const getDirectMediaUrl = (media: MediaRow): string => {
  const base = getSupabaseBaseUrl()
  const key = getStorageKey(media)
  return `${base}/storage/v1/object/public/${STORAGE_BUCKET}/${encodeStoragePath(key)}`
}

export const getExternalImageUrl = (
  media: MediaRow,
  options: ExternalImageOptions = {},
): string => {
  if (media.type !== "IMAGE") return getDirectMediaUrl(media)

  const base = getSupabaseBaseUrl()
  const key = getStorageKey(media)
  const query = buildTransformQuery(options)
  const url = `${base}/storage/v1/render/image/public/${STORAGE_BUCKET}/${encodeStoragePath(key)}`
  return query ? `${url}?${query}` : url
}

export const getExternalProfileImageUrl = (media: MediaRow): string =>
  getExternalImageUrl(media, {
    width: 600,
    height: 600,
    quality: 85,
    resize: "cover",
  })

export const getExternalActivityImageUrl = (media: MediaRow): string =>
  getExternalImageUrl(media, {
    width: 600,
    quality: 82,
    resize: "contain",
  })

export const getExternalCheckoutImageUrl = (media: MediaRow): string =>
  getExternalImageUrl(media, {
    width: 800,
    height: 800,
    quality: 85,
    resize: "cover",
  })

export const getExternalTelegramImageUrl = (media: MediaRow): string =>
  getExternalCheckoutImageUrl(media)

export const getBrowserImageSrc = (image: MediaImage): string => {
  if (image.id) {
    try {
      return getDirectMediaUrl(image as MediaRow)
    } catch {
      return image.image_url || ""
    }
  }
  return image.image_url || ""
}

export const getBrowserThumbnailSrc = (
  _image?: MediaImage,
): string | undefined => {
  void _image
  return undefined
}

/**
 * Compatibility wrapper. Browser paths should use direct storage URLs so
 * next/image and Vercel own browser optimization.
 */
export const generatePublicUrl = (media: MediaRow): string =>
  getDirectMediaUrl(media)

/**
 * Compatibility wrapper. Browser thumbnails are disabled so Supabase does not
 * transform images that Vercel will optimize in the browser.
 */
export const generateThumbnailUrl = (_media?: MediaRow): string | undefined => {
  void _media
  return undefined
}

export const getImageSrc = (image: MediaImage): string =>
  getBrowserImageSrc(image)

export const getThumbnailSrc = (image?: MediaImage): string | undefined =>
  getBrowserThumbnailSrc(image)

/**
 * Generate a public URL directly from a storage key (no bucket name).
 */
export const getPublicUrlFromKey = (key: string): string => {
  if (!key || key.trim() === "") {
    throw new Error("Storage key is required")
  }
  const base = getSupabaseBaseUrl()
  return `${base}/storage/v1/object/public/${STORAGE_BUCKET}/${encodeStoragePath(key)}`
}

export async function mediaFileExists(
  supabaseClient: StorageListClient,
  media: MediaRow,
): Promise<boolean> {
  const key = getStorageKey(media)
  const lastSlash = key.lastIndexOf("/")
  const folder = lastSlash >= 0 ? key.slice(0, lastSlash) : ""
  const fileName = lastSlash >= 0 ? key.slice(lastSlash + 1) : key

  const { data, error } = await supabaseClient.storage
    .from(STORAGE_BUCKET)
    .list(folder, { limit: 1, search: fileName })

  if (error) return false
  return Boolean(data?.some((item) => item.name === fileName))
}

export async function filterExistingMediaRows<T extends MediaRow>(
  supabaseClient: StorageListClient,
  mediaRows: T[],
): Promise<T[]> {
  const checks = await Promise.all(
    mediaRows.map(async (media) => ({
      media,
      exists: await mediaFileExists(supabaseClient, media),
    })),
  )
  return checks.filter((check) => check.exists).map((check) => check.media)
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
