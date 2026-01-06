/**
 * Version-controlled placeholder image utilities
 * Uses SVG file directly from the public folder
 */

/**
 * Path to placeholder SVG in public folder
 * Use this directly for all image components
 */
export const PERSON_PLACEHOLDER_PATH = '/placeholder-person.svg'

/**
 * Get full URL for placeholder (only needed for external services like Stripe)
 * @param baseUrl - Base URL of the application (defaults to env var or production URL)
 */
export function getPlaceholderImageUrl(baseUrl?: string): string {
  const base = baseUrl || process.env.NEXT_PUBLIC_BASE_URL || "https://creator-share-www.vercel.app"
  return `${base}${PERSON_PLACEHOLDER_PATH}`
}

