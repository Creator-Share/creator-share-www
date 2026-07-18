import "server-only"

import { createHash } from "node:crypto"

import { isQualifyingAdvocateExposurePagePath } from "@/lib/advocates/publicBrowsePaths"

import { toSupabaseRpcBytea, type SupabaseRpcBytea } from "./crypto"
import {
  sponsorshipVisitorDigestFromToken,
  type VerifiedSponsorshipVisitorToken,
} from "./visitorCookie"

const EXPOSURE_WINDOW_MILLISECONDS = 5 * 60 * 1000
const BOT_USER_AGENT_PATTERN =
  /(?:bot|crawler|spider|preview|facebookexternalhit|slackbot|discordbot|whatsapp|telegrambot|headless|lighthouse)/i

export interface QualifiedExposureContext {
  pagePath: string
  referrerHost: string | null
}

export function shouldRejectExposureRequest(
  headers: Headers,
  expectedOrigin: string,
): boolean {
  const purpose = `${headers.get("purpose") || ""} ${
    headers.get("sec-purpose") || ""
  }`
  if (/prefetch|prerender/i.test(purpose)) return true
  if (headers.get("next-router-prefetch") !== null) return true

  if (headers.get("sec-fetch-site") !== "same-origin") return true
  if (headers.get("origin") !== expectedOrigin) return true

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
  if (
    !referrerUrl.pathname.startsWith("/") ||
    referrerUrl.pathname.length > 500
  ) {
    return null
  }
  if (!isQualifyingAdvocateExposurePagePath(referrerUrl.pathname)) return null

  return {
    pagePath: referrerUrl.pathname,
    referrerHost: null,
  }
}

export function digestSponsorshipVisitorToken(
  token: VerifiedSponsorshipVisitorToken,
): { digest: Buffer; digestRpcBytea: SupabaseRpcBytea } {
  const digest = sponsorshipVisitorDigestFromToken(token)
  if (digest === null) {
    throw new Error("Invalid sponsorship visitor token")
  }

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
