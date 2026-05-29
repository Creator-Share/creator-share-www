import { NextResponse } from "next/server"
import { coerceRegion, getStripeClient } from "@/lib/stripe/config"
import {
  formatMoney,
  parsePaymentCurrencyMetadata,
} from "@/utils/currency"

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const sessionId = searchParams.get("session_id")
  const region = coerceRegion(searchParams.get("region"))

  if (!sessionId) {
    return NextResponse.json({ error: "Missing session_id" }, { status: 400 })
  }

  const stripe = getStripeClient(region)

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["payment_intent", "subscription", "customer"],
    })
    const conversion = parsePaymentCurrencyMetadata(session.metadata)
    const chargedCurrency =
      conversion?.chargedCurrency || session.currency?.toUpperCase() || null
    const chargedAmountMinor =
      conversion?.chargedAmountMinor || session.amount_total || null

    return NextResponse.json({
      id: session.id,
      amount_total: session.amount_total,
      currency: session.currency,
      charged_amount: chargedAmountMinor,
      charged_currency: chargedCurrency,
      charged_display:
        chargedAmountMinor !== null && chargedCurrency
          ? formatMoney(chargedAmountMinor, chargedCurrency)
          : null,
      customer_email: session.customer_details?.email,
      payment_status: session.payment_status,
      subscription: session.subscription,
      payment_intent: session.payment_intent,
      customer: session.customer,
      metadata: session.metadata,
      status: session.status,
      url: session.url,
    })
  } catch (error) {
    console.error("Stripe session fetch error:", error)
    return NextResponse.json({ error: "Invalid session ID" }, { status: 400 })
  }
}
