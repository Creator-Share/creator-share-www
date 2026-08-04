export interface PayPalBrowserStartInput {
  beneficiaryId: string
  requestedAmountUsdCents: number
  paymentType: "subscription" | "one_time"
  sponsorEmail: string
  currency: string
  checkoutRequestId: string
}

export interface PayPalBrowserCaptureInput {
  checkoutRequestId: string
  checkoutReceipt: string
}

/**
 * Browser intent contains only sponsor choices and opaque Creator Share state.
 * Provider plans, object IDs, display copy, conversions, and provider scope are
 * deliberately absent because the server owns them.
 */
export function buildPayPalBrowserStartPayload(input: PayPalBrowserStartInput) {
  return {
    action: "start" as const,
    beneficiaryId: input.beneficiaryId,
    amount: input.requestedAmountUsdCents,
    paymentType: input.paymentType,
    email: input.sponsorEmail,
    type: "sponsorship" as const,
    currency: input.currency,
    checkoutRequestId: input.checkoutRequestId,
  }
}

/** Capture resolves the attached order from the receipt and operation. */
export function buildPayPalBrowserCapturePayload(
  input: PayPalBrowserCaptureInput,
) {
  return {
    action: "capture" as const,
    checkoutRequestId: input.checkoutRequestId,
    checkoutReceipt: input.checkoutReceipt,
  }
}
