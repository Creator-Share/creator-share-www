import {
  ADVOCATE_TENANT_ROOT,
  resolveAdvocateHost,
} from "@/lib/advocates/host"

export const SPONSORSHIP_VISITOR_COOKIE_NAME = "cs_sponsorship_visitor_v1"
export const SPONSORSHIP_VISITOR_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60

const VISITOR_TOKEN_BYTES = 32
const VISITOR_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

export interface SponsorshipVisitorCookieOptions {
  domain?: string
  httpOnly: true
  maxAge: number
  path: "/"
  sameSite: "lax"
  secure: boolean
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")
}

export function createSponsorshipVisitorToken(): string {
  const bytes = new Uint8Array(VISITOR_TOKEN_BYTES)
  crypto.getRandomValues(bytes)
  return encodeBase64Url(bytes)
}

export function isValidSponsorshipVisitorToken(
  value: string | null | undefined,
): value is string {
  return typeof value === "string" && VISITOR_TOKEN_PATTERN.test(value)
}

function getNormalizedHostname(rawHost: string | null): string | null {
  const resolution = resolveAdvocateHost(rawHost, {
    allowLocalhostDevelopment: true,
  })

  if (resolution.kind === "invalid") return null
  if (resolution.kind === "tenant-candidate") {
    return resolution.requestHostname
  }
  return resolution.normalizedHostname
}

export function getSponsorshipVisitorCookieOptions(
  rawHost: string | null,
  requestIsSecure: boolean,
): SponsorshipVisitorCookieOptions {
  const hostname = getNormalizedHostname(rawHost)
  const isCreatorShareDomain =
    hostname === ADVOCATE_TENANT_ROOT ||
    hostname?.endsWith(`.${ADVOCATE_TENANT_ROOT}`) === true

  return {
    ...(isCreatorShareDomain
      ? { domain: `.${ADVOCATE_TENANT_ROOT}` }
      : {}),
    httpOnly: true,
    maxAge: SPONSORSHIP_VISITOR_COOKIE_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: isCreatorShareDomain || requestIsSecure,
  }
}
