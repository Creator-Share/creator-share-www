import "server-only"

import { createHash, timingSafeEqual } from "node:crypto"

export function isAuthorizedAdvocateInvitationEmailWorkerRequest(
  authorizationHeader: string | null,
  expectedSecret: string,
): boolean {
  if (!authorizationHeader?.startsWith("Bearer ")) return false
  const supplied = authorizationHeader.slice("Bearer ".length)
  const valid = (value: string) =>
    value.length >= 32 &&
    value.length <= 1_024 &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f\s]/.test(value)
  if (!valid(supplied) || !valid(expectedSecret)) return false

  return timingSafeEqual(
    createHash("sha256").update(supplied).digest(),
    createHash("sha256").update(expectedSecret).digest(),
  )
}
