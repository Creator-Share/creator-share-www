import "server-only"

import {
  SPONSOR_ACCOUNT_EMAIL_CONFIRMATION_PATH,
  SPONSOR_ACCOUNT_MANAGEMENT_PAGE_PATH,
} from "@/lib/sponsorships/accountClaim"
import { normalizeSponsorEmailV1 } from "@/lib/sponsorships/crypto"

export { SPONSOR_ACCOUNT_MANAGEMENT_PAGE_PATH }
export const MAXIMUM_PASSWORDLESS_ACCESS_BODY_BYTES = 1024
export const MAXIMUM_SPONSOR_REAUTHENTICATION_BODY_BYTES = 64

export interface PasswordlessAccessRequest {
  email: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function parseJsonObject(
  serializedBody: string,
): Record<string, unknown> | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(serializedBody)
  } catch {
    return null
  }

  return isRecord(parsed) ? parsed : null
}

/**
 * Accepts only one bounded email field. Account existence is deliberately not
 * part of parsing or the public response contract.
 */
export function parsePasswordlessAccessRequest(
  serializedBody: string,
): PasswordlessAccessRequest | null {
  if (
    typeof serializedBody !== "string" ||
    Buffer.byteLength(serializedBody, "utf8") >
      MAXIMUM_PASSWORDLESS_ACCESS_BODY_BYTES
  ) {
    return null
  }

  const parsed = parseJsonObject(serializedBody)
  if (
    parsed === null ||
    Object.keys(parsed).length !== 1 ||
    typeof parsed.email !== "string"
  ) {
    return null
  }

  try {
    return { email: normalizeSponsorEmailV1(parsed.email) }
  } catch {
    return null
  }
}

export function normalizeAuthenticatedSponsorEmail(
  value: unknown,
): string | null {
  if (typeof value !== "string") return null
  try {
    return normalizeSponsorEmailV1(value)
  } catch {
    return null
  }
}

/**
 * Reauthentication has no browser-supplied identity or redirect parameters.
 * An exact empty object makes accidental expansion of this boundary visible.
 */
export function isValidSponsorReauthenticationBody(
  serializedBody: string,
): boolean {
  if (
    typeof serializedBody !== "string" ||
    Buffer.byteLength(serializedBody, "utf8") >
      MAXIMUM_SPONSOR_REAUTHENTICATION_BODY_BYTES
  ) {
    return false
  }

  const parsed = parseJsonObject(serializedBody)
  return parsed !== null && Object.keys(parsed).length === 0
}

export function buildSponsorManagementMagicLinkCallback(
  canonicalOrigin: string,
): string {
  const callback = new URL(
    SPONSOR_ACCOUNT_EMAIL_CONFIRMATION_PATH,
    canonicalOrigin,
  )
  callback.searchParams.set("next", SPONSOR_ACCOUNT_MANAGEMENT_PAGE_PATH)
  return callback.toString()
}

export async function readBoundedSponsorManagementBody(
  request: Request,
  maximumBytes: number,
): Promise<string | null> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 2) return null

  const contentLength = request.headers.get("content-length")
  if (
    contentLength !== null &&
    (!/^\d{1,10}$/.test(contentLength) || Number(contentLength) > maximumBytes)
  ) {
    return null
  }

  if (request.body === null) return null

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let receivedBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      receivedBytes += value.byteLength
      if (receivedBytes > maximumBytes) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
    return Buffer.concat(chunks).toString("utf8")
  } catch {
    return null
  } finally {
    reader.releaseLock()
  }
}
