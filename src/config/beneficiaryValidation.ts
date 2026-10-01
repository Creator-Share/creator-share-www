import { isBeneficiaryType } from "@/types/admin.types"

export const MAX_BENEFICIARY_USERNAME_LENGTH = 160

const PUBLIC_BENEFICIARY_FIELD_LIMITS = {
  name: 300,
  biography: 100_000,
  country: 300,
  location_str: 1_000,
  video_url: 4_096,
  introduction: 100_000,
} as const

// RFC 3986 unreserved characters are safe in one URL path segment without
// changing route structure or fragment and query semantics.
const PUBLIC_BENEFICIARY_USERNAME_PATTERN = /^[A-Za-z0-9._~-]{1,160}$/
const RESERVED_PUBLIC_BENEFICIARY_USERNAMES = new Set([".", "..", "checkout"])
const PUBLIC_BENEFICIARY_TYPE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/
const PUBLIC_MEDIA_EXTENSION_PATTERN = /^[A-Za-z0-9]{1,32}$/
const PUBLIC_ACTIVITY_TYPES = new Set(["INFO", "UPDATE", "SUBSCRIPTION"])
const SINGLE_LINE_CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/
const MULTILINE_CONTROL_PATTERN =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/
const UTF8_ENCODER = new TextEncoder()

function isWithinUtf8ByteLimit(value: string, maximumBytes: number): boolean {
  return (
    value.length <= maximumBytes &&
    UTF8_ENCODER.encode(value).byteLength <= maximumBytes
  )
}

function isBoundedSingleLineText(
  value: unknown,
  maximumBytes: number,
  required: boolean,
): value is string {
  return (
    typeof value === "string" &&
    (!required || value.length > 0) &&
    isWithinUtf8ByteLimit(value, maximumBytes) &&
    !SINGLE_LINE_CONTROL_PATTERN.test(value)
  )
}

function isNullableBoundedText(
  value: unknown,
  maximumBytes: number,
  forbiddenPattern: RegExp,
): boolean {
  return (
    value === null ||
    (typeof value === "string" &&
      isWithinUtf8ByteLimit(value, maximumBytes) &&
      !forbiddenPattern.test(value))
  )
}

export function isValidBeneficiaryUsername(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_BENEFICIARY_USERNAME_LENGTH &&
    PUBLIC_BENEFICIARY_USERNAME_PATTERN.test(value) &&
    !RESERVED_PUBLIC_BENEFICIARY_USERNAMES.has(value.toLowerCase())
  )
}

export type BeneficiaryFieldWriteResolution =
  | { action: "write"; value: string }
  | { action: "preserve" }
  | { action: "reject" }

export function resolveBeneficiaryUsernameWrite(
  submittedValue: unknown,
  storedValue: unknown,
): BeneficiaryFieldWriteResolution {
  if (
    submittedValue === storedValue &&
    !isValidBeneficiaryUsername(submittedValue)
  ) {
    return { action: "preserve" }
  }

  const normalizedValue =
    typeof submittedValue === "string" ? submittedValue.trim() : ""
  return isValidBeneficiaryUsername(normalizedValue)
    ? { action: "write", value: normalizedValue }
    : { action: "reject" }
}

export function resolveBeneficiaryTypeWrite(
  submittedValue: unknown,
  storedValue: unknown,
): BeneficiaryFieldWriteResolution {
  if (isBeneficiaryType(submittedValue)) {
    return { action: "write", value: submittedValue }
  }
  return submittedValue === storedValue
    ? { action: "preserve" }
    : { action: "reject" }
}

export function beneficiaryUpdateRequiresStoredRow(
  data: Record<string, unknown>,
): boolean {
  return (
    (Object.hasOwn(data, "username") &&
      !isValidBeneficiaryUsername(data.username)) ||
    (Object.hasOwn(data, "beneficiary_type") &&
      !isBeneficiaryType(data.beneficiary_type))
  )
}

export type PreparedBeneficiaryUpdate =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; field: "username" | "beneficiary_type" }

