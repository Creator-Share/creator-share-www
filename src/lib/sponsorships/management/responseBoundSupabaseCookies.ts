import "server-only"

import type { CookieOptions, CookieOptionsWithName } from "@supabase/ssr"
import type { NextResponse } from "next/server"

export const PASSWORD_RECOVERY_SUPABASE_COOKIE_NAME =
  "__Host-cs-password-recovery-v1"
export const LOCAL_PASSWORD_RECOVERY_SUPABASE_COOKIE_NAME =
  "cs_password_recovery_v1"
export const PASSWORD_RECOVERY_SUPABASE_COOKIE_MAX_AGE_SECONDS = 15 * 60

const MAXIMUM_COOKIE_NAME_BYTES = 256
const MAXIMUM_COOKIE_VALUE_BYTES = 65_536
const MAXIMUM_COOKIE_HEADER_BYTES = 128 * 1_024
const MAXIMUM_COOKIE_AGE_SECONDS = 400 * 24 * 60 * 60
const MAXIMUM_AUTH_COOKIE_CHUNKS = 32
const COOKIE_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"])
const ALLOWED_COOKIE_OPTION_KEYS = Object.freeze([
  "httpOnly",
  "maxAge",
  "path",
  "sameSite",
  "secure",
] as const)

export type SupabaseResponseCookie = Readonly<{
  name: string
  value: string
  options?: CookieOptions
}>

export type PasswordRecoverySupabaseCookieConfiguration = Readonly<{
  name: string
  secure: boolean
  cookieOptions: Readonly<
    Required<
      Pick<
        CookieOptionsWithName,
        "httpOnly" | "maxAge" | "name" | "path" | "sameSite" | "secure"
      >
    >
  >
}>

type RawCookie = Readonly<{ name: string; value: string }>
type SupabaseCookieCheckpoint = Readonly<{
  writeIndex: number
  authCookieNames: readonly string[]
}>

function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(hostname)
}

export function passwordRecoverySupabaseCookieConfiguration(
  canonicalOrigin: string,
): PasswordRecoverySupabaseCookieConfiguration {
  const parsed = new URL(canonicalOrigin)
  if (parsed.origin !== canonicalOrigin || parsed.username || parsed.password) {
    throw new Error("password_recovery_cookie_configuration_invalid")
  }

  const secure = parsed.protocol === "https:"
  if (
    !secure &&
    !(parsed.protocol === "http:" && isLoopbackHostname(parsed.hostname))
  ) {
    throw new Error("password_recovery_cookie_configuration_invalid")
  }

  const name = secure
    ? PASSWORD_RECOVERY_SUPABASE_COOKIE_NAME
    : LOCAL_PASSWORD_RECOVERY_SUPABASE_COOKIE_NAME
  return Object.freeze({
    name,
    secure,
    cookieOptions: Object.freeze({
      name,
      path: "/" as const,
      sameSite: "lax" as const,
      httpOnly: true,
      secure,
      maxAge: PASSWORD_RECOVERY_SUPABASE_COOKIE_MAX_AGE_SECONDS,
    }),
  })
}

export function defaultSupabaseAuthCookieName(supabaseUrl: string): string {
  const parsed = new URL(supabaseUrl)
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("supabase_cookie_configuration_invalid")
  }
  const projectLabel = parsed.hostname.split(".")[0] ?? ""
  if (!/^[A-Za-z0-9-]{1,63}$/.test(projectLabel)) {
    throw new Error("supabase_cookie_configuration_invalid")
  }
  return `sb-${projectLabel}-auth-token`
}

function authCookieChunkIndex(name: string, baseName: string): number | null {
  if (name === baseName) return -1
  if (!name.startsWith(`${baseName}.`)) return null
  const suffix = name.slice(baseName.length + 1)
  if (!/^(?:0|[1-9][0-9]?)$/.test(suffix)) return null
  const index = Number(suffix)
  return index < MAXIMUM_AUTH_COOKIE_CHUNKS ? index : null
}

