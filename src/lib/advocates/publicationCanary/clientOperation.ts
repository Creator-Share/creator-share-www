const OPERATION_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/

export interface SavedPublicationCanaryOperation {
  version: 1
  advocateId: string
  operationId: string
  expectedVersion: number
  adminReason: string
  runId: string | null
}

export type PublicationCanaryClientResponse =
  | Readonly<{
      kind: "pending"
      operationId: string
      runId: string
      retryAfterSeconds: number
    }>
  | Readonly<{
      kind: "published"
      operationId: string
      runId: string
      advocateVersion: number
    }>
  | Readonly<{
      kind: "terminal"
      operationId: string
      runId: string
      code:
        | "publication_canary_failed"
        | "publication_canary_expired"
        | "publication_deployment_changed"
    }>
  | Readonly<{
      kind: "failure"
      operationId: string
      code:
        | "invalid_request"
        | "unauthorized"
        | "forbidden"
        | "portal_not_found"
        | "publication_conflict"
        | "publication_failed"
        | "publication_configuration_unavailable"
        | "publication_unavailable"
    }>

const STATIC_FAILURE_STATUS = Object.freeze({
  invalid_request: 400,
  unauthorized: 401,
  forbidden: 403,
  portal_not_found: 404,
  publication_conflict: 409,
  publication_failed: 500,
  publication_configuration_unavailable: 503,
  publication_unavailable: 503,
} as const)

export function publicationCanaryOperationStorageKey(
  advocateId: string,
): string {
  return `creator-share:advocate-publication-operation:v1:${advocateId}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  )
}

function validPositiveVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1
}

function validReason(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    Array.from(value).length <= 2_000 &&
    value === value.trim() &&
    !CONTROL_CHARACTER_PATTERN.test(value)
  )
}

export function parseSavedPublicationCanaryOperation(
  value: unknown,
): SavedPublicationCanaryOperation | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "version",
      "advocateId",
      "operationId",
      "expectedVersion",
      "adminReason",
      "runId",
    ]) ||
    value.version !== 1 ||
    typeof value.advocateId !== "string" ||
    !UUID_PATTERN.test(value.advocateId) ||
    typeof value.operationId !== "string" ||
    !OPERATION_UUID_PATTERN.test(value.operationId) ||
    !validPositiveVersion(value.expectedVersion) ||
    !validReason(value.adminReason) ||
    (value.runId !== null &&
      (typeof value.runId !== "string" || !UUID_PATTERN.test(value.runId)))
  ) {
    return null
  }

  return Object.freeze({
    version: 1,
    advocateId: value.advocateId,
    operationId: value.operationId,
    expectedVersion: value.expectedVersion,
    adminReason: value.adminReason,
    runId: value.runId,
  })
}

export function publicationCanaryOperationsEqual(
  left: SavedPublicationCanaryOperation,
  right: SavedPublicationCanaryOperation,
): boolean {
  return (
    left.version === right.version &&
    left.advocateId === right.advocateId &&
    left.operationId === right.operationId &&
    left.expectedVersion === right.expectedVersion &&
    left.adminReason === right.adminReason &&
    left.runId === right.runId
  )
}

export function bindPublicationCanaryRun(
  operation: SavedPublicationCanaryOperation,
  runId: string,
): SavedPublicationCanaryOperation | null {
  if (!UUID_PATTERN.test(runId)) return null
  if (operation.runId !== null && operation.runId !== runId) return null
  if (operation.runId === runId) return operation
  return Object.freeze({ ...operation, runId })
}

export function parsePublicationCanaryClientResponse(
  value: unknown,
  expected: Readonly<{
    status: number
    operationId: string
    expectedVersion: number
    retryAfterHeader: string | null
  }>,
): PublicationCanaryClientResponse | null {
  if (
    !isRecord(value) ||
    !OPERATION_UUID_PATTERN.test(expected.operationId) ||
    !validPositiveVersion(expected.expectedVersion) ||
    value.operationId !== expected.operationId
  ) {
    return null
  }

  if (
    expected.status === 202 &&
    hasExactKeys(value, [
      "ok",
      "code",
      "operationId",
      "runId",
      "publicationStatus",
      "retryAfterSeconds",
    ]) &&
    value.ok === true &&
    value.code === "publication_canary_pending" &&
    typeof value.runId === "string" &&
    UUID_PATTERN.test(value.runId) &&
    value.publicationStatus === "verifying" &&
    typeof value.retryAfterSeconds === "number" &&
    Number.isSafeInteger(value.retryAfterSeconds) &&
    value.retryAfterSeconds >= 1 &&
    value.retryAfterSeconds <= 30 &&
    expected.retryAfterHeader === String(value.retryAfterSeconds)
  ) {
    return Object.freeze({
      kind: "pending",
      operationId: expected.operationId,
      runId: value.runId,
      retryAfterSeconds: value.retryAfterSeconds,
    })
  }

  if (
    expected.status === 200 &&
    hasExactKeys(value, [
      "ok",
      "code",
      "operationId",
      "runId",
      "advocateVersion",
    ]) &&
    value.ok === true &&
    value.code === "publication_committed" &&
    typeof value.runId === "string" &&
    UUID_PATTERN.test(value.runId) &&
    validPositiveVersion(value.advocateVersion) &&
    (value.advocateVersion === expected.expectedVersion + 1 ||
      value.advocateVersion === expected.expectedVersion + 2) &&
    expected.retryAfterHeader === null
  ) {
    return Object.freeze({
      kind: "published",
      operationId: expected.operationId,
      runId: value.runId,
      advocateVersion: value.advocateVersion,
    })
  }

  if (
    expected.status === 409 &&
    hasExactKeys(value, [
      "ok",
      "code",
      "operationId",
      "runId",
      "retryWithNewOperationId",
    ]) &&
    value.ok === false &&
    (value.code === "publication_canary_failed" ||
      value.code === "publication_canary_expired" ||
      value.code === "publication_deployment_changed") &&
    typeof value.runId === "string" &&
    UUID_PATTERN.test(value.runId) &&
    value.retryWithNewOperationId === true &&
    expected.retryAfterHeader === null
  ) {
    return Object.freeze({
      kind: "terminal",
      operationId: expected.operationId,
      runId: value.runId,
      code: value.code,
    })
  }

  if (
    hasExactKeys(value, ["ok", "code", "operationId"]) &&
    value.ok === false &&
    typeof value.code === "string" &&
    value.code in STATIC_FAILURE_STATUS &&
    STATIC_FAILURE_STATUS[value.code as keyof typeof STATIC_FAILURE_STATUS] ===
      expected.status &&
    expected.retryAfterHeader === null
  ) {
    return Object.freeze({
      kind: "failure",
      operationId: expected.operationId,
      code: value.code as keyof typeof STATIC_FAILURE_STATUS,
    })
  }

  return null
}