export function prepareLegacyPreservingBeneficiaryUpdate(
  editableData: Record<string, unknown>,
  storedBeneficiary: Record<string, unknown> | null,
): PreparedBeneficiaryUpdate {
  const data = { ...editableData }

  if (Object.hasOwn(data, "username")) {
    const resolution = resolveBeneficiaryUsernameWrite(
      data.username,
      storedBeneficiary?.username,
    )
    if (resolution.action === "reject") {
      return { ok: false, field: "username" }
    }
    if (resolution.action === "preserve") delete data.username
    else data.username = resolution.value
  }

  if (Object.hasOwn(data, "beneficiary_type")) {
    const resolution = resolveBeneficiaryTypeWrite(
      data.beneficiary_type,
      storedBeneficiary?.beneficiary_type,
    )
    if (resolution.action === "reject") {
      return { ok: false, field: "beneficiary_type" }
    }
    if (resolution.action === "preserve") delete data.beneficiary_type
    else data.beneficiary_type = resolution.value
  }

  return { ok: true, data }
}

export function isWithinPublicBeneficiaryTextByteLimit(
  value: string,
  maximumBytes: number,
): boolean {
  return isWithinUtf8ByteLimit(value, maximumBytes)
}

export function findInvalidPublicBeneficiaryProjectionField(
  source: Record<string, unknown>,
): string | null {
  if (
    Object.hasOwn(source, "name") &&
    !isBoundedSingleLineText(
      source.name,
      PUBLIC_BENEFICIARY_FIELD_LIMITS.name,
      true,
    )
  ) {
    return "name"
  }
  if (
    Object.hasOwn(source, "username") &&
    !isValidBeneficiaryUsername(source.username)
  ) {
    return "username"
  }

  for (const [field, maximumBytes] of [
    ["country", PUBLIC_BENEFICIARY_FIELD_LIMITS.country],
    ["location_str", PUBLIC_BENEFICIARY_FIELD_LIMITS.location_str],
    ["video_url", PUBLIC_BENEFICIARY_FIELD_LIMITS.video_url],
  ] as const) {
    if (
      Object.hasOwn(source, field) &&
      !isNullableBoundedText(
        source[field],
        maximumBytes,
        SINGLE_LINE_CONTROL_PATTERN,
      )
    ) {
      return field
    }
  }

  for (const field of ["biography", "introduction"] as const) {
    if (
      Object.hasOwn(source, field) &&
      !isNullableBoundedText(
        source[field],
        PUBLIC_BENEFICIARY_FIELD_LIMITS[field],
        MULTILINE_CONTROL_PATTERN,
      )
    ) {
      return field
    }
  }

  if (
    Object.hasOwn(source, "beneficiary_type") &&
    source.beneficiary_type !== null &&
    (typeof source.beneficiary_type !== "string" ||
      !PUBLIC_BENEFICIARY_TYPE_PATTERN.test(source.beneficiary_type))
  ) {
    return "beneficiary_type"
  }

  return null
}

export function isValidPublicMediaExtension(value: unknown): value is string {
  return typeof value === "string" && PUBLIC_MEDIA_EXTENSION_PATTERN.test(value)
}

export function findInvalidPublicActivityProjectionField(
  source: Record<string, unknown>,
): string | null {
  if (
    Object.hasOwn(source, "description") &&
    !isNullableBoundedText(
      source.description,
      100_000,
      MULTILINE_CONTROL_PATTERN,
    )
  ) {
    return "description"
  }
  if (
    Object.hasOwn(source, "title") &&
    !isNullableBoundedText(source.title, 10_000, MULTILINE_CONTROL_PATTERN)
  ) {
    return "title"
  }
  if (
    Object.hasOwn(source, "activity_type") &&
    source.activity_type !== null &&
    (typeof source.activity_type !== "string" ||
      !PUBLIC_ACTIVITY_TYPES.has(source.activity_type))
  ) {
    return "activity_type"
  }
  return null
}
