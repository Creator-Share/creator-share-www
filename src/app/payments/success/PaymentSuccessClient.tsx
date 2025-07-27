"use client";
import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { FaPaypal, FaStripe } from "react-icons/fa";
import {
  PaymentStatus,
} from "@/types/payments.types";

export default function PaymentSuccessClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<PaymentStatus | null>(null);

  useEffect(() => {
    const sessionId = searchParams.get("session_id");
    const paypalSubscriptionId = searchParams.get("subscription_id");
    const paypalToken = searchParams.get("token") || searchParams.get("ba_token");

    if (sessionId) {
      fetch(`/api/stripe/success?session_id=${sessionId}`)
        .then(async (res) => {
          if (!res.ok) throw new Error("Invalid Stripe session ID");
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
      fetch(`/api/paypal/verify?subscription_id=${paypalSubscriptionId || ""}&token=${paypalToken || ""}`)
        .then(async (res) => {
          if (!res.ok) throw new Error("Invalid PayPal session");
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

  // UI helpers
  const getLogo = () => {
    if (status?.provider === "paypal")
      return (
        <span style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#fff",
          borderRadius: "50%",
          width: 56,
          height: 56,
          boxShadow: "0 2px 8px rgba(0,0,0,0.07)"
        }}>
          <FaPaypal size={40} color="#003087" />
        </span>
      );
    if (status?.provider === "stripe")
      return (
        <span style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#fff",
          borderRadius: "50%",
          width: 56,
          height: 56,
          boxShadow: "0 2px 8px rgba(0,0,0,0.07)"
        }}>
          <FaStripe size={40} color="#635bff" />
        </span>
      );
    return null;
  };

  const getChildName = () => {
    if (status?.provider === "paypal" && status.details && "beneficiary_name" in status.details) {
      return status.details.beneficiary_name || "—";
    }
    // For Stripe, use beneficiaryName from metadata if available
    if (
      status?.provider === "stripe" &&
      status.details &&
      status.details.metadata &&
      status.details.metadata.beneficiaryName
    ) {
      return String(status.details.metadata.beneficiaryName);
    }
    return "—";
  };

  const getLocation = () => {
    if (
      status?.provider === "stripe" &&
      status.details &&
      status.details.metadata &&
      status.details.metadata.location_str
    ) {
      return String(status.details.metadata.location_str);
    }
    // For PayPal, location is not available in the response, so use placeholder
    return "—";
  };

  const getEmail = () => {
    if (status?.provider === "paypal" && status.details && status.details.subscriber && status.details.subscriber.email_address) {
      return status.details.subscriber.email_address;
    }
    if (status?.provider === "stripe" && status.details && status.details.customer_email) {
      return status.details.customer_email;
    }
    return "—";
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "#f5f5f7",
      padding: "0",
      margin: "0",
      fontFamily: "Inter, Arial, sans-serif"
    }}>
      <div style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh"
      }}>
        <div style={{
          background: "#fff",
          borderRadius: "16px",
          boxShadow: "0 2px 16px rgba(0,0,0,0.07)",
          padding: "2.5rem 2rem",
          maxWidth: "420px",
          width: "100%",
          margin: "2rem 0"
        }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: "1.5rem" }}>
            {getLogo()}
          </div>
          <h2 style={{
            color: "#1C3C8C",
            fontWeight: 700,
            fontSize: "1.5rem",
            textAlign: "center",
            marginBottom: "0.5rem"
          }}>
            Thank You for Changing a Life!
          </h2>
          <p style={{
            textAlign: "center",
            color: "#222",
            marginBottom: "1.5rem"
          }}>
            Your generous sponsorship payment has been successfully processed.<br />
            Because of you, <span style={{ fontWeight: 600 }}>{getChildName()}</span> is one step closer to a brighter future.
          </p>
          <hr style={{ margin: "1.5rem 0" }} />
          <div style={{ marginBottom: "1.5rem" }}>
            <div style={{ fontWeight: 600, marginBottom: "0.5rem", textAlign: "center" }}>Sponsorship Details</div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.25rem" }}>
              <span style={{ fontWeight: 500 }}>Child's Name</span>
              <span>{getChildName()}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.25rem" }}>
              <span style={{ fontWeight: 500 }}>Location</span>
              <span>{getLocation()}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontWeight: 500 }}>Confirmation Email</span>
              <span>
                Sent to <span style={{ color: "#1C3C8C", textDecoration: "underline" }}>{getEmail()}</span>
              </span>
            </div>
          </div>
          <div style={{ fontSize: "0.85rem", color: "#888", textAlign: "center", marginBottom: "1.5rem" }}>
            You'll receive updates about {getChildName()}'s progress and how your support is making a difference.
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
              cursor: "pointer"
            }}
            onClick={() => router.push("/")}
          >
            Back to Home
          </button>
        </div>
      </div>
    </div>
  );
}
