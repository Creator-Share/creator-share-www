import "server-only"

import { createHash } from "node:crypto"

export * from "./visitorCookieToken"

import type { VerifiedSponsorshipVisitorToken } from "./visitorCookieToken"

const VISITOR_TOKEN_BYTES = 32
const VISITOR_TOKEN_PATTERN = /^v2\.([A-Za-z0-9_-]{43})\.[A-Za-z0-9_-]{22}$/

function sponsorshipVisitorIdFromToken(
  value: VerifiedSponsorshipVisitorToken,
): string | null {
  return VISITOR_TOKEN_PATTERN.exec(value)?.[1] ?? null
}

/**
 * Produces the one canonical database join key for an authenticated visitor.
 * Callers must first authenticate the cookie with readSponsorshipVisitorCookie.
 */
export function sponsorshipVisitorDigestFromToken(
  value: VerifiedSponsorshipVisitorToken,
): Buffer | null {
  const visitorId = sponsorshipVisitorIdFromToken(value)
  if (visitorId === null) return null
  const visitorIdBytes = Buffer.from(visitorId, "base64url")
  if (
    visitorIdBytes.length !== VISITOR_TOKEN_BYTES ||
    visitorIdBytes.toString("base64url") !== visitorId
  ) {
    return null
  }
  return createHash("sha256").update(visitorIdBytes).digest()
}
