import type { CookieOptions } from "@supabase/ssr"

export type SupabaseAuthCookieEnvironment = Readonly<
  Record<string, string | undefined>
>

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname.endsWith(".localhost")
  )
}

function parsedTrustedUrl(value: string | undefined): URL | null {
  if (!value || value !== value.trim() || value.length > 2_048) return null

  try {
    const url = new URL(value)
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username !== "" ||
      url.password !== ""
    ) {
      return null
    }
    return url
  } catch {
    return null
  }
}

/**
 * Hosted authentication cookies must never be eligible for plaintext HTTP.
 * Only an explicit loopback HTTP URL in a nonproduction process may opt out.
 */
export function supabaseAuthCookiesMustBeSecure(
  options: {
    environment?: SupabaseAuthCookieEnvironment
    trustedUrl?: string
  } = {},
): boolean {
  const environment = options.environment ?? process.env
  if (environment.NODE_ENV === "production") return true

  const trustedUrl = parsedTrustedUrl(
    options.trustedUrl ?? environment.NEXT_PUBLIC_BASE_URL,
  )
  if (trustedUrl === null) return false
  if (trustedUrl.protocol === "https:") return true
  return !isLoopbackHostname(trustedUrl.hostname)
}

export function secureSupabaseAuthCookieOptions(
  cookieOptions: CookieOptions | undefined,
  options: {
    environment?: SupabaseAuthCookieEnvironment
    forceSecure?: boolean
    trustedUrl?: string
  } = {},
): CookieOptions | undefined {
  if (
    options.forceSecure !== true &&
    !supabaseAuthCookiesMustBeSecure(options)
  ) {
    return cookieOptions
  }
  return { ...cookieOptions, secure: true }
}
