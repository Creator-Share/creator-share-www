import "server-only"

import type { AdvocateLogoReconciliationFailureCode } from "./repository"

const ADVOCATE_ASSET_BUCKET = "advocate-assets"
const LOGO_OBJECT_PATH_PATTERN =
  /^logos\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/

interface StorageBucket {
  remove(paths: string[]): PromiseLike<unknown>
}

export interface AdvocateLogoReconciliationStorageClient {
  storage: {
    from(bucket: string): StorageBucket
  }
}

export interface AdvocateLogoReconciliationStorage {
  deleteObject(objectPath: string): Promise<"deleted" | "already_absent">
}

export class AdvocateLogoReconciliationStorageError extends Error {
  readonly failureCode: Exclude<
    AdvocateLogoReconciliationFailureCode,
    "worker_interrupted"
  >

  constructor(
    failureCode: Exclude<
      AdvocateLogoReconciliationFailureCode,
      "worker_interrupted"
    >,
  ) {
    super("advocate_logo_reconciliation_storage_failed")
    this.name = "AdvocateLogoReconciliationStorageError"
    this.failureCode = failureCode
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isExactStorageResult(
  value: unknown,
): value is { data: unknown; error: unknown } {
  if (!isRecord(value)) return false
  const keys = Object.keys(value).sort()
  return keys.length === 2 && keys[0] === "data" && keys[1] === "error"
}

function isNotFoundError(value: unknown): boolean {
  if (!isRecord(value)) return false
  return (
    value.status === 404 ||
    value.status === "404" ||
    value.statusCode === 404 ||
    value.statusCode === "404"
  )
}

function numericStatus(value: unknown): number | null {
  if (!isRecord(value)) return null
  for (const candidate of [value.status, value.statusCode]) {
    if (
      typeof candidate === "number" &&
      Number.isSafeInteger(candidate) &&
      candidate >= 100 &&
      candidate <= 599
    ) {
      return candidate
    }
    if (typeof candidate === "string" && /^\d{3}$/.test(candidate)) {
      return Number(candidate)
    }
  }
  return null
}

function classifiedStorageError(
  value: unknown,
): AdvocateLogoReconciliationStorageError {
  const originalError = isRecord(value) ? value.originalError : undefined
  if (
    (value instanceof DOMException && value.name === "AbortError") ||
    (isRecord(value) && value.name === "AbortError") ||
    (originalError instanceof DOMException &&
      originalError.name === "AbortError") ||
    (isRecord(originalError) && originalError.name === "AbortError")
  ) {
    return new AdvocateLogoReconciliationStorageError("storage_timeout")
  }
  const status = numericStatus(value)
  if (status === 408) {
    return new AdvocateLogoReconciliationStorageError("storage_timeout")
  }
  if (status === 429) {
    return new AdvocateLogoReconciliationStorageError("storage_rate_limited")
  }
  if (status !== null && status >= 500) {
    return new AdvocateLogoReconciliationStorageError("storage_unavailable")
  }
  if (value instanceof TypeError || originalError instanceof TypeError) {
    return new AdvocateLogoReconciliationStorageError("storage_unavailable")
  }
  return new AdvocateLogoReconciliationStorageError("storage_delete_failed")
}

export function createSupabaseAdvocateLogoReconciliationStorage(
  client: AdvocateLogoReconciliationStorageClient,
): AdvocateLogoReconciliationStorage {
  return {
    async deleteObject(objectPath) {
      if (!LOGO_OBJECT_PATH_PATTERN.test(objectPath)) {
        throw new AdvocateLogoReconciliationStorageError(
          "unexpected_storage_response",
        )
      }

      let result: unknown
      try {
        result = await client.storage
          .from(ADVOCATE_ASSET_BUCKET)
          .remove([objectPath])
      } catch (error) {
        throw classifiedStorageError(error)
      }
      if (!isExactStorageResult(result)) {
        throw new AdvocateLogoReconciliationStorageError(
          "unexpected_storage_response",
        )
      }
      if (result.error !== null) {
        if (isNotFoundError(result.error)) return "already_absent"
        throw classifiedStorageError(result.error)
      }
      if (!Array.isArray(result.data)) {
        throw new AdvocateLogoReconciliationStorageError(
          "unexpected_storage_response",
        )
      }
      if (result.data.length === 0) return "deleted"
      if (
        result.data.length !== 1 ||
        !isRecord(result.data[0]) ||
        result.data[0].name !== objectPath
      ) {
        throw new AdvocateLogoReconciliationStorageError(
          "unexpected_storage_response",
        )
      }
      return "deleted"
    },
  }
}