function isExpectedAuthCookieName(name: string, baseName: string): boolean {
  return authCookieChunkIndex(name, baseName) !== null
}

function validAuthCookieTopology(options: {
  cookies: readonly Readonly<{ name: string; value: string }>[]
  authCookieName: string
  allowEmpty: boolean
}): readonly string[] | null {
  if (
    options.cookies.some(
      (cookie) =>
        !isExpectedAuthCookieName(cookie.name, options.authCookieName) ||
        (!options.allowEmpty && cookie.value.length === 0),
    )
  ) {
    return null
  }
  const names = new Set(options.cookies.map((cookie) => cookie.name))
  if (names.size !== options.cookies.length) return null
  if (names.size === 0) return Object.freeze([])

  const basePresent = names.has(options.authCookieName)
  const chunks = Array.from(names)
    .map((name) => ({
      name,
      index: authCookieChunkIndex(name, options.authCookieName),
    }))
    .filter(
      (entry): entry is { name: string; index: number } =>
        entry.index !== null && entry.index >= 0,
    )
    .sort((left, right) => left.index - right.index)
  if (basePresent) {
    return chunks.length === 0 ? Object.freeze([options.authCookieName]) : null
  }
  if (
    chunks.length === 0 ||
    chunks.some((entry, expectedIndex) => entry.index !== expectedIndex)
  ) {
    return null
  }
  return Object.freeze(chunks.map((entry) => entry.name))
}

function parseRawCookieHeader(
  rawCookieHeader: string | null,
): RawCookie[] | null {
  if (rawCookieHeader === null || rawCookieHeader === "") return []
  if (
    Buffer.byteLength(rawCookieHeader, "utf8") > MAXIMUM_COOKIE_HEADER_BYTES
  ) {
    return null
  }

  const cookies: RawCookie[] = []
  for (const rawSegment of rawCookieHeader.split(";")) {
    const segment = rawSegment.trim()
    if (segment === "") continue
    const separator = segment.indexOf("=")
    if (separator <= 0) return null
    const name = segment.slice(0, separator).trim()
    const value = segment.slice(separator + 1).trim()
    try {
      assertCookieWrite({ name, value })
    } catch {
      return null
    }
    cookies.push(Object.freeze({ name, value }))
  }
  return cookies
}

/**
 * Parses one isolated Supabase storage item from the raw Cookie header. The raw
 * header is authoritative because NextRequest collapses same-name host and
 * parent-domain cookies before application code can detect cookie tossing.
 */
export function parseIsolatedSupabaseAuthCookies(options: {
  rawCookieHeader: string | null
  authCookieName: string
}): readonly RawCookie[] | null {
  if (
    !COOKIE_NAME_PATTERN.test(options.authCookieName) ||
    Buffer.byteLength(options.authCookieName, "utf8") >
      MAXIMUM_COOKIE_NAME_BYTES
  ) {
    return null
  }

  const parsed = parseRawCookieHeader(options.rawCookieHeader)
  if (parsed === null) return null
  const matching = parsed.filter((cookie) =>
    isExpectedAuthCookieName(cookie.name, options.authCookieName),
  )
  if (matching.length > MAXIMUM_AUTH_COOKIE_CHUNKS) return null

  const byName = new Map<string, RawCookie>()
  for (const cookie of matching) {
    if (byName.has(cookie.name)) return null
    byName.set(cookie.name, cookie)
  }

  const names = validAuthCookieTopology({
    cookies: Array.from(byName.values()),
    authCookieName: options.authCookieName,
    allowEmpty: true,
  })
  return names === null
    ? null
    : Object.freeze(names.map((name) => byName.get(name) as RawCookie))
}

