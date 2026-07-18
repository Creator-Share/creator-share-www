const CHECKOUT_OPERATION_STORAGE_KEY =
  "creator-share:sponsorship-checkout-operation:v1"
const CHECKOUT_RECEIPT_STORAGE_KEY =
  "creator-share:sponsorship-checkout-receipt:v1"
const CHECKOUT_STATE_VERSION = 1 as const
const CHECKOUT_OPERATION_MAX_AGE_MS = 35 * 60 * 1000
const CHECKOUT_RECEIPT_MAX_AGE_MS = 24 * 60 * 60 * 1000

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const OPAQUE_RECEIPT_PATTERN = /^[A-Za-z0-9_-]{43}$/
const CURRENCY_PATTERN = /^[A-Z]{3}$/

export type CheckoutOperationProvider = "stripe" | "paypal"
export type CheckoutOperationSubject = "standard" | "blind" | "partnership"
export type CheckoutOperationPaymentType =
  | "subscription"
  | "payment"
  | "one_time"

export interface CheckoutOperationScope {
  provider: CheckoutOperationProvider
  subject: CheckoutOperationSubject
  beneficiaryId: string | null
  partnershipProject:
    | "emergency"
    | "education"
    | "shelter"
    | "nutrition"
    | "general"
    | null
  paymentType: CheckoutOperationPaymentType
  baseAmountUsdCents: number
  currency: string
}

export interface CheckoutOperation {
  operationId: string
  scope: CheckoutOperationScope
  createdAt: string
}

export interface StoredCheckoutReceipt {
  receipt: string
  operationId: string
  storedAt: string
}

export interface CheckoutStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function isValidScope(value: unknown): value is CheckoutOperationScope {
  if (!isRecord(value)) return false

  return (
    (value.provider === "stripe" || value.provider === "paypal") &&
    (value.subject === "standard" ||
      value.subject === "blind" ||
      value.subject === "partnership") &&
    (value.beneficiaryId === null ||
      (typeof value.beneficiaryId === "string" &&
        UUID_PATTERN.test(value.beneficiaryId))) &&
    (value.partnershipProject === null ||
      value.partnershipProject === "emergency" ||
      value.partnershipProject === "education" ||
      value.partnershipProject === "shelter" ||
      value.partnershipProject === "nutrition" ||
      value.partnershipProject === "general") &&
    (value.paymentType === "subscription" ||
      value.paymentType === "payment" ||
      value.paymentType === "one_time") &&
    typeof value.baseAmountUsdCents === "number" &&
    Number.isSafeInteger(value.baseAmountUsdCents) &&
    value.baseAmountUsdCents > 0 &&
    value.baseAmountUsdCents <= 2_147_483_647 &&
    typeof value.currency === "string" &&
    CURRENCY_PATTERN.test(value.currency) &&
    ((value.subject === "standard" &&
      value.beneficiaryId !== null &&
      value.partnershipProject === null) ||
      (value.subject === "blind" &&
        value.beneficiaryId === null &&
        value.partnershipProject === null) ||
      (value.subject === "partnership" &&
        value.beneficiaryId === null &&
        value.partnershipProject !== null)) &&
    Object.keys(value).length === 7
  )
}

function scopesMatch(
  left: CheckoutOperationScope,
  right: CheckoutOperationScope,
): boolean {
  return (
    left.provider === right.provider &&
    left.subject === right.subject &&
    left.beneficiaryId === right.beneficiaryId &&
    left.partnershipProject === right.partnershipProject &&
    left.paymentType === right.paymentType &&
    left.baseAmountUsdCents === right.baseAmountUsdCents &&
    left.currency === right.currency
  )
}

function parseOperation(
  rawValue: string | null,
  now: Date,
): CheckoutOperation | null {
  if (!rawValue || rawValue.length > 2048) return null

  let value: unknown
  try {
    value = JSON.parse(rawValue)
  } catch {
    return null
  }
  if (!isRecord(value) || value.version !== CHECKOUT_STATE_VERSION) return null
  if (
    typeof value.operationId !== "string" ||
    !UUID_V4_PATTERN.test(value.operationId) ||
    typeof value.createdAt !== "string" ||
    !isValidScope(value.scope) ||
    Object.keys(value).length !== 4
  ) {
    return null
  }

  const createdAt = Date.parse(value.createdAt)
  if (
    !Number.isFinite(createdAt) ||
    createdAt > now.getTime() + 60_000 ||
    createdAt <= now.getTime() - CHECKOUT_OPERATION_MAX_AGE_MS
  ) {
    return null
  }

  return {
    operationId: value.operationId.toLowerCase(),
    scope: value.scope,
    createdAt: new Date(createdAt).toISOString(),
  }
}

