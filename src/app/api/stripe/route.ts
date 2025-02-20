import { NextResponse } from "next/server";
import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

export async function POST(req: Request) {
  try {
    const {
      childId,
      childName,
      amount,
      paymentType,
      childImage,
      location,
      userId,
    } = await req.json();

    if (!amount || amount < 10) {
      return NextResponse.json(
        { error: "Minimum amount is $10." },
        { status: 400 }
      );
    }

    if (
      !paymentType ||
      (paymentType !== "subscription" && paymentType !== "payment")
    ) {
      return NextResponse.json(
        { error: "Invalid payment type." },
        { status: 400 }
      );
    }

    const commonSessionConfig = {
      payment_method_types: [
        "card",
      ] as Stripe.Checkout.SessionCreateParams.PaymentMethodType[],
      metadata: {
        childId,
        childName,
        amount,
        childLocation: location,
        userId: userId || null,
      },
      success_url: `${process.env.NEXT_PUBLIC_BASE_URL}/payments/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_BASE_URL}/payments/failed?session_id={CHECKOUT_SESSION_ID}`,
    };

    let session;
    if (paymentType === "subscription") {
      console.log('Creating subscription session with data:', {
        childId,
        childName,
        amount,
        userId
      });

      const product = await stripe.products.create({
        name: `Sponsorship for ${childName} (Monthly)`,
        images: [childImage],
      });

      const price = await stripe.prices.create({
        unit_amount: amount,
        currency: 'usd',
        recurring: { interval: 'month' },
        product: product.id,
        metadata: {
          childId,
          userId,
          amount: amount.toString()
        }
      });

      session = await stripe.checkout.sessions.create({
        ...commonSessionConfig,
        mode: 'subscription',
        line_items: [
          {
            price: price.id,
            quantity: 1,
          },
        ],
        subscription_data: {
          metadata: {
            childId,
            userId,
            amount: amount.toString()
          }
        }
      });
      
      console.log('Created subscription session:', {
        session_id: session.id,
        price_id: price.id,
        metadata: session.metadata
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
    return NextResponse.json(
      { error: "Failed to create checkout session" },
      { status: 500 }
    );
  }
}