function matchingAuthCookieNames(options: {
  rawCookieHeader: string | null
  authCookieName: string
}): readonly string[] | null {
  const parsed = parseRawCookieHeader(options.rawCookieHeader)
  if (parsed === null) return null
  const names = new Set<string>([options.authCookieName])
  for (const cookie of parsed) {
    if (isExpectedAuthCookieName(cookie.name, options.authCookieName)) {
      names.add(cookie.name)
      if (names.size > MAXIMUM_AUTH_COOKIE_CHUNKS + 1) return null
    }
  }
  return Object.freeze(Array.from(names))
}

function assertCookieWrite(
  value: SupabaseResponseCookie,
  expectedAuthCookieName?: string,
  expectedSecure?: boolean,
): void {
  if (
    !value ||
    typeof value !== "object" ||
    typeof value.name !== "string" ||
    Buffer.byteLength(value.name, "utf8") < 1 ||
    Buffer.byteLength(value.name, "utf8") > MAXIMUM_COOKIE_NAME_BYTES ||
    !COOKIE_NAME_PATTERN.test(value.name) ||
    (expectedAuthCookieName !== undefined &&
      !isExpectedAuthCookieName(value.name, expectedAuthCookieName)) ||
    typeof value.value !== "string" ||
    Buffer.byteLength(value.value, "utf8") > MAXIMUM_COOKIE_VALUE_BYTES ||
    /[\u0000-\u001f\u007f]/.test(value.value) ||
    (value.options !== undefined &&
      (value.options === null || typeof value.options !== "object"))
  ) {
    throw new Error("supabase_cookie_write_invalid")
  }

  if (value.options !== undefined) {
    const optionKeys = Object.keys(value.options)
    if (
      optionKeys.some(
        (key) =>
          !ALLOWED_COOKIE_OPTION_KEYS.includes(
            key as (typeof ALLOWED_COOKIE_OPTION_KEYS)[number],
          ),
      ) ||
      Object.hasOwn(value.options, "domain") ||
      (value.options.path !== undefined && value.options.path !== "/") ||
      (value.options.sameSite !== undefined &&
        value.options.sameSite !== "lax") ||
      (value.options.httpOnly !== undefined &&
        typeof value.options.httpOnly !== "boolean") ||
      (value.options.secure !== undefined &&
        typeof value.options.secure !== "boolean") ||
      (value.options.maxAge !== undefined &&
        (!Number.isSafeInteger(value.options.maxAge) ||
          value.options.maxAge < 0 ||
          value.options.maxAge > MAXIMUM_COOKIE_AGE_SECONDS))
    ) {
      throw new Error("supabase_cookie_write_invalid")
    }
  }

  if (
    expectedAuthCookieName !== undefined &&
    (value.options === undefined ||
      value.options.path !== "/" ||
      value.options.sameSite !== "lax" ||
      value.options.httpOnly !== true ||
      value.options.secure !== expectedSecure ||
      value.options.maxAge === undefined)
  ) {
    throw new Error("supabase_cookie_write_invalid")
  }
}

function responseSetCookieHeaders(response: NextResponse): string[] {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[]
  }
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie()
  const combined = response.headers.get("set-cookie")
  return combined === null ? [] : [combined]
}

function responseHasAuthCookie(
  response: NextResponse,
  expectedCookieName: string,
  disposition: "session" | "clear",
): boolean {
  return responseSetCookieHeaders(response).some((header) => {
    const separator = header.indexOf("=")
    if (separator <= 0) return false
    const name = header.slice(0, separator)
    if (!isExpectedAuthCookieName(name, expectedCookieName)) return false
    const value = header.slice(separator + 1).split(";", 1)[0] ?? ""
    const clears = /Max-Age=0(?:;|$)/i.test(header)
    return disposition === "session"
      ? value.length > 0 && !clears
      : value.length === 0 && clears
  })
}

