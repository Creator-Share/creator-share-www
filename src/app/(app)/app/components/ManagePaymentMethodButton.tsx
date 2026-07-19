"use client"

import { useRef, useState } from "react"
import { MdCreditCard } from "react-icons/md"

import { Button } from "@/components/ui/button"
import { PAYPAL_MANAGE_URL } from "@/lib/payments/portals"
import {
  isRecentVerificationRequiredResponse,
  requestFreshSponsorAuthentication,
  sponsorReauthenticationMessage,
} from "@/lib/sponsorships/management/sponsorReauthenticationClient"

const STRIPE_BILLING_PORTAL_ORIGIN = "https://billing.stripe.com"
const STRIPE_MANAGEMENT_LABEL = "Update default payment method in Stripe."
const PAYPAL_MANAGEMENT_LABEL = "Manage automatic payments in PayPal."
const DESTINATION_KEYS = ["label", "url"] as const

type SafeDestination =
  | { provider: "stripe"; url: string }
  | { provider: "paypal"; url: typeof PAYPAL_MANAGE_URL }

export function safePaymentMethodDestination(
  value: unknown,
): SafeDestination | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (
    Object.keys(record).sort().join("\0") !== DESTINATION_KEYS.join("\0") ||
    typeof record.url !== "string" ||
    typeof record.label !== "string" ||
    record.url.length > 4096 ||
    record.label.length > 80
  ) {
    return null
  }

  if (record.url === PAYPAL_MANAGE_URL) {
    return record.label === PAYPAL_MANAGEMENT_LABEL
      ? { provider: "paypal", url: PAYPAL_MANAGE_URL }
      : null
  }

  if (record.label !== STRIPE_MANAGEMENT_LABEL) return null

  try {
    const url = new URL(record.url)
    return url.origin === STRIPE_BILLING_PORTAL_ORIGIN &&
      url.protocol === "https:" &&
      url.hostname === "billing.stripe.com" &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      url.hash === ""
      ? { provider: "stripe", url: record.url }
      : null
  } catch {
    return null
  }
}

export function ManagePaymentMethodButton({
  subscriptionId,
}: {
  subscriptionId: string
}) {
  const [isLoading, setIsLoading] = useState(false)
  const actionInFlight = useRef(false)

  async function handleClick(event: React.MouseEvent) {
    event.stopPropagation()
    if (actionInFlight.current) return
    actionInFlight.current = true
    setIsLoading(true)

    try {
      const response = await fetch(
        "/api/sponsorships/subscriptions/payment-method",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subscriptionId }),
          cache: "no-store",
          credentials: "same-origin",
          redirect: "error",
        },
      )
      const body = (await response.json().catch(() => null)) as unknown

      if (isRecentVerificationRequiredResponse(response.status, body)) {
        const requestAccepted = await requestFreshSponsorAuthentication()
        alert(
          sponsorReauthenticationMessage(
            "update-payment-method",
            requestAccepted,
          ),
        )
        return
      }

      const destination = response.ok
        ? safePaymentMethodDestination(body)
        : null
      if (destination === null) {
        alert("We could not open payment management. Please try again shortly.")
        return
      }

      if (
        destination.provider === "paypal" &&
        !window.confirm(
          `${PAYPAL_MANAGEMENT_LABEL}\n\nContinue to PayPal and select Creator Share to choose the funding source for this automatic payment.`,
        )
      ) {
        return
      }

      if (
        destination.provider === "stripe" &&
        !window.confirm(
          `${STRIPE_MANAGEMENT_LABEL}\n\nStripe will save this as your default payment method. It can affect every Creator Share sponsorship in this Stripe account that does not have a separately selected payment method.`,
        )
      ) {
        return
      }

      window.location.assign(destination.url)
    } catch {
      alert("We could not open payment management. Please try again shortly.")
    } finally {
      actionInFlight.current = false
      setIsLoading(false)
    }
  }

  return (
    <Button
      onClick={handleClick}
      size="sm"
      variant="outline"
      disabled={isLoading}
      aria-busy={isLoading}
    >
      <MdCreditCard className="mr-2" />
      {isLoading ? "Opening..." : "Payment Method"}
    </Button>
  )
}
