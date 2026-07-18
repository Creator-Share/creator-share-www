import "server-only"

import { createHash } from "node:crypto"

import { toSupabaseRpcBytea, type SupabaseRpcBytea } from "./crypto"
import { isValidSponsorshipVisitorToken } from "./visitorCookie"

const EXPOSURE_WINDOW_MILLISECONDS = 5 * 60 * 1000
const BOT_USER_AGENT_PATTERN =
  /(?:bot|crawler|spider|preview|facebookexternalhit|slackbot|discordbot|whatsapp|telegrambot|headless|lighthouse)/i

export interface QualifiedExposureContext {
  pagePath: string
  referrerHost: string | null
}

export function shouldRejectExposureRequest(headers: Headers): boolean {
  const purpose = `${headers.get("purpose") || ""} ${
    headers.get("sec-purpose") || ""
  }`
  if (/prefetch|prerender/i.test(purpose)) return true
  if (headers.get("next-router-prefetch") !== null) return true

  const fetchSite = headers.get("sec-fetch-site")
  if (fetchSite && fetchSite !== "same-origin") return true

  const userAgent = headers.get("user-agent") || ""
  return !userAgent || BOT_USER_AGENT_PATTERN.test(userAgent)
}

export function getQualifiedExposureContext(
  referrer: string | null,
  expectedHostname: string,
  expectedPort: number | null,
): QualifiedExposureContext | null {
  if (!referrer) return null

  let referrerUrl: URL
  try {
    referrerUrl = new URL(referrer)
  } catch {
    return null
  }

  if (referrerUrl.protocol !== "https:" && referrerUrl.protocol !== "http:") {
    return null
  }

  const expectedHost = expectedPort
    ? `${expectedHostname}:${expectedPort}`
    : expectedHostname
  if (referrerUrl.host.toLowerCase() !== expectedHost.toLowerCase()) return null
  if (!referrerUrl.pathname.startsWith("/") || referrerUrl.pathname.length > 500) {
    return null
  }

  return {
    pagePath: referrerUrl.pathname,
    referrerHost: null,
  }
}

export function digestSponsorshipVisitorToken(
  token: string,
): { digest: Buffer; digestRpcBytea: SupabaseRpcBytea } {
  if (!isValidSponsorshipVisitorToken(token)) {
    throw new Error("Invalid sponsorship visitor token")
  }

  const digest = createHash("sha256").update(token, "utf8").digest()
  return { digest, digestRpcBytea: toSupabaseRpcBytea(digest) }
}

function formatUuid(bytes: Buffer): string {
  const hex = bytes.toString("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
    12,
    16,
  )}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

export function createQualifiedExposureEventKey({
  visitorDigest,
  advocateHostname,
  pagePath,
  authUserId,
  observedAt,
}: {
  visitorDigest: Uint8Array
  advocateHostname: string
  pagePath: string
  authUserId: string | null
  observedAt: Date
}): string {
  const windowNumber = Math.floor(
    observedAt.getTime() / EXPOSURE_WINDOW_MILLISECONDS,
  )
  const digest = createHash("sha256")
    .update("creator-share/qualified-exposure/v1\0", "utf8")
    .update(visitorDigest)
    .update("\0", "utf8")
    .update(advocateHostname, "utf8")
    .update("\0", "utf8")
    .update(pagePath, "utf8")
    .update("\0", "utf8")
    .update(authUserId || "guest", "utf8")
    .update("\0", "utf8")
    .update(String(windowNumber), "utf8")
    .digest()
    .subarray(0, 16)

  digest[6] = (digest[6] & 0x0f) | 0x40
  digest[8] = (digest[8] & 0x3f) | 0x80
  return formatUuid(digest)
}
