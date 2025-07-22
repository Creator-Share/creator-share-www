"use client";
import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";

type StripeSessionDetails = {
  id: string;
  amount_total?: number | null;
  currency?: string | null;
  customer_email?: string | null;
  payment_status?: string | null;
  subscription?: unknown;
  payment_intent?: unknown;
  customer?: unknown;
  metadata?: Record<string, unknown> | null;
  status?: string | null;
  url?: string | null;
  error?: string;
};

type PayPalDetails = {
  id?: string;
  status?: string;
  plan_id?: string;
  subscriber?: Record<string, unknown>;
  create_time?: string;
  update_time?: string;
  links?: Array<{ href: string; rel: string; method: string }>;
  error?: string;
  [key: string]: unknown;
};

type StripeStatus = {
  provider: "stripe";
  status: "success" | "error";
  message: string;
  details?: StripeSessionDetails;
};

type PayPalStatus = {
  provider: "paypal";
  status: "success" | "error";
  message: string;
  details?: PayPalDetails;
};

type PaymentStatus = StripeStatus | PayPalStatus | { provider: "unknown"; status: "error"; message: string };

export default function PaymentSuccessClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<PaymentStatus | null>(null);

  useEffect(() => {
    // Stripe: session_id or embedded=true&session_id
    const sessionId = searchParams.get("session_id");
    // PayPal: subscription_id, token, ba_token, etc.
    const paypalSubscriptionId = searchParams.get("subscription_id");
    const paypalToken = searchParams.get("token") || searchParams.get("ba_token");

    if (sessionId) {
      // Stripe flow
      fetch(`/api/stripe/success?session_id=${sessionId}`)
        .then(async (res) => {
          if (!res.ok) {
            throw new Error("Invalid Stripe session ID");
          }
          const data = await res.json();
          setStatus({
            provider: "stripe",
            status: "success",
            message: "Your Stripe payment was successful!",
            details: data,
          });
        })
        .catch(() => {
          setStatus({
            provider: "stripe",
            status: "error",
            message: "Invalid session ID for Stripe payment.",
          });
        });
    } else if (paypalSubscriptionId || paypalToken) {
      // PayPal flow
      fetch(`/api/paypal/verify?subscription_id=${paypalSubscriptionId || ""}&token=${paypalToken || ""}`)
        .then(async (res) => {
          if (!res.ok) {
            throw new Error("Invalid PayPal session");
          }
          const data = await res.json();
          setStatus({
            provider: "paypal",
            status: "success",
            message: "Your PayPal payment was successful!",
            details: data,
          });
        })
        .catch(() => {
          setStatus({
            provider: "paypal",
            status: "error",
            message: "Invalid session ID for PayPal payment.",
          });
        });
    } else {
      setStatus({
        provider: "unknown",
        status: "error",
        message: "Invalid session ID",
      });
    }
  }, [searchParams]);

  return (
    <div>
      <div style={{ minHeight: "40vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        {status === null ? (
          <div>Loading payment status...</div>
        ) : status.status === "success" ? (
          <div className="p-4">
            <h2 style={{ color: "#1C3C8C", fontWeight: 700, fontSize: "2rem", marginBottom: "1rem" }}>
              Payment Successful!
            </h2>
            <p>{status.message}</p>
            {status.details && (
              <pre style={{ background: "#f4f4f4", padding: "1rem", borderRadius: "8px", marginTop: "1rem", maxWidth: "600px", overflow: "auto" }}>
                {JSON.stringify(status.details, null, 2)}
              </pre>
            )}
            <button
              style={{
                marginTop: "2rem",
                padding: "0.75rem 2rem",
                background: "#1C3C8C",
                color: "#fff",
                border: "none",
                borderRadius: "6px",
                fontSize: "1rem",
                cursor: "pointer",
              }}
              onClick={() => router.push("/")}
            >
              Return Home
            </button>
          </div>
        ) : (
          <div>
            <h2 style={{ color: "red", fontWeight: 700, fontSize: "2rem", marginBottom: "1rem" }}>
              {status.message}
            </h2>
            <p>
              If you believe you completed a payment, please check your email for confirmation or contact support.
            </p>
            <button
              style={{
                marginTop: "2rem",
                padding: "0.75rem 2rem",
                background: "#1C3C8C",
                color: "#fff",
                border: "none",
                borderRadius: "6px",
                fontSize: "1rem",
                cursor: "pointer",
              }}
              onClick={() => router.push("/")}
            >
              Return Home
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