function writeOperation(
  storage: CheckoutStorage,
  operation: CheckoutOperation,
): void {
  storage.setItem(
    CHECKOUT_OPERATION_STORAGE_KEY,
    JSON.stringify({ version: CHECKOUT_STATE_VERSION, ...operation }),
  )
}

/**
 * Reuses only an exact, recent checkout operation. A changed beneficiary,
 * cadence, amount, currency, subject, or gateway receives a fresh operation
 * identifier, while a network retry retains its provider idempotency chain.
 */
export function loadOrCreateCheckoutOperation(options: {
  storage: CheckoutStorage
  scope: CheckoutOperationScope
  now?: Date
  createOperationId?: () => string
}): CheckoutOperation {
  const now = options.now ?? new Date()
  if (!Number.isFinite(now.getTime()) || !isValidScope(options.scope)) {
    throw new Error("Invalid checkout operation scope")
  }

  try {
    const existing = parseOperation(
      options.storage.getItem(CHECKOUT_OPERATION_STORAGE_KEY),
      now,
    )
    if (existing && scopesMatch(existing.scope, options.scope)) return existing
  } catch {
    // Storage can be denied in hardened browser contexts. Checkout still gets
    // an operation ID, but a page reload cannot recover that local retry key.
  }

  const operationId = (options.createOperationId ?? crypto.randomUUID)()
  if (!UUID_V4_PATTERN.test(operationId)) {
    throw new Error("Invalid checkout operation identifier")
  }

  const operation: CheckoutOperation = {
    operationId: operationId.toLowerCase(),
    scope: { ...options.scope },
    createdAt: now.toISOString(),
  }
  try {
    writeOperation(options.storage, operation)
    options.storage.removeItem(CHECKOUT_RECEIPT_STORAGE_KEY)
  } catch {
    // The caller may continue with this in-memory operation.
  }
  return operation
}

/** Stores the bearer receipt only in tab-scoped storage before navigation. */
export function persistCheckoutReceipt(options: {
  storage: CheckoutStorage
  operationId: string
  receipt: string
  now?: Date
}): boolean {
  const now = options.now ?? new Date()
  if (
    !UUID_V4_PATTERN.test(options.operationId) ||
    !OPAQUE_RECEIPT_PATTERN.test(options.receipt) ||
    !Number.isFinite(now.getTime())
  ) {
    return false
  }

  try {
    options.storage.setItem(
      CHECKOUT_RECEIPT_STORAGE_KEY,
      JSON.stringify({
        version: CHECKOUT_STATE_VERSION,
        receipt: options.receipt,
        operationId: options.operationId.toLowerCase(),
        storedAt: now.toISOString(),
      }),
    )
    return true
  } catch {
    return false
  }
}

export function readCheckoutReceipt(options: {
  storage: CheckoutStorage
  now?: Date
}): StoredCheckoutReceipt | null {
  const now = options.now ?? new Date()
  let rawValue: string | null
  try {
    rawValue = options.storage.getItem(CHECKOUT_RECEIPT_STORAGE_KEY)
  } catch {
    return null
  }
  if (!rawValue || rawValue.length > 1024) return null

  let value: unknown
  try {
    value = JSON.parse(rawValue)
  } catch {
    return null
  }
  if (
    !isRecord(value) ||
    value.version !== CHECKOUT_STATE_VERSION ||
    typeof value.receipt !== "string" ||
    !OPAQUE_RECEIPT_PATTERN.test(value.receipt) ||
    typeof value.operationId !== "string" ||
    !UUID_V4_PATTERN.test(value.operationId) ||
    typeof value.storedAt !== "string" ||
    Object.keys(value).length !== 4
  ) {
    return null
  }

  const storedAt = Date.parse(value.storedAt)
  if (
    !Number.isFinite(now.getTime()) ||
    !Number.isFinite(storedAt) ||
    storedAt > now.getTime() + 60_000 ||
    storedAt <= now.getTime() - CHECKOUT_RECEIPT_MAX_AGE_MS
  ) {
    return null
  }

  return {
    receipt: value.receipt,
    operationId: value.operationId.toLowerCase(),
    storedAt: new Date(storedAt).toISOString(),
  }
}

export function clearCheckoutClientState(storage: CheckoutStorage): void {
  try {
    storage.removeItem(CHECKOUT_OPERATION_STORAGE_KEY)
    storage.removeItem(CHECKOUT_RECEIPT_STORAGE_KEY)
  } catch {
    // Clearing local convenience state must not affect provider settlement.
  }
}
