import "server-only"

import { createHash, timingSafeEqual } from "node:crypto"

export type ArchivedAdvocateDomainCleanupEnvironment = Readonly<
  Record<string, string | undefined>
>

function validSecret(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 32 &&
    value.length <= 1_024 &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f\s]/.test(value)
  )
}

export function loadArchivedAdvocateDomainCleanupWorkerSecret(
  environment: ArchivedAdvocateDomainCleanupEnvironment = process.env,
): string {
  const dedicated = environment.ARCHIVED_ADVOCATE_DOMAIN_CLEANUP_WORKER_SECRET
  if (environment.VERCEL === "1" && dedicated) {
    throw new Error("Archived advocate domain cleanup worker is unavailable")
  }

  const selected =
    dedicated === undefined || dedicated === ""
      ? environment.CRON_SECRET
      : dedicated
  if (!validSecret(selected)) {
    throw new Error("Archived advocate domain cleanup worker is unavailable")
  }
  return selected
}

export function isAuthorizedArchivedAdvocateDomainCleanupWorkerRequest(
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
