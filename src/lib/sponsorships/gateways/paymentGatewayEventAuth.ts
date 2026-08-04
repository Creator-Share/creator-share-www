import "server-only"

import { createHash, timingSafeEqual } from "node:crypto"

export function isAuthorizedPaymentGatewayEventWorkerRequest(
  authorizationHeader: string | null,
  expectedSecret: string,
): boolean {
  if (!authorizationHeader?.startsWith("Bearer ")) return false
  const supplied = authorizationHeader.slice("Bearer ".length)
  if (!supplied || supplied !== supplied.trim()) return false

  const expectedDigest = createHash("sha256").update(expectedSecret).digest()
  const suppliedDigest = createHash("sha256").update(supplied).digest()
  return timingSafeEqual(expectedDigest, suppliedDigest)
}
