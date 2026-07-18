"use client"
import { useEffect, useState } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { FaPaypal, FaStripe } from "react-icons/fa"
import {
  readCheckoutReceipt,
  type CheckoutOperationProvider,
} from "@/lib/sponsorships/checkout/clientState"
import {
  clearTerminalCheckoutClientState,
  pollCheckoutStatus,
  resolvePaymentReturnMode,
  type OpaqueCheckoutStatus,
} from "@/lib/sponsorships/checkout/checkoutStatusPoller"
import {
  classifyLegacyPayPalReturnResponse,
  classifyLegacyStripeReturnResponse,
  type LegacyPaymentReturnOutcome,
} from "@/lib/payments/legacyPaymentReturn"

// Check if PayPal is enabled
const isPayPalEnabled = !!process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID

type StripeSessionDetails = {
  amount_total?: number | null
  currency?: string | null
  metadata?: Record<string, unknown> | null
}

type PayPalDetails = {
  subscription?: {
    charged_amount?: number | null
    charged_currency?: string | null
    beneficiaries?: {
      name?: string
      location_str?: string
    } | null
  }
}

type StripeStatus = {
  provider: "stripe"
  status: LegacyPaymentReturnOutcome
  message: string
  details?: StripeSessionDetails
}

type PayPalStatus = {
  provider: "paypal"
  status: LegacyPaymentReturnOutcome
  message: string
  details?: PayPalDetails
}

type PaymentStatus =
  | StripeStatus
  | PayPalStatus
  | { provider: "unknown"; status: "error"; message: string }

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function optionalNonnegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null
}

function optionalText(value: unknown, maximumLength: number): string | null {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength
    ? value
    : null
}

function safeStripeDetails(value: unknown): StripeSessionDetails {
  if (!isRecord(value)) return {}
  const metadata = isRecord(value.metadata) ? value.metadata : {}
  return {
    amount_total: optionalNonnegativeInteger(value.amount_total),
    currency: optionalText(value.currency, 3)?.toUpperCase() ?? null,
    metadata: {
      childName: optionalText(metadata.childName, 160),
      childLocation: optionalText(metadata.childLocation, 300),
    },
  }
}

function safePayPalDetails(value: unknown): PayPalDetails {
  if (!isRecord(value) || !isRecord(value.subscription)) return {}
  const beneficiaries = isRecord(value.subscription.beneficiaries)
    ? value.subscription.beneficiaries
    : null
  return {
    subscription: {
      charged_amount: optionalNonnegativeInteger(
        value.subscription.charged_amount,
      ),
      charged_currency:
        optionalText(value.subscription.charged_currency, 3)?.toUpperCase() ??
        null,
      beneficiaries: beneficiaries
        ? {
            name: optionalText(beneficiaries.name, 160) ?? undefined,
            location_str:
              optionalText(beneficiaries.location_str, 300) ?? undefined,
          }
        : null,
    },
  }
}

