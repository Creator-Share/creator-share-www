/**
 * Supabase Storage URL Utilities
 *
 * Generates direct storage URLs. Image optimization is handled by
 * Next.js <Image> and /_next/image — no Supabase transforms are used.
 *
 * For cases where Supabase transforms are needed (e.g. email rendering
 * without Next.js), use media.ts's generatePublicUrl with { forceTransform: true }.
 */

export interface ImageTransformOptions {
  width?: number
  height?: number
  quality?: number
  resize?: 'cover' | 'contain' | 'fill'
  format?: 'origin'
}

/**
 * Generate a direct storage URL for a given bucket + path.
 * Used by the admin image upload route for immediate display in responses.
 * Image optimization is handled by the consuming Next.js <Image> component.
 */
export const getTransformedImageUrl = (
  bucket: string,
  path: string,
  _options?: ImageTransformOptions,
): string => {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "")
  if (!base) {
    throw new Error("Environment variable NEXT_PUBLIC_SUPABASE_URL is not set")
  }
  return `${base}/storage/v1/object/public/${bucket}/${encodeURI(path)}`
}