export function createPendingSupabaseCookieAdapter(options: {
  initialCookies: readonly Readonly<{ name: string; value: string }>[]
  authCookieName: string
  sessionMaxAgeSeconds: number
  secure: boolean
}) {
  if (
    !COOKIE_NAME_PATTERN.test(options.authCookieName) ||
    typeof options.secure !== "boolean" ||
    !Number.isSafeInteger(options.sessionMaxAgeSeconds) ||
    options.sessionMaxAgeSeconds < 1 ||
    options.sessionMaxAgeSeconds > MAXIMUM_COOKIE_AGE_SECONDS
  ) {
    throw new Error("supabase_cookie_configuration_invalid")
  }
  const expectedCookieName = options.authCookieName
  const currentCookies = new Map<string, string>()
  for (const cookie of options.initialCookies) {
    assertCookieWrite({ name: cookie.name, value: cookie.value })
    if (!isExpectedAuthCookieName(cookie.name, expectedCookieName)) {
      throw new Error("supabase_cookie_write_invalid")
    }
    if (currentCookies.has(cookie.name)) {
      throw new Error("supabase_cookie_write_invalid")
    }
    currentCookies.set(cookie.name, cookie.value)
  }

  const writes: SupabaseResponseCookie[] = []

  return Object.freeze({
    cookies: Object.freeze({
      getAll() {
        return Array.from(currentCookies, ([name, value]) => ({ name, value }))
      },
      setAll(cookiesToSet: SupabaseResponseCookie[]) {
        if (!Array.isArray(cookiesToSet)) {
          throw new Error("supabase_cookie_write_invalid")
        }
        const names = new Set<string>()
        for (const cookie of cookiesToSet) {
          assertCookieWrite(cookie, expectedCookieName, options.secure)
          if (names.has(cookie.name)) {
            throw new Error("supabase_cookie_write_invalid")
          }
          names.add(cookie.name)
        }
        for (const cookie of cookiesToSet) {
          const frozen = Object.freeze({
            name: cookie.name,
            value: cookie.value,
            ...(cookie.options === undefined
              ? {}
              : { options: Object.freeze({ ...cookie.options }) }),
          })
          writes.push(frozen)
          if (cookie.options?.maxAge === 0 && cookie.value === "") {
            currentCookies.delete(cookie.name)
          } else {
            currentCookies.set(cookie.name, cookie.value)
          }
        }
      },
    }),
    checkpoint(): SupabaseCookieCheckpoint {
      return Object.freeze({
        writeIndex: writes.length,
        authCookieNames: Object.freeze(
          Array.from(currentCookies.keys()).filter((name) =>
            isExpectedAuthCookieName(name, expectedCookieName),
          ),
        ),
      })
    },
    hasCurrentAuthSession(): boolean {
      return Array.from(currentCookies).some(
        ([name, value]) =>
          isExpectedAuthCookieName(name, expectedCookieName) &&
          value.length > 0,
      )
    },
    hasCompleteAuthSessionWriteSince(
      checkpoint: SupabaseCookieCheckpoint,
    ): boolean {
      if (
        !Number.isSafeInteger(checkpoint.writeIndex) ||
        checkpoint.writeIndex < 0 ||
        checkpoint.writeIndex > writes.length
      ) {
        return false
      }
      const recentFinalWrites = new Map<string, SupabaseResponseCookie>()
      for (const cookie of writes.slice(checkpoint.writeIndex)) {
        recentFinalWrites.set(cookie.name, cookie)
      }
      const currentAuthCookies = Array.from(
        currentCookies,
        ([name, value]) => ({
          name,
          value,
        }),
      ).filter((cookie) =>
        isExpectedAuthCookieName(cookie.name, expectedCookieName),
      )
      const activeNames = validAuthCookieTopology({
        cookies: currentAuthCookies,
        authCookieName: expectedCookieName,
        allowEmpty: false,
      })
      if (activeNames === null || activeNames.length === 0) return false

      return (
        activeNames.every((name) => {
          const write = recentFinalWrites.get(name)
          return (
            write !== undefined &&
            write.value.length > 0 &&
            write.options?.maxAge !== 0
          )
        }) &&
        checkpoint.authCookieNames.every((name) => recentFinalWrites.has(name))
      )
    },
    hasCompleteAuthSessionClearSince(
      checkpoint: SupabaseCookieCheckpoint,
    ): boolean {
      if (
        !Number.isSafeInteger(checkpoint.writeIndex) ||
        checkpoint.writeIndex < 0 ||
        checkpoint.writeIndex > writes.length ||
        checkpoint.authCookieNames.length === 0
      ) {
        return false
      }
      const recentFinalWrites = new Map<string, SupabaseResponseCookie>()
      for (const cookie of writes.slice(checkpoint.writeIndex)) {
        recentFinalWrites.set(cookie.name, cookie)
      }
      const currentAuthCookieCount = Array.from(currentCookies.keys()).filter(
        (name) => isExpectedAuthCookieName(name, expectedCookieName),
      ).length
      return (
        currentAuthCookieCount === 0 &&
        checkpoint.authCookieNames.every((name) => {
          const write = recentFinalWrites.get(name)
          return (
            write !== undefined &&
            write.value === "" &&
            write.options?.maxAge === 0
          )
        })
      )
    },
    applyTo(response: NextResponse): void {
      const finalWrites = new Map<string, SupabaseResponseCookie>()
      for (const cookie of writes) finalWrites.set(cookie.name, cookie)
      for (const cookie of finalWrites.values()) {
        const clear = cookie.value === "" && cookie.options?.maxAge === 0
        response.cookies.set(cookie.name, cookie.value, {
          ...cookie.options,
          path: "/",
          sameSite: "lax",
          httpOnly: true,
          secure: options.secure,
          maxAge: clear ? 0 : options.sessionMaxAgeSeconds,
        })
      }
    },
    responseHasAuthSession(response: NextResponse): boolean {
      return responseHasAuthCookie(response, expectedCookieName, "session")
    },
    responseHasAuthClear(response: NextResponse): boolean {
      return responseHasAuthCookie(response, expectedCookieName, "clear")
    },
  })
}

