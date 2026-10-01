const LOCAL_PART_PATTERN = /^[\p{L}\p{N}!#$%&'*+\-/=?^_`{|}~.]+$/u
const DOMAIN_LABEL_PATTERN = /^[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?$/u

export type PasswordRecoveryRequestDisposition =
  "accepted" | "rejected" | "ambiguous"

export type PasswordRecoveryVerificationDisposition =
  "accepted" | "rejected" | "ambiguous"

export type PasswordChangeDisposition =
  "accepted" | "rejected" | "unauthorized" | "ambiguous"

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  )
}

function exactObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function classifyPasswordRecoveryRequestResponse(
  status: number,
  body: unknown,
): PasswordRecoveryRequestDisposition {
  const candidate = exactObject(body)
  if (
    status === 202 &&
    candidate !== null &&
    hasExactKeys(candidate, ["status"]) &&
    candidate.status === "check-email"
  ) {
    return "accepted"
  }

  if (
    status === 400 &&
    candidate !== null &&
    hasExactKeys(candidate, ["error"]) &&
    candidate.error === "invalid-request"
  ) {
    return "rejected"
  }

  return "ambiguous"
}

export function classifyPasswordRecoveryVerificationResponse(
  status: number,
  body: unknown,
): PasswordRecoveryVerificationDisposition {
  const candidate = exactObject(body)
  if (
    status === 200 &&
    candidate !== null &&
    hasExactKeys(candidate, ["message"]) &&
    candidate.message === "OTP verified successfully."
  ) {
    return "accepted"
  }

  if (
    status === 400 &&
    candidate !== null &&
    hasExactKeys(candidate, ["error"]) &&
    (candidate.error === "verification-failed" ||
      candidate.error === "invalid-request")
  ) {
    return "rejected"
  }

  return "ambiguous"
}

export function classifyPasswordChangeResponse(
  status: number,
  body: unknown,
): PasswordChangeDisposition {
  const candidate = exactObject(body)
  if (
    status === 200 &&
    candidate !== null &&
    hasExactKeys(candidate, ["message"]) &&
    candidate.message === "Password reset successful! User has been logged out."
  ) {
    return "accepted"
  }

  if (
    status === 400 &&
    candidate !== null &&
    hasExactKeys(candidate, ["error"]) &&
    candidate.error === "invalid-request"
  ) {
    return "rejected"
  }

  if (
    status === 401 &&
    candidate !== null &&
    hasExactKeys(candidate, ["error"]) &&
    candidate.error === "unauthorized"
  ) {
    return "unauthorized"
  }

  return "ambiguous"
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function hasValidDomain(domain: string): boolean {
  if (domain.startsWith(".") || domain.endsWith(".") || domain.includes("..")) {
    return false
  }

  return domain
    .split(".")
    .every(
      (label) =>
        utf8ByteLength(label) <= 63 && DOMAIN_LABEL_PATTERN.test(label),
    )
}

/**
 * Mirrors the server's v1 sponsor email normalization without importing the
 * server-only crypto module into a client bundle. Provider-specific rewriting,
 * including removal of plus tags or punctuation, is deliberately forbidden.
 */
export function normalizePasswordRecoveryEmail(
  candidate: unknown,
): string | null {
  if (
    typeof candidate !== "string" ||
    candidate.length > 1024 ||
    utf8ByteLength(candidate) > 1024
  ) {
    return null
  }

  let normalized: string
  try {
    normalized = candidate.normalize("NFKC").trim().toLowerCase()
  } catch {
    return null
  }

  const normalizedBytes = utf8ByteLength(normalized)
  if (
    normalizedBytes < 3 ||
    normalizedBytes > 254 ||
    /[\p{Cc}\p{Z}]/u.test(normalized)
  ) {
    return null
  }

  const separator = normalized.indexOf("@")
  if (separator <= 0 || separator !== normalized.lastIndexOf("@")) {
    return null
  }

  const localPart = normalized.slice(0, separator)
  const domain = normalized.slice(separator + 1)
  if (
    utf8ByteLength(localPart) > 64 ||
    utf8ByteLength(domain) > 253 ||
    localPart.startsWith(".") ||
    localPart.endsWith(".") ||
    localPart.includes("..") ||
    !LOCAL_PART_PATTERN.test(localPart) ||
    !hasValidDomain(domain)
  ) {
    return null
  }

  return normalized
}
