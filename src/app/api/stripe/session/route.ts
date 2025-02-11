import { NextResponse } from "next/server";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('id');

  if (!sessionId) {
    return NextResponse.json({ error: "Session ID is required" }, { status: 400 });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    return NextResponse.json({ session });
  } catch (error) {
    if (error instanceof Stripe.errors.StripeError) {
      console.error('Stripe Error:', error.message);
      return NextResponse.json({ 
        error: "Failed to retrieve session",
        details: error.message 
      }, { status: 500 });
    }
    throw error;
  }
} 