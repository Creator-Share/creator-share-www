import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/client";

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

// Helper to fetch a fresh PayPal access token
async function getPayPalAccessToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  const apiUrl =
    process.env.PAYPAL_API_URL || "https://api-m.sandbox.paypal.com";

  if (!clientId || !clientSecret) {
    throw new Error("Missing PayPal client ID or secret");
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64"
  );
  const response = await fetch(`${apiUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("PayPal token error response:", errorText);
    throw new Error("Failed to get PayPal access token");
  }

  const data = await response.json();
  return data.access_token;
}

// Helper to fetch PayPal plan details
async function getPayPalPlanDetails(
  planId: string,
  accessToken: string,
  apiUrl: string
) {
  const response = await fetch(`${apiUrl}/v1/billing/plans/${planId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("PayPal plan fetch error:", errorText);
    throw new Error("Failed to fetch PayPal plan details");
  }

  const data = await response.json();
  return data;
}

// Helper to fetch PayPal order details
// async function getPayPalOrderDetails(
//   orderId: string,
//   accessToken: string,
//   apiUrl: string
// ) {
//   const response = await fetch(`${apiUrl}/v2/checkout/orders/${orderId}`, {
//     method: "GET",
//     headers: {
//       Authorization: `Bearer ${accessToken}`,
//       "Content-Type": "application/json",
//     },
//   });

//   if (!response.ok) {
//     const errorText = await response.text();
//     console.error("PayPal order fetch error:", errorText);
//     throw new Error("Failed to fetch PayPal order details");
//   }

//   const data = await response.json();
//   return data;
// }

