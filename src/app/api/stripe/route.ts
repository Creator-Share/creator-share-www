import { NextResponse } from "next/server";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

export async function POST(req: Request) {
  try {
    const { childId, childName, amount, paymentType, childImage, location } = await req.json();

    if (!amount || amount < 10) {
      return NextResponse.json({ error: "Minimum amount is $10." }, { status: 400 });
    }

    if (!paymentType || (paymentType !== "subscription" && paymentType !== "payment")) {
      return NextResponse.json({ error: "Invalid payment type." }, { status: 400 });
    }

    const commonSessionConfig = {
      payment_method_types: ['card'] as Stripe.Checkout.SessionCreateParams.PaymentMethodType[],
      metadata: {
        childId,
        childName,
        amount,
        childLocation: location,
      },
      success_url: `${process.env.NEXT_PUBLIC_BASE_URL}/payments/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_BASE_URL}/payments/failed?session_id={CHECKOUT_SESSION_ID}`,
    };

    let session;
    if (paymentType === "subscription") {
      session = await stripe.checkout.sessions.create({
        ...commonSessionConfig,
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
      });
    } else if (paymentType === "payment") {
      session = await stripe.checkout.sessions.create({
        ...commonSessionConfig,
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
      });
    }

    return NextResponse.json({ url: session?.url });
  } catch (error) {
    console.error("Stripe Error:", error);
    return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 });
  }
}
