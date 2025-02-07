import { NextResponse } from "next/server";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

export async function POST(req: Request) {
  try {
    const { childId, childName, amount, paymentType, childImage } = await req.json();

    if (!amount || amount < 10) {
      return NextResponse.json({ error: "Minimum amount is $10." }, { status: 400 });
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
                images: [childImage],
              },
              unit_amount: amount,
              recurring: { interval: "month" },
            },
            quantity: 1,
          },
        ],
        success_url: `${process.env.NEXT_PUBLIC_BASE_URL}/payments/success`,
        cancel_url: `${process.env.NEXT_PUBLIC_BASE_URL}/payments/cancel`,
        metadata: {
          childId,
          amount,
        },
      });
    } else if (paymentType === "payment") {
      session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        mode: "subscription",
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: `Sponsorship for ${childName} (Yearly)`,
                images: [childImage],
              },
              unit_amount: amount,
              recurring: { interval: "year" },
            },
            quantity: 1,
          },
        ],
        success_url: `${process.env.NEXT_PUBLIC_BASE_URL}/payments/success`,
        cancel_url: `${process.env.NEXT_PUBLIC_BASE_URL}/payments/cancel`,
        metadata: {
          childId,
          amount,
        },
      });
    }

    return NextResponse.json({ url: session?.url });
  } catch (error) {
    console.error("Stripe Error:", error);
    return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 });
  }
}
