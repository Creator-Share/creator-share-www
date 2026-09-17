import "server-only"

import { createHash, timingSafeEqual } from "node:crypto"

type PublicationCanaryWorkerEnvironment = Readonly<
  Record<string, string | undefined>
>

function validSecret(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 32 &&
    value.length <= 4_096 &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value)
  )
}

export function loadPublicationCanaryWorkerSecret(
  environment: PublicationCanaryWorkerEnvironment = process.env,
): string {
  const selected = environment.CRON_SECRET
  if (!validSecret(selected)) {
    throw new Error("advocate_publication_canary_worker_secret_invalid")
  }
  return selected
}

export function isAuthorizedPublicationCanaryWorkerRequest(
  authorizationHeader: string | null,
  expectedSecret: string,
): boolean {
  if (!authorizationHeader?.startsWith("Bearer ")) return false
  const supplied = authorizationHeader.slice("Bearer ".length)
  if (!validSecret(supplied) || !validSecret(expectedSecret)) return false

  const suppliedDigest = createHash("sha256").update(supplied).digest()
  const expectedDigest = createHash("sha256").update(expectedSecret).digest()
  return timingSafeEqual(suppliedDigest, expectedDigest)
}
