export type SubscriptionCancellationClientStatus =
  "pending" | "processing" | "cancelled" | "manual_review"

export interface SubscriptionCancellationClientResult {
  operationId: string
  status: SubscriptionCancellationClientStatus
  terminal: boolean
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

export function parseSubscriptionCancellationClientResult(
  value: unknown,
): SubscriptionCancellationClientResult | null {
  if (!isRecord(value)) return null
  const status = value.status
  if (
    typeof value.operationId !== "string" ||
    !UUID_PATTERN.test(value.operationId) ||
    (status !== "pending" &&
      status !== "processing" &&
      status !== "cancelled" &&
      status !== "manual_review") ||
    typeof value.terminal !== "boolean" ||
    value.terminal !== (status === "cancelled" || status === "manual_review")
  ) {
    return null
  }
  return {
    operationId: value.operationId.toLowerCase(),
    status,
    terminal: value.terminal,
  }
}

export function subscriptionCancellationNotice(
  status: SubscriptionCancellationClientStatus,
): {
  title: string
  description: string
  kind: "success" | "info" | "warning"
} {
  if (status === "cancelled") {
    return {
      title: "Subscription cancelled",
      description:
        "The provider confirmed cancellation and future recurring charges have stopped.",
      kind: "success",
    }
  }
  if (status === "manual_review") {
    return {
      title: "Cancellation needs review",
      description:
        "The request is recorded, but future billing has not yet been confirmed stopped. The Creator Share team must review it.",
      kind: "warning",
    }
  }
  return {
    title: "Cancellation is processing",
    description:
      "The request is recorded and will retry automatically. It may appear active until the payment provider confirms cancellation.",
    kind: "info",
  }
}
