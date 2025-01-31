import { NextResponse } from "next/server";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

export async function POST(req: Request) {
  try {
    const { childName, amount, paymentType } = await req.json();
    if (!amount || amount < 100) {
      return NextResponse.json({ error: "Invalid amount. Minimum is $1." }, { status: 400 });
    }
    if (!paymentType || (paymentType !== "subscription" && paymentType !== "payment")) {
      return NextResponse.json({ error: "Invalid payment type." }, { status: 400 });
    }
    let session;
    if (paymentType === "subscription") {
      session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        mode: "subscription",
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: `Sponsorship for ${childName} (Monthly)`,
              },
              unit_amount: amount,
              recurring: { interval: "month" },
            },
            quantity: 1,
          },
        ],
        success_url: `${process.env.NEXT_PUBLIC_BASE_URL}/payments/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.NEXT_PUBLIC_BASE_URL}/payments/cancel`,
      });
    } else if (paymentType === "payment") {
      session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: `Sponsorship for ${childName} (One-time)`,
              },
              unit_amount: amount,
            },
            quantity: 1,
          },
        ],
        success_url: `${process.env.NEXT_PUBLIC_BASE_URL}/payments/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.NEXT_PUBLIC_BASE_URL}/payments/cancel`,
      });
    }

    return NextResponse.json({ url: session?.url });
  } catch (error) {
    console.error("Stripe Error:", error);
    return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 });
  }
}
