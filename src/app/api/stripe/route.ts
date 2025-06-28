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
      allowBelowMinimum,
      type,
      project,
      email
    } = await req.json();

    if (!amount || (amount < 1000 && !allowBelowMinimum)) {
      return NextResponse.json(
        { error: "Minimum amount is $10." },
        { status: 400 }
      );
    }

    const isMonthly = paymentType === "subscription";
    const interval = isMonthly ? "month" : "year";

    let productName: string;
    let productImages: string[];
    if (type === "partnership") {
      productName = `${isMonthly ? "Monthly" : "Yearly"} Partnership - ${project}`;
      productImages = [];
    } else {
      const safeImage = beneficiaryImage;
      const fullImageUrl = safeImage.startsWith("http")
        ? safeImage
        : `${process.env.NEXT_PUBLIC_BASE_URL}${safeImage}`;
      productName = `${isMonthly ? "Monthly" : "Yearly"} Sponsorship for ${beneficiaryName}`;
      productImages = [fullImageUrl];
    }

    const product = await stripe.products.create({
      name: productName,
      images: productImages,
    });

    const price = await stripe.prices.create({
      unit_amount: amount,
      currency: "usd",
      recurring: { interval },
      product: product.id,
      metadata: type === "partnership" ? {
        type: "partnership",
        project,
        amount: amount.toString(),
      } : {
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
      customer_email: email,
      metadata: type === "partnership" ? {
        type: "partnership",
        amount: amount.toString(),
        project,
        email,
        paymentType
      } : {
        beneficiaryId,
        beneficiaryName,
        childName: beneficiaryName,
        amount: amount.toString(),
        childLocation: location,
        userId: userId || null,
        paymentType,
      },
      subscription_data: {
        metadata: type === "partnership" ? {
          type: "partnership",
          project,
          amount: amount.toString(),
          email,
        } : {
          beneficiaryId,
          userId: userId || null,
          amount: amount.toString(),
        },
      },
    };

    if (isEmbedded) {
      sessionConfig.ui_mode = "embedded";
      sessionConfig.return_url = `${process.env.NEXT_PUBLIC_BASE_URL}/payments/success?embedded=true&session_id={CHECKOUT_SESSION_ID}`;
    } else {
      sessionConfig.success_url = `${process.env.NEXT_PUBLIC_BASE_URL}/payments/success?session_id={CHECKOUT_SESSION_ID}`;
      sessionConfig.cancel_url = `${process.env.NEXT_PUBLIC_BASE_URL}/payments/failed?session_id={CHECKOUT_SESSION_ID}`;
    }

    const session = await stripe.checkout.sessions.create(sessionConfig);

    // Remove partnership record creation from checkout session creation
    // Partnership records will be created/updated in webhook handler upon payment success
    if (type === "partnership") {
      // Do nothing here for partnership record creation
    }

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
