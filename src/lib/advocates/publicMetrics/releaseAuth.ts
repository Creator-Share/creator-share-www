import "server-only"

import { createHash, timingSafeEqual } from "node:crypto"

export type AdvocatePublicMetricReleaseEnvironment = Readonly<
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

export function loadAdvocatePublicMetricReleaseWorkerSecret(
  environment: AdvocatePublicMetricReleaseEnvironment = process.env,
): string {
  const dedicated = environment.ADVOCATE_PUBLIC_METRIC_RELEASE_WORKER_SECRET
  if (environment.VERCEL === "1" && dedicated) {
    throw new Error("Advocate public metric release worker is unavailable")
  }

  const selected =
    dedicated === undefined || dedicated === ""
      ? environment.CRON_SECRET
      : dedicated
  if (!validSecret(selected)) {
    throw new Error("Advocate public metric release worker is unavailable")
  }
  return selected
}

export function isAuthorizedAdvocatePublicMetricReleaseWorkerRequest(
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
