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

    if (!amount || amount < 1000) { // 1000 cents = $10.00
      return NextResponse.json(
        { error: "Minimum amount is $10." },
        { status: 400 }
      );
    }

    const fullImageUrl = childImage.startsWith('http') 
      ? childImage 
      : `${process.env.NEXT_PUBLIC_BASE_URL}${childImage}`;

    const isMonthly = paymentType === "subscription";
    const interval = isMonthly ? 'month' : 'year';
    
    let sessionConfig: Stripe.Checkout.SessionCreateParams;

    if (isMonthly) {
      const product = await stripe.products.create({
        name: 'Monthly Sponsorship for ' + childName,
        images: [fullImageUrl],
      });

      const price = await stripe.prices.create({
        unit_amount: amount,
        currency: 'usd',
        recurring: { interval: 'month' },
        product: product.id,
        metadata: {
          childId,
          userId: userId || null,
          amount: amount.toString()
        }
      });

      sessionConfig = {
        payment_method_types: ["card"],
        mode: 'subscription',
        line_items: [{ price: price.id, quantity: 1 }],
        subscription_data: {
          metadata: {
            childId,
            userId: userId || null,
            amount: amount.toString()
          }
        }
      };
    } else {
      // One-time payment configuration
      sessionConfig = {
        payment_method_types: ["card"],
        mode: 'payment',
        line_items: [{
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: amount,
            product_data: {
              name: 'One-time Sponsorship for ' + childName,
              images: [fullImageUrl],
            },
          },
        }]
      };
    }

    sessionConfig = {
      ...sessionConfig,
      payment_method_options: {
        card: { request_three_d_secure: 'automatic' }
      },
      metadata: {
        childId,
        childName,
        amount: amount.toString(),
        childLocation: location,
        userId: userId || null,
        paymentType
      }
    };
    if (isEmbedded) {
      sessionConfig = {
        ...sessionConfig,
        ui_mode: 'embedded',
        return_url: `${process.env.NEXT_PUBLIC_BASE_URL}/payments/return?embedded=true&session_id={CHECKOUT_SESSION_ID}`
      };
    } else {
      sessionConfig = {
        ...sessionConfig,
        success_url: `${process.env.NEXT_PUBLIC_BASE_URL}/payments/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.NEXT_PUBLIC_BASE_URL}/payments/failed?session_id={CHECKOUT_SESSION_ID}`
      };
    }

    const session = await stripe.checkout.sessions.create(sessionConfig);

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
