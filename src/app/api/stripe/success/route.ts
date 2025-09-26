import { NextResponse } from "next/server"
import Stripe from "stripe"

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string)

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const sessionId = searchParams.get("session_id")

  if (!sessionId) {
    return NextResponse.json({ error: "Missing session_id" }, { status: 400 })
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["payment_intent", "subscription", "customer"],
    })

    return NextResponse.json({
      id: session.id,
      amount_total: session.amount_total,
      currency: session.currency,
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