function OpaqueCheckoutResult({
  provider,
  status,
  onReturnHome,
  messageOverride,
}: {
  provider: CheckoutOperationProvider | "unknown"
  status: OpaqueCheckoutStatus
  onReturnHome: () => void
  messageOverride?: string
}) {
  const succeeded = status === "succeeded"
  const failed = status === "failed"
  const heading = succeeded
    ? "Thank You for Changing a Life!"
    : failed
      ? "Your sponsorship was not completed"
      : status === "unknown"
        ? "We could not confirm this checkout yet"
        : "We are confirming your sponsorship"
  const message =
    messageOverride ??
    (succeeded
      ? "Your sponsorship is confirmed. We sent confirmation to the email address used at checkout."
      : failed
        ? "No successful sponsorship was recorded. You can safely return and try again."
        : status === "unknown"
          ? "Confirmation is taking longer than expected. Please check your email or return here shortly."
          : "Your payment provider has returned you safely. We are waiting for the signed payment confirmation before declaring success.")

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f5f5f7",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
        fontFamily: "Inter, Arial, sans-serif",
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: "16px",
          boxShadow: "0 2px 16px rgba(0,0,0,0.07)",
          padding: "2.5rem 2rem",
          maxWidth: "420px",
          width: "100%",
          textAlign: "center",
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#fff",
            borderRadius: "50%",
            width: 56,
            height: 56,
            boxShadow: "0 2px 8px rgba(0,0,0,0.07)",
            marginBottom: "1.5rem",
          }}
        >
          {provider === "paypal" ? (
            <FaPaypal size={40} color="#003087" />
          ) : provider === "stripe" ? (
            <FaStripe size={40} color="#635bff" />
          ) : null}
        </span>
        <h2
          style={{
            color: failed ? "#b42318" : "#2b7ff9",
            fontWeight: 700,
            fontSize: "1.5rem",
            marginBottom: "0.75rem",
          }}
        >
          {heading}
        </h2>
        <p style={{ color: "#444", lineHeight: 1.6, marginBottom: "1.5rem" }}>
          {message}
        </p>
        {(status === "checking" || status === "processing") && (
          <div
            aria-live="polite"
            style={{ color: "#666", fontSize: "0.9rem", marginBottom: "1rem" }}
          >
            {status === "checking"
              ? "Securely checking payment status..."
              : "Please check your confirmation email before trying again."}
          </div>
        )}
        <button
          type="button"
          style={{
            width: "100%",
            padding: "0.9rem 0",
            background: "#2b7ff9",
            color: "#fff",
            border: "none",
            borderRadius: "8px",
            fontWeight: 600,
            fontSize: "1rem",
            cursor: "pointer",
          }}
          onClick={onReturnHome}
        >
          Back to Home
        </button>
      </div>
    </div>
  )
}

