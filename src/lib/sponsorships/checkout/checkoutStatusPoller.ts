import {
  clearCheckoutClientState,
  type CheckoutStorage,
  type StoredCheckoutReceipt,
} from "@/lib/sponsorships/checkout/clientState"

export type OpaqueCheckoutStatus =
  "checking" | "processing" | "succeeded" | "failed" | "unknown"

export interface PublicCheckoutStatus {
  status: string
  terminal: boolean
}

export const CHECKOUT_STATUS_POLL_DELAYS_MS = [
  1_000, 2_000, 4_000, 8_000, 12_000, 15_000, 15_000, 15_000, 15_000,
] as const

export type PaymentReturnMode =
  | { kind: "opaque"; receipt: StoredCheckoutReceipt }
  | { kind: "legacy_stripe"; sessionId: string }
  | {
      kind: "legacy_paypal"
      subscriptionId: string | null
      token: string | null
    }
  | { kind: "v2_paypal_receipt_missing" }
  | { kind: "invalid" }

export function resolvePaymentReturnMode(input: {
  receipt: StoredCheckoutReceipt | null
  providerMarker: string | null
  stripeSessionId: string | null
  paypalSubscriptionId: string | null
  paypalToken: string | null
  paypalEnabled: boolean
}): PaymentReturnMode {
  if (input.receipt) return { kind: "opaque", receipt: input.receipt }
  if (input.providerMarker === "paypal") {
    return { kind: "v2_paypal_receipt_missing" }
  }
  if (input.stripeSessionId) {
    return { kind: "legacy_stripe", sessionId: input.stripeSessionId }
  }
  if (
    input.paypalEnabled &&
    (input.paypalSubscriptionId || input.paypalToken)
  ) {
    return {
      kind: "legacy_paypal",
      subscriptionId: input.paypalSubscriptionId,
      token: input.paypalToken,
    }
  }
  return { kind: "invalid" }
}

function normalizedTerminalStatus(
  result: PublicCheckoutStatus,
): "succeeded" | "failed" | null {
  if (!result.terminal) return null
  if (result.status === "succeeded") return "succeeded"
  if (["failed", "cancelled", "expired"].includes(result.status)) {
    return "failed"
  }
  throw new Error("Checkout status is invalid")
}

export async function pollCheckoutStatus(options: {
  readStatus: () => Promise<PublicCheckoutStatus>
  wait: (milliseconds: number) => Promise<void>
  onProgress: (status: "processing") => void
  isCancelled: () => boolean
  delays?: readonly number[]
}): Promise<"succeeded" | "failed" | "unknown" | "cancelled"> {
  const delays = options.delays ?? CHECKOUT_STATUS_POLL_DELAYS_MS
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    if (options.isCancelled()) return "cancelled"
    try {
      const result = await options.readStatus()
      const terminal = normalizedTerminalStatus(result)
      if (terminal) return terminal
      if (
        result.status !== "created" &&
        result.status !== "pending" &&
        result.status !== "unknown"
      ) {
        throw new Error("Checkout status is invalid")
      }
      options.onProgress("processing")
    } catch {
      if (options.isCancelled()) return "cancelled"
    }
    const delay = delays[attempt]
    if (delay !== undefined) await options.wait(delay)
  }
  return options.isCancelled() ? "cancelled" : "unknown"
}

export function clearTerminalCheckoutClientState(
  storage: CheckoutStorage,
  status: "succeeded" | "failed" | "unknown" | "cancelled",
): boolean {
  if (status !== "succeeded" && status !== "failed") return false
  clearCheckoutClientState(storage)
  return true
}