export async function POST(req: Request) {
  const supabase = createClient();
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

    // 4. Get a fresh PayPal access token
    const accessToken = await getPayPalAccessToken();

    // 5. Verify webhook signature with PayPal
    const apiUrl =
      process.env.PAYPAL_API_URL || "https://api-m.sandbox.paypal.com";
    const verifyRes = await fetch(
      `${apiUrl}/v1/notifications/verify-webhook-signature`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
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
      console.error(
        "PayPal webhook signature verification failed:",
        verifyData
      );
      return NextResponse.json(
        { error: "Invalid webhook signature" },
        { status: 400 }
      );
    }

    // 6. Handle event types
    switch (event.event_type) {
      case "PAYMENT.SALE.COMPLETED": {

        return NextResponse.json(
          { message: "PayPal payment processed successfully" },
          { status: 200 }
        );
      }
      case "PAYMENT.CAPTURE.COMPLETED": {
        return NextResponse.json(
          { message: "PayPal payment processed successfully" },
          { status: 200 }
        );
      }
      case "BILLING.SUBSCRIPTION.ACTIVATED": {
        // Extract info from subscription activation event
        const sub = event.resource;
        const beneficiaryId = sub.custom_id || null;
        const customerId = sub.subscriber?.payer_id || null;
        const payerEmail = sub.subscriber?.email_address || null;
        
        const payerName = sub.subscriber?.name
          ? `${sub.subscriber.name.given_name || ""} ${
              sub.subscriber.name.surname || ""
            }`.trim()
          : null;
        const amount = sub.billing_info?.last_payment?.amount?.value
          ? Math.round(
              parseFloat(sub.billing_info.last_payment.amount.value) * 100
            )
          : null;
        // Use billing_agreement_id or subscription id for idempotency
        const recurringReference = sub.billing_agreement_id || sub.id;

        // Fetch beneficiary name from DB if beneficiaryId is present
        const { data: beneficiary, error: beneficiaryError } = beneficiaryId
          ? await supabase
              .from("beneficiaries")
              .select("name")
              .eq("id", beneficiaryId)
              .single()
          : { data: null, error: null };
        const beneficiaryName =
          !beneficiaryError && beneficiary && beneficiary.name
            ? beneficiary.name
            : beneficiaryId;

        const { error: transactionError } = await supabase
          .from("transaction_ledger")
          .insert({
            user_id: null,
            credit: amount,
              customer_email: payerEmail,
              customer_name: payerName,
              reference: recurringReference,
              description: `PayPal recurring sponsorship payment${beneficiaryName ? ` for beneficiary ${beneficiaryName}` : ""} with amount of ${amount}`,
              tx_action: "SPONSORSHIP",
              subscription_type: "subscription",
              beneficiary_id: /^[0-9a-fA-F-]{36}$/.test(beneficiaryId || "")
                ? beneficiaryId
                : null,
              created_at: new Date(),
              customer_id: customerId,
              payment_intent: null,
              payment_method_id: null,
            });

          if (transactionError) {
            console.error(
              "Error creating PayPal recurring transaction:",
              transactionError
            );
            return NextResponse.json(
              { error: "Failed to create recurring transaction" },
              { status: 500 }
            );
          }
         else {
          console.log(
            "Duplicate transaction detected, skipping insert for recurring payment window"
          );
        }
        return NextResponse.json(
          { message: "PayPal recurring payment processed successfully" },
          { status: 200 }
        );
      }

      case "BILLING.SUBSCRIPTION.CREATED": {
        // Insert new PayPal subscription into subscriptions table
        const subscription = event.resource;
        const paypalSubscriptionId = subscription.id;
        const status = subscription.status;
        const planId = subscription.plan_id;
        const startTime = subscription.start_time
          ? new Date(subscription.start_time)
          : new Date();
        const subscriber = subscription.subscriber || {};
        const customerId = subscriber.payer_id || null;
        const userId = null; // Do not set user_id to custom_id
        const beneficiaryId = subscription.custom_id || null;

        // Fetch plan details for amount and interval
        let amount = null;
        let interval = null;
        try {
          if (planId) {
            const plan = await getPayPalPlanDetails(
              planId,
              accessToken,
              apiUrl
            );
            // Find the first regular billing cycle
            type PayPalBillingCycle = {
              pricing_scheme?: {
                fixed_price: {
                  value: string;
                };
              };
              frequency?: {
                interval_unit?: string;
              };
            };
            const regularCycle = plan.billing_cycles?.find(
              (cycle: PayPalBillingCycle) => cycle.pricing_scheme && cycle.frequency
            );
            if (regularCycle) {
              amount = Math.round(
                parseFloat(regularCycle.pricing_scheme.fixed_price.value) * 100
              );
              interval =
                regularCycle.frequency?.interval_unit?.toLowerCase() || null;
            }
          }
        } catch (planError) {
          console.error("Error fetching PayPal plan details:", planError);
        }

        // Map PayPal status to allowed enum values
        let mappedStatus = status;
        if (status === "APPROVAL_PENDING" || status === "pending")
          mappedStatus = "incomplete";
        else if (status === "APPROVED") mappedStatus = "approved";
        else if (status === "ACTIVE") mappedStatus = "active";
        else if (status === "SUSPENDED") mappedStatus = "suspended";
        else if (status === "CANCELLED") mappedStatus = "cancelled";
        else if (status === "EXPIRED") mappedStatus = "expired";
        // Add more mappings as needed

        console.log("Mapped PayPal status:", status, "->", mappedStatus);

        // Debug log for status mapping and insert payload
        console.log("PayPal subscription insert payload:", {
          user_id: userId,
          sponsorship_id: paypalSubscriptionId,
          status: mappedStatus,
          amount: amount,
          interval: interval,
          current_period_start: startTime,
          current_period_end: null,
          canceled_at: null,
          customer_id: customerId,
          created_at: new Date(),
          beneficiary_id: beneficiaryId,
        });

        const { error: insertError } = await supabase
          .from("subscriptions")
          .insert({
            user_id: userId,
            sponsorship_id: paypalSubscriptionId,
            status: 'incomplete',
            amount: amount ?? 0,
            interval: interval ?? undefined,
            current_period_end: null, // PayPal does not provide end time on creation
            canceled_at: null,
            customer_id: customerId,
            created_at: new Date(),
            beneficiary_id: beneficiaryId,
            sponsorship_method: "PAYPAL",
          });

        if (insertError) {
          console.error("Error creating PayPal subscription:", insertError);
          return NextResponse.json(
            {
              error: "Failed to create PayPal subscription",
              details: insertError,
            },
            { status: 500 }
          );
        }

        return NextResponse.json(
          { message: "PayPal subscription created" },
          { status: 200 }
        );
      }

      case "BILLING.SUBSCRIPTION.CANCELLED": {
        // Update PayPal subscription status to cancelled
        const subscription = event.resource;
        const paypalSubscriptionId = subscription.id;

        const { error: updateError } = await supabase
          .from("subscriptions")
          .update({
            status: "cancelled",
            canceled_at: new Date(),
          })
          .eq("sponsorship_id", paypalSubscriptionId);

        if (updateError) {
          console.error("Error cancelling PayPal subscription:", updateError);
          return NextResponse.json(
            { error: "Failed to cancel PayPal subscription" },
            { status: 500 }
          );
        }

        return NextResponse.json(
          { message: "PayPal subscription cancelled" },
          { status: 200 }
        );
      }

      default:
        console.log(`Unhandled event type: ${event.event_type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Webhook Error:", error);
    return NextResponse.json(
      { error: "Webhook handler failed" },
      { status: 500 }
    );
  }
}
