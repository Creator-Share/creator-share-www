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

    const commonSessionConfig = {
      payment_method_types: ["card"] as Stripe.Checkout.SessionCreateParams.PaymentMethodType[],
      metadata: {
        childId,
        childName,
        amount: amount.toString(),
        childLocation: location,
        userId: userId || null,
        paymentType
      },
      success_url: `${process.env.NEXT_PUBLIC_BASE_URL}/payments/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_BASE_URL}/payments/failed?session_id={CHECKOUT_SESSION_ID}`,
    };

    let session;
    if (paymentType === "subscription") {
      // Monthly subscription
      const product = await stripe.products.create({
        name: `Monthly Sponsorship for ${childName}`,
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
    } else {
      // Yearly subscription
      const product = await stripe.products.create({
        name: `Yearly Sponsorship for ${childName}`,
        images: [childImage],
      });

      const price = await stripe.prices.create({
        unit_amount: amount,
        currency: 'usd',
        recurring: { interval: 'year' },
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