function cookieClearHeader(options: {
  name: string
  secure: boolean
  domain?: string
}): string {
  return [
    `${options.name}=`,
    ...(options.domain === undefined ? [] : [`Domain=${options.domain}`]),
    "Path=/",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "Max-Age=0",
    "HttpOnly",
    ...(options.secure ? ["Secure"] : []),
    "SameSite=lax",
  ].join("; ")
}

/**
 * Provider global signout revokes all refresh tokens. These deletion-only
 * headers also remove ambient default browser storage and any sibling-domain
 * shadow, so the success response never claims a complete local logout while
 * an older default Supabase cookie remains in the browser.
 */
export function appendDefaultSupabaseAuthCookieClearHeaders(options: {
  response: NextResponse
  rawCookieHeader: string | null
  supabaseUrl: string
  canonicalOrigin: string
}): void {
  const canonical = new URL(options.canonicalOrigin)
  const secure = canonical.protocol === "https:"
  if (
    !secure &&
    !(canonical.protocol === "http:" && isLoopbackHostname(canonical.hostname))
  ) {
    throw new Error("supabase_cookie_configuration_invalid")
  }
  const authCookieName = defaultSupabaseAuthCookieName(options.supabaseUrl)
  const names = matchingAuthCookieNames({
    rawCookieHeader: options.rawCookieHeader,
    authCookieName,
  })
  if (names === null) throw new Error("supabase_cookie_write_invalid")

  const parentDomain =
    secure && canonical.hostname === "creatorshare.com"
      ? ".creatorshare.com"
      : null
  for (const name of names) {
    options.response.headers.append(
      "Set-Cookie",
      cookieClearHeader({ name, secure }),
    )
    if (parentDomain !== null) {
      options.response.headers.append(
        "Set-Cookie",
        cookieClearHeader({ name, secure, domain: parentDomain }),
      )
    }
  }
}
