"use client"
import { useEffect, useState } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { FaPaypal, FaStripe } from "react-icons/fa"

type StripeSessionDetails = {
  id: string
  amount_total?: number | null
  currency?: string | null
  customer_email?: string | null
  payment_status?: string | null
  subscription?: unknown
  payment_intent?: unknown
  customer?: unknown
  metadata?: Record<string, unknown> | null
  status?: string | null
  url?: string | null
  error?: string
}

type PayPalDetails = {
  id?: string
  status?: string
  plan_id?: string
  subscriber?: {
    email_address?: string
    payer_id?: string
    name?: { given_name?: string; surname?: string }
    [key: string]: unknown
  }
  create_time?: string
  update_time?: string
  custom_id?: string
  beneficiary_name?: string
  subscription?: {
    beneficiaries?: {
      name?: string
      location_str?: string
    }
  }
  paypal_order?: {
    payer?: {
      email_address?: string
    }
  }
  [key: string]: unknown
}

type StripeStatus = {
  provider: "stripe"
  status: "success" | "error"
  message: string
  details?: StripeSessionDetails
}

type PayPalStatus = {
  provider: "paypal"
  status: "success" | "error"
  message: string
  details?: PayPalDetails
}

type PaymentStatus =
  | StripeStatus
  | PayPalStatus
  | { provider: "unknown"; status: "error"; message: string }

export default function PaymentSuccessClient() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [status, setStatus] = useState<PaymentStatus | null>(null)

  useEffect(() => {
    const sessionId = searchParams.get("session_id")
    const paypalSubscriptionId = searchParams.get("subscription_id") // Use subscription_id, not sponsorship_id
    const paypalToken =
      searchParams.get("token") || searchParams.get("ba_token")

    // Function to clear reservation after successful payment
    const clearReservation = async (beneficiaryId: string) => {
      try {
        await fetch('/api/sponsorships/reservations', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ beneficiaryId }),
        })
      } catch (error) {
        console.error('Failed to clear reservation after payment:', error)
      }
    }

    if (sessionId) {
      fetch(`/api/stripe/success?session_id=${sessionId}`)
        .then(async (res) => {
          if (!res.ok) throw new Error("Invalid Stripe session ID")
          const data = await res.json()
          setStatus({
            provider: "stripe",
            status: "success",
            message: "Your Stripe payment was successful!",
            details: data,
          })
          // Clear reservation after successful payment
          if (data.metadata?.beneficiaryId) {
            await clearReservation(data.metadata.beneficiaryId)
          }
        })
        .catch(() => {
          setStatus({
            provider: "stripe",
            status: "error",
            message: "Invalid session ID for Stripe payment.",
          })
        })
    } else if (paypalSubscriptionId || paypalToken) {
      fetch(
        `/api/paypal/verify?sponsorship_id=${paypalSubscriptionId || ""}&token=${paypalToken || ""}`,
      )
        .then(async (res) => {
          if (!res.ok) throw new Error("Invalid PayPal session")
          const data = await res.json()
          setStatus({
            provider: "paypal",
            status: "success",
            message: "Your PayPal payment was successful!",
            details: data,
          })
          // Clear reservation after successful payment
          if (data.beneficiaryId) {
            await clearReservation(data.beneficiaryId)
          }
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

  // UI helpers
  const getLogo = () => {
    if (status?.provider === "paypal")
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

  const getChildName = () => {
    if (
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
    return "—"
  }

  const getLocation = () => {
    if (
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
    return "—"
  }

  const getEmail = () => {
    if (
      status?.provider === "paypal" &&
      status.details &&
      status.details.paypal_order &&
      status.details.paypal_order.payer &&
      status.details.paypal_order.payer.email_address
    ) {
      return status.details.paypal_order.payer.email_address
    }
    if (
      status?.provider === "stripe" &&
      status.details &&
      status.details.customer_email
    ) {
      return status.details.customer_email
    }
    return "—"
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
              color: "#1C3C8C",
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
            <span style={{ fontWeight: 600 }}>{getChildName()}</span> is one
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
              <span style={{ fontWeight: 500 }}>Child's Name</span>
              <span>{getChildName()}</span>
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
              <span>
                Sent to{" "}
                <span style={{ color: "#1C3C8C", textDecoration: "underline" }}>
                  {getEmail()}
                </span>
              </span>
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
            You'll receive updates about {getChildName()}'s progress and how
            your support is making a difference.
          </div>
          <button
            style={{
              width: "100%",
              padding: "0.9rem 0",
              background: "#1C3C8C",
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
