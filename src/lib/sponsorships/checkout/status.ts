import "server-only"

import type {
  SponsorshipCrypto,
  SupabaseRpcBytea,
} from "@/lib/sponsorships/crypto"

const MAXIMUM_STATUS_BODY_BYTES = 1024
const STATUS_VALUES = new Set([
  "created",
  "pending",
  "succeeded",
  "failed",
  "cancelled",
  "expired",
])

export interface CheckoutStatusRecord {
  checkout_status: string
  is_terminal: boolean
  status_updated_at: string
}

export interface CheckoutStatusRepository {
  readByReceiptDigest(
    digest: SupabaseRpcBytea,
  ): Promise<CheckoutStatusRecord | null>
}

export interface PublicCheckoutStatus {
  status:
    | "created"
    | "pending"
    | "succeeded"
    | "failed"
    | "cancelled"
    | "expired"
    | "unknown"
  terminal: boolean
  updatedAt: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

export function parseCheckoutStatusBody(rawBody: string): string | null {
  if (
    typeof rawBody !== "string" ||
    Buffer.byteLength(rawBody, "utf8") > MAXIMUM_STATUS_BODY_BYTES
  ) {
    return null
  }

  let value: unknown
  try {
    value = JSON.parse(rawBody)
  } catch {
    return null
  }
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 1 ||
    typeof value.receipt !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(value.receipt)
  ) {
    return null
  }
  return value.receipt
}

function unknownStatus(): PublicCheckoutStatus {
  return { status: "unknown", terminal: false, updatedAt: null }
}

/**
 * Resolves a bearer receipt to a deliberately narrow payment state. Provider
 * identifiers, sponsor identity, amounts, subscriptions, and contact details
 * never cross this boundary.
 */
export async function readPublicCheckoutStatus(options: {
  receipt: string
  crypto: SponsorshipCrypto
  repository: CheckoutStatusRepository
}): Promise<PublicCheckoutStatus> {
  let digest: SupabaseRpcBytea
  try {
    digest = `\\x${options.crypto
      .digestOpaqueToken(options.receipt)
      .toString("hex")}`
  } catch {
    return unknownStatus()
  }

  const record = await options.repository.readByReceiptDigest(digest)
  if (!record) return unknownStatus()
  if (
    !STATUS_VALUES.has(record.checkout_status) ||
    typeof record.is_terminal !== "boolean" ||
    typeof record.status_updated_at !== "string" ||
    !Number.isFinite(Date.parse(record.status_updated_at))
  ) {
    throw new Error("Invalid checkout status repository response")
  }

  const status = record.checkout_status as Exclude<
    PublicCheckoutStatus["status"],
    "unknown"
  >
  const expectedTerminal = [
    "succeeded",
    "failed",
    "cancelled",
    "expired",
  ].includes(status)
  if (record.is_terminal !== expectedTerminal) {
    throw new Error("Invalid checkout status repository response")
  }

  return {
    status,
    terminal: expectedTerminal,
    updatedAt: new Date(record.status_updated_at).toISOString(),
  }
}