export default function PaymentSuccessClient() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [status, setStatus] = useState<PaymentStatus | null>(null)
  const [opaqueStatus, setOpaqueStatus] =
    useState<OpaqueCheckoutStatus | null>(null)
  const [opaqueProvider, setOpaqueProvider] =
    useState<CheckoutOperationProvider>("stripe")

  useEffect(() => {
    const storedReceipt = readCheckoutReceipt({
      storage: window.sessionStorage,
    })
    const paypalSubscriptionId = isPayPalEnabled
      ? searchParams.get("subscription_id")
      : null
    const paypalToken = isPayPalEnabled
      ? searchParams.get("token") || searchParams.get("ba_token")
      : null
    const returnMode = resolvePaymentReturnMode({
      receipt: storedReceipt,
      providerMarker: searchParams.get("provider"),
      stripeSessionId: searchParams.get("session_id"),
      paypalSubscriptionId,
      paypalToken,
      paypalEnabled: isPayPalEnabled,
    })

    if (returnMode.kind === "opaque") {
      const controller = new AbortController()
      let cancelled = false
      setOpaqueProvider(returnMode.receipt.provider)
      setOpaqueStatus("checking")

      const wait = (milliseconds: number) =>
        new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds))

      const confirmCheckout = async () => {
        const result = await pollCheckoutStatus({
          async readStatus() {
            const response = await fetch("/api/sponsorships/checkout-status", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ receipt: returnMode.receipt.receipt }),
              cache: "no-store",
              signal: controller.signal,
            })
            const checkoutStatus = (await response.json()) as {
              status: string
              terminal: boolean
            }
            if (!response.ok) throw new Error("Checkout status is unavailable")
            return checkoutStatus
          },
          wait,
          onProgress: setOpaqueStatus,
          isCancelled: () => cancelled || controller.signal.aborted,
        })
        if (result === "succeeded" || result === "failed") {
          clearTerminalCheckoutClientState(window.sessionStorage, result)
          setOpaqueStatus(result)
        } else if (result === "unknown" && !cancelled) {
          setOpaqueStatus("unknown")
        }
      }

      void confirmCheckout()
      return () => {
        cancelled = true
        controller.abort()
      }
    }

    if (returnMode.kind === "v2_paypal_receipt_missing") {
      setStatus({
        provider: "paypal",
        status: "error",
        message:
          "We could not recover this secure PayPal checkout in this tab. Please check your email before trying again.",
      })
    } else if (returnMode.kind === "legacy_stripe") {
      const region = searchParams.get("region")
      const params = new URLSearchParams({ session_id: returnMode.sessionId })
      if (region) params.set("region", region)
      fetch(`/api/stripe/success?${params.toString()}`)
        .then(async (res) => {
          if (!res.ok) throw new Error("Invalid Stripe session ID")
          const data: unknown = await res.json()
          const outcome = classifyLegacyStripeReturnResponse(data)
          setStatus({
            provider: "stripe",
            status: outcome,
            message:
              outcome === "success"
                ? "Your Stripe payment was successful!"
                : outcome === "processing"
                  ? "We are still confirming this sponsorship. Please check the email address used at checkout."
                  : "Stripe did not confirm a successful sponsorship.",
            details: outcome === "success" ? safeStripeDetails(data) : undefined,
          })
        })
        .catch(() => {
          setStatus({
            provider: "stripe",
            status: "error",
            message: "Invalid session ID for Stripe payment.",
          })
        })
    } else if (returnMode.kind === "legacy_paypal") {
      fetch(
        `/api/paypal/verify?sponsorship_id=${
          returnMode.subscriptionId || ""
        }&token=${returnMode.token || ""}`
      )
        .then(async (res) => {
          if (!res.ok) throw new Error("Invalid PayPal session")
          const data: unknown = await res.json()
          const outcome = classifyLegacyPayPalReturnResponse(data)
          setStatus({
            provider: "paypal",
            status: outcome,
            message:
              outcome === "success"
                ? "Your PayPal payment was successful!"
                : outcome === "processing"
                  ? "We are still confirming this sponsorship. Please check the email address used at checkout."
                  : "PayPal did not confirm an active sponsorship.",
            details: outcome === "success" ? safePayPalDetails(data) : undefined,
          })
        })
        .catch(() => {
          setStatus({
            provider: "paypal",
            status: "error",
            message: "Invalid PayPal session.",
          })
        })
    } else {
      setStatus({
        provider: "unknown",
        status: "error",
        message: "No valid payment session found.",
      })
    }
  }, [searchParams])

  if (opaqueStatus) {
    return (
      <OpaqueCheckoutResult
        provider={opaqueProvider}
        status={opaqueStatus}
        onReturnHome={() => router.push("/")}
      />
    )
  }

  if (!status || status.status !== "success") {
    return (
      <OpaqueCheckoutResult
        provider={status?.provider ?? "unknown"}
        status={
          !status
            ? "checking"
            : status.status === "processing"
              ? "processing"
              : "failed"
        }
        onReturnHome={() => router.push("/")}
        messageOverride={status?.message}
      />
    )
  }

  // UI helpers
  const getLogo = () => {
    if (isPayPalEnabled && status?.provider === "paypal")
      return (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#fff",
            borderRadius: "50%",
            width: 56,
            height: 56,
            boxShadow: "0 2px 8px rgba(0,0,0,0.07)",
          }}
        >
          <FaPaypal size={40} color="#003087" />
        </span>
      )
    if (status?.provider === "stripe")
      return (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#fff",
            borderRadius: "50%",
            width: 56,
            height: 56,
            boxShadow: "0 2px 8px rgba(0,0,0,0.07)",
          }}
        >
          <FaStripe size={40} color="#635bff" />
        </span>
      )
    return null
  }

  const getBeneficiaryName = () => {
    if (
      isPayPalEnabled &&
      status?.provider === "paypal" &&
      status.details &&
      status.details.subscription &&
      status.details.subscription.beneficiaries &&
      status.details.subscription.beneficiaries.name
    ) {
      return status.details.subscription.beneficiaries.name
    }
    // For Stripe, you may have to get from metadata or elsewhere
    if (
      status?.provider === "stripe" &&
      status.details &&
      status.details.metadata &&
      status.details.metadata.childName
    ) {
      return String(status.details.metadata.childName)
    }
    return "Not available"
  }

  const getLocation = () => {
    if (
      isPayPalEnabled &&
      status?.provider === "paypal" &&
      status.details &&
      status.details.subscription &&
      status.details.subscription.beneficiaries &&
      status.details.subscription.beneficiaries.location_str
    ) {
      return status.details.subscription.beneficiaries.location_str
    }
    if (
      status?.provider === "stripe" &&
      status.details &&
      status.details.metadata &&
      status.details.metadata.childLocation
    ) {
      return String(status.details.metadata.childLocation)
    }
    return "Not available"
  }

  const getChargedAmount = () => {
    if (status?.provider === "stripe") {
      const amount = status.details?.amount_total
      const currency = status.details?.currency
      return typeof amount === "number" && currency
        ? `${currency} ${(amount / 100).toFixed(2)}`
        : "Not available"
    }
    if (isPayPalEnabled && status?.provider === "paypal") {
      const subscription = status.details?.subscription
      if (subscription?.charged_amount && subscription?.charged_currency) {
        return `${subscription.charged_currency} ${(
          subscription.charged_amount / 100
        ).toFixed(2)}`
      }
    }
    return "Not available"
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f5f5f7",
        padding: "0",
        margin: "0",
        fontFamily: "Inter, Arial, sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
        }}
      >
        <div
          style={{
            background: "#fff",
            borderRadius: "16px",
            boxShadow: "0 2px 16px rgba(0,0,0,0.07)",
            padding: "2.5rem 2rem",
            maxWidth: "420px",
            width: "100%",
            margin: "2rem 0",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              marginBottom: "1.5rem",
            }}
          >
            {getLogo()}
          </div>
          <h2
            style={{
              color: "#2b7ff9",
              fontWeight: 700,
              fontSize: "1.5rem",
              textAlign: "center",
              marginBottom: "0.5rem",
            }}
          >
            Thank You for Changing a Life!
          </h2>
          <p
            style={{
              textAlign: "center",
              color: "#222",
              marginBottom: "1.5rem",
            }}
          >
            Your generous sponsorship payment has been successfully processed.
            <br />
            Because of you,{" "}
            <span style={{ fontWeight: 600 }}>{getBeneficiaryName()}</span> is one
            step closer to a brighter future.
          </p>
          <hr style={{ margin: "1.5rem 0" }} />
          <div style={{ marginBottom: "1.5rem" }}>
            <div
              style={{
                fontWeight: 600,
                marginBottom: "0.5rem",
                textAlign: "center",
              }}
            >
              Sponsorship Details
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: "0.25rem",
              }}
            >
              <span style={{ fontWeight: 500 }}>Name</span>
              <span>{getBeneficiaryName()}</span>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: "0.25rem",
              }}
            >
              <span style={{ fontWeight: 500 }}>Amount</span>
              <span>{getChargedAmount()}</span>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: "0.25rem",
              }}
            >
              <span style={{ fontWeight: 500 }}>Location</span>
              <span>{getLocation()}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontWeight: 500 }}>Confirmation Email</span>
              <span>Sent to the address used at checkout</span>
            </div>
          </div>
          <div
            style={{
              fontSize: "0.85rem",
              color: "#888",
              textAlign: "center",
              marginBottom: "1.5rem",
            }}
          >
            You'll receive updates about {getBeneficiaryName()}'s progress and how
            your support is making a difference.
          </div>
          <button
            style={{
              width: "100%",
              padding: "0.9rem 0",
              background: "#2b7ff9",
              color: "#fff",
              border: "none",
              borderRadius: "8px",
              fontWeight: 600,
              fontSize: "1rem",
              cursor: "pointer",
            }}
            onClick={() => router.push("/")}
          >
            Back to Home
          </button>
        </div>
      </div>
    </div>
  )
}
