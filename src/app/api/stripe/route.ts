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

    // Validate amount
    if (!amount || amount < 1000) { // 1000 cents = $10.00
      return NextResponse.json(
        { error: "Minimum amount is $10." },
        { status: 400 }
      );
    }

    // Ensure we have a valid image URL
    const fullImageUrl = childImage.startsWith('http') 
      ? childImage 
      : `${process.env.NEXT_PUBLIC_BASE_URL}${childImage}`;

    // Determine if this is monthly or yearly subscription
    const isMonthly = paymentType === "subscription";
    const interval = isMonthly ? 'month' : 'year';
    
    // Create product
    const product = await stripe.products.create({
      name: `${isMonthly ? 'Monthly' : 'Yearly'} Sponsorship for ${childName}`,
      images: [fullImageUrl],
    });

    // Create price
    const price = await stripe.prices.create({
      unit_amount: amount,
      currency: 'usd',
      recurring: { interval },
      product: product.id,
      metadata: {
        childId,
        userId: userId || null,
        amount: amount.toString()
      }
    });

    // Common session configuration
    const sessionConfig: Stripe.Checkout.SessionCreateParams = {
      payment_method_types: ["card"],
      mode: 'subscription',
      line_items: [{ price: price.id, quantity: 1 }],
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
      },
      subscription_data: {
        metadata: {
          childId,
          userId: userId || null,
          amount: amount.toString()
        }
      }
    };

    // Configure based on embedded or standard checkout
    if (isEmbedded) {
      sessionConfig.ui_mode = 'embedded';
      sessionConfig.return_url = `${process.env.NEXT_PUBLIC_BASE_URL}/payments/return?embedded=true&session_id={CHECKOUT_SESSION_ID}`;
    } else {
      sessionConfig.success_url = `${process.env.NEXT_PUBLIC_BASE_URL}/payments/success?session_id={CHECKOUT_SESSION_ID}`;
      sessionConfig.cancel_url = `${process.env.NEXT_PUBLIC_BASE_URL}/payments/failed?session_id={CHECKOUT_SESSION_ID}`;
    }

    // Create checkout session
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
