import type { CookieOptions, CookieOptionsWithName } from "@supabase/ssr"

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
  if (trustedUrl === null) return true
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

/**
 * A fresh storage namespace intentionally requires legacy sessions to sign in again.
 * The browser enforces host-only scope for every hosted session and PKCE chunk.
 */
export function supabaseAuthCookieConfiguration(
  supabaseUrl: string,
  options: {
    environment?: SupabaseAuthCookieEnvironment
  } = {},
): CookieOptionsWithName & { name: string } {
  const url = new URL(supabaseUrl)
  const project = url.hostname.split(".")[0]
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    !/^[A-Za-z0-9-]{1,63}$/.test(project)
  ) {
    throw new Error("supabase_cookie_configuration_invalid")
  }
  const secure = supabaseAuthCookiesMustBeSecure(options)
  return {
    name: `${secure ? "__Host-" : ""}cs-${project}-auth-v2`,
    path: "/",
    sameSite: "lax",
    secure,
  }
}


/** Validate raw names before framework or SDK parsing can collapse duplicates.
 * Session and PKCE storage each permit a base value or contiguous chunks.
 * Legacy names are deliberately ignored, never migrated into trusted storage.
 */
export function parseSupabaseAuthCookies(
  header: string | null,
  baseName: string,
): Array<{ name: string; value: string }> {
  if (!header) return []
  if (new TextEncoder().encode(header).length > 128 * 1024) return []
  const roots = [baseName, `${baseName}-code-verifier`]
  const items = new Map<string, string>()
  for (const segment of header.split(";")) {
    const separator = segment.indexOf("=")
    if (separator < 0) continue
    const name = segment.slice(0, separator).trim()
    const root = roots.find(value => name === value || name.startsWith(`${value}.`))
    if (!root) continue
    if (items.has(name) || /[\u0000-\u001f\u007f]/.test(segment)) return []
    const suffix = name.slice(root.length)
    if (suffix && !/^\.(?:[0-9]|[12][0-9]|3[01])$/.test(suffix)) return []
    try {
      items.set(name, decodeURIComponent(segment.slice(separator + 1).trim()))
    } catch {
      return []
    }
  }
  for (const root of roots) {
    const chunks = Array.from(items.keys()).filter(name => name.startsWith(`${root}.`))
    if (chunks.length && items.has(root)) return []
    for (let index = 0; index < chunks.length; index += 1) {
      if (!items.has(`${root}.${index}`)) return []
    }
  }
  return Array.from(items, ([name, value]) => ({ name, value }))
}
