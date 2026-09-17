import "server-only"

import { createHash } from "node:crypto"

import { toSupabaseRpcBytea, type SupabaseRpcBytea } from "./crypto"
import {
  sponsorshipVisitorDigestFromToken,
  type VerifiedSponsorshipVisitorToken,
} from "./visitorCookie"

const EXPOSURE_WINDOW_MILLISECONDS = 5 * 60 * 1000
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
