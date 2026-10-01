export type LegacyPaymentReturnOutcome = "success" | "processing" | "error"

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function isGenericProcessingResponse(
  value: JsonRecord,
  providerStatus: unknown,
): boolean {
  return value.personalized === false && providerStatus === "processing"
}

export function classifyLegacyStripeReturnResponse(
  value: unknown,
): LegacyPaymentReturnOutcome {
  if (!isRecord(value)) return "error"

  if (
    isGenericProcessingResponse(value, value.status) &&
    value.payment_status === "processing"
  ) {
    return "processing"
  }

  if (value.personalized !== true) return "error"

  if (value.status === "complete" && value.payment_status === "paid") {
    return "success"
  }

  if (
    value.status === "expired" ||
    (value.status === "complete" && value.payment_status === "unpaid")
  ) {
    return "error"
  }

  if (
    (value.status === "open" ||
      value.status === "processing" ||
      value.status === "complete") &&
    (value.payment_status === "unpaid" || value.payment_status === "processing")
  ) {
    return "processing"
  }

  return "error"
}

export function classifyLegacyPayPalReturnResponse(
  value: unknown,
): LegacyPaymentReturnOutcome {
  if (!isRecord(value) || !isRecord(value.subscription)) return "error"

  const subscriptionStatus = value.subscription.status
  if (isGenericProcessingResponse(value, subscriptionStatus)) {
    return "processing"
  }

  if (value.personalized !== true) return "error"

  if (
    subscriptionStatus === "ACTIVE" ||
    subscriptionStatus === "active" ||
    subscriptionStatus === "complete"
  ) {
    return "success"
  }

  if (
    subscriptionStatus === "CANCELLED" ||
    subscriptionStatus === "CANCELED" ||
    subscriptionStatus === "EXPIRED" ||
    subscriptionStatus === "FAILED" ||
    subscriptionStatus === "cancelled" ||
    subscriptionStatus === "canceled" ||
    subscriptionStatus === "expired" ||
    subscriptionStatus === "failed"
  ) {
    return "error"
  }

  if (
    subscriptionStatus === "APPROVAL_PENDING" ||
    subscriptionStatus === "APPROVED" ||
    subscriptionStatus === "processing" ||
    subscriptionStatus === "pending"
  ) {
    return "processing"
  }

  return "error"
}
