import { NextResponse } from "next/server";

// Helper to get raw body (Next.js API routes do not provide this by default)
async function getRawBody(req: Request): Promise<string> {
  const reader = req.body?.getReader();
  if (!reader) return "";
  let result = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result += new TextDecoder().decode(value);
  }
  return result;
}

export async function POST(req: Request) {
  try {
    // 1. Get raw body for signature verification
    const rawBody = await getRawBody(req);

    // 2. Get PayPal webhook headers
    const transmissionId = req.headers.get("paypal-transmission-id") || "";
    const transmissionTime = req.headers.get("paypal-transmission-time") || "";
    const certUrl = req.headers.get("paypal-cert-url") || "";
    const authAlgo = req.headers.get("paypal-auth-algo") || "";
    const transmissionSig = req.headers.get("paypal-transmission-sig") || "";
    const webhookId = process.env.PAYPAL_WEBHOOK_ID || ""; // Set this in your .env

    // 3. Parse event body
    const event = JSON.parse(rawBody);

    // 4. Verify webhook signature with PayPal
    const verifyRes = await fetch(
      `${process.env.PAYPAL_API_BASE_URL || "https://api-m.paypal.com"}/v1/notifications/verify-webhook-signature`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.PAYPAL_ACCESS_TOKEN}`,
        },
        body: JSON.stringify({
          auth_algo: authAlgo,
          cert_url: certUrl,
          transmission_id: transmissionId,
          transmission_sig: transmissionSig,
          transmission_time: transmissionTime,
          webhook_id: webhookId,
          webhook_event: event,
        }),
      }
    );

    const verifyData = await verifyRes.json();
    if (verifyData.verification_status !== "SUCCESS") {
      console.error("PayPal webhook signature verification failed:", verifyData);
      return NextResponse.json({ error: "Invalid webhook signature" }, { status: 400 });
    }

    // 5. Handle event types
    switch (event.event_type) {
      case 'BILLING.SUBSCRIPTION.CREATED':
        // Handle subscription creation
        break;
      case 'BILLING.SUBSCRIPTION.CANCELLED':
        // Handle subscription cancellation
        break;
      case 'PAYMENT.SALE.COMPLETED':
        // Handle successful payment
        break;
      default:
        console.log(`Unhandled event type: ${event.event_type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Webhook Error:', error);
    return NextResponse.json(
      { error: 'Webhook handler failed' },
      { status: 500 }
    );
  }
}
