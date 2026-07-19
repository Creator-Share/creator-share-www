const OPERATION_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const ADVOCATE_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export type InitialOwnerClientOperationKind = "reissue" | "revoke"

export interface SavedInitialOwnerClientOperation {
  version: 1
  operationId: string
  advocateId: string
  expectedVersion: number
}

const STORAGE_KEY_PREFIX: Readonly<
  Record<InitialOwnerClientOperationKind, string>
> = Object.freeze({
  reissue: "creator-share:initial-owner-reissue-operation:v1:",
  revoke: "creator-share:initial-owner-revocation-operation:v1:",
})

export function initialOwnerClientOperationStorageKey(
  kind: InitialOwnerClientOperationKind,
  advocateId: string,
): string {
  return `${STORAGE_KEY_PREFIX[kind]}${advocateId}`
}

export function parseSavedInitialOwnerClientOperation(
  value: unknown,
): SavedInitialOwnerClientOperation | null {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("|") !==
      "advocateId|expectedVersion|operationId|version" ||
    !("version" in value) ||
    value.version !== 1 ||
    !("operationId" in value) ||
    typeof value.operationId !== "string" ||
    !OPERATION_UUID_PATTERN.test(value.operationId) ||
    !("advocateId" in value) ||
    typeof value.advocateId !== "string" ||
    !ADVOCATE_UUID_PATTERN.test(value.advocateId) ||
    !("expectedVersion" in value) ||
    typeof value.expectedVersion !== "number" ||
    !Number.isSafeInteger(value.expectedVersion) ||
    value.expectedVersion < 1
  ) {
    return null
  }
  return Object.freeze({
    version: 1,
    operationId: value.operationId,
    advocateId: value.advocateId,
    expectedVersion: value.expectedVersion,
  })
}
