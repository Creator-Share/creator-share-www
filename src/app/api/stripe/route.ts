import { NextResponse } from "next/server";
import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

export async function POST(req: Request) {
  try {
    const {
      beneficiaryId,
      beneficiaryName,
      amount,
      paymentType,
      beneficiaryImage,
      location,
      userId,
      isEmbedded,
      allowBelowMinimum
    } = await req.json();

    if (!amount || (amount < 1000 && !allowBelowMinimum)) {
      return NextResponse.json(
        { error: "Minimum amount is $10." },
        { status: 400 }
      );
    }

    const safeImage = beneficiaryImage;
    const fullImageUrl = safeImage.startsWith("http")
      ? safeImage
      : `${process.env.NEXT_PUBLIC_BASE_URL}${safeImage}`;

    const isMonthly = paymentType === "subscription";
    const interval = isMonthly ? "month" : "year";

    const product = await stripe.products.create({
      name: `${
        isMonthly ? "Monthly" : "Yearly"
      } Sponsorship for ${beneficiaryName}`,
      images: [fullImageUrl],
    });

    const price = await stripe.prices.create({
      unit_amount: amount,
      currency: "usd",
      recurring: { interval },
      product: product.id,
      metadata: {
        beneficiaryId,
        userId: userId || null,
        amount: amount.toString(),
      },
    });

    // Common session configuration
    const sessionConfig: Stripe.Checkout.SessionCreateParams = {
      payment_method_types: ["card"],
      mode: "subscription",
      line_items: [{ price: price.id, quantity: 1 }],
      payment_method_options: {
        card: { request_three_d_secure: "automatic" },
      },
      metadata: {
        beneficiaryId,
        beneficiaryName,
        childName: beneficiaryName,
        amount: amount.toString(),
        childLocation: location,
        userId: userId || null,
        paymentType,
      },
      subscription_data: {
        metadata: {
          beneficiaryId,
          userId: userId || null,
          amount: amount.toString(),
        },
      },
    };

    if (isEmbedded) {
      sessionConfig.ui_mode = "embedded";
      sessionConfig.return_url = `${process.env.NEXT_PUBLIC_BASE_URL}/payments/return?embedded=true&session_id={CHECKOUT_SESSION_ID}`;
    } else {
      sessionConfig.success_url = `${process.env.NEXT_PUBLIC_BASE_URL}/payments/success?session_id={CHECKOUT_SESSION_ID}`;
      sessionConfig.cancel_url = `${process.env.NEXT_PUBLIC_BASE_URL}/payments/failed?session_id={CHECKOUT_SESSION_ID}`;
    }

    const session = await stripe.checkout.sessions.create(sessionConfig);

    return NextResponse.json({
      url: session.url,
      clientSecret: session.client_secret,
    });
  } catch (error) {
    console.error("Stripe Error:", error);
    return NextResponse.json(
      { error: "Failed to create checkout session" },
      { status: 500 }
    );
  }
}
