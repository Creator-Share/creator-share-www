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
      isEmbedded,
    } = await req.json();

    if (!amount || amount < 10) {
      return NextResponse.json(
        { error: "Minimum amount is $10." },
        { status: 400 }
      );
    }

    const fullImageUrl = childImage.startsWith('http') 
      ? childImage 
      : `${process.env.NEXT_PUBLIC_BASE_URL}${childImage}`;

    const commonSessionConfig: Stripe.Checkout.SessionCreateParams = {
      payment_method_types: ["card"] as Stripe.Checkout.SessionCreateParams.PaymentMethodType[],
      metadata: {
        childId,
        childName,
        amount: amount.toString(),
        childLocation: location,
        userId: userId || null,
        paymentType
      },
    };

    if (isEmbedded) {
      commonSessionConfig.ui_mode = 'embedded';
      commonSessionConfig.return_url = `${process.env.NEXT_PUBLIC_BASE_URL}/payments/return?session_id={CHECKOUT_SESSION_ID}`;
    } else {
      commonSessionConfig.success_url = `${process.env.NEXT_PUBLIC_BASE_URL}/payments/success?session_id={CHECKOUT_SESSION_ID}`;
      commonSessionConfig.cancel_url = `${process.env.NEXT_PUBLIC_BASE_URL}/payments/failed?session_id={CHECKOUT_SESSION_ID}`;
    }

    let session;
    if (paymentType === "subscription") {
      const product = await stripe.products.create({
        name: `Monthly Sponsorship for ${childName}`,
        images: [fullImageUrl],
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
        payment_method_options: {
          card: {
            request_three_d_secure: 'automatic'
          }
        },
        subscription_data: {
          metadata: {
            childId,
            userId,
            amount: amount.toString()
          }
        }
      });
    } else {
      const product = await stripe.products.create({
        name: `Yearly Sponsorship for ${childName}`,
        images: [fullImageUrl],
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
        payment_method_options: {
          card: {
            request_three_d_secure: 'automatic'
          }
        },
        subscription_data: {
          metadata: {
            childId,
            userId,
            amount: amount.toString()
          }
        }
      });
    }

    return NextResponse.json({ 
      url: session.url,
      clientSecret: session.client_secret 
    });
  } catch (error) {
    console.error("Stripe Error:", error);
    return NextResponse.json(
      { error: "Failed to create checkout session" },
      { status: 500 }
    );
  }
}
