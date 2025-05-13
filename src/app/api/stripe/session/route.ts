import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@/utils/supabase/server";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('id');
  
  if (!sessionId) {
    return NextResponse.json({ error: "Session ID is required" }, { status: 400 });
  }

  try {
    const supabase = await createClient();
    let session = null;
    let sessionStatus = null;
    let errorDetails = null;

    try {
      session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ['customer_details', 'payment_intent']
      });
      
      sessionStatus = session.status;
      console.log(`Retrieved session from Stripe: ${sessionId}, status: ${sessionStatus}`);
      
      if (session.payment_intent) {
        console.log('Payment Intent ID from session:', session.payment_intent);
        const paymentIntent = await stripe.paymentIntents.retrieve(session.payment_intent as string);
        console.log('Retrieved Payment Intent details:', {
          id: paymentIntent.id,
          status: paymentIntent.status,
          amount: paymentIntent.amount
        });
      }

      return NextResponse.json({ 
        session,
        status: sessionStatus 
      });
    } catch (stripeError) {
      console.log("Could not retrieve session from Stripe, checking database:", stripeError);
      errorDetails = stripeError instanceof Error ? stripeError.message : 'Unknown Stripe error';
    }

    const { data: transaction } = await supabase
      .from("transaction_ledger")
      .select(`
        *,
        sponsorships: sponsorship_id (
          child_details(*),
          street_involved_details(*),
          child_labor_details(*),
          family_details(*),
          puppy_details(*)
        )
      `)
      .eq("reference", sessionId)
      .single();

    if (transaction) {
      const sponsorship = transaction.sponsorships || {};
      const childName =
        sponsorship.child_details?.[0]?.name ||
        sponsorship.street_involved_details?.[0]?.name ||
        sponsorship.child_labor_details?.[0]?.name ||
        sponsorship.family_details?.[0]?.name ||
        sponsorship.puppy_details?.[0]?.name ||
        "";

      console.log(`Found transaction in database for session: ${sessionId}`);
      return NextResponse.json({
        session: {
          id: sessionId,
          status: 'complete',
          metadata: {
            childName,
            childLocation: '',
          },
          customer_details: {
            email: transaction.customer_email
          }
        },
        status: 'completed'
      });
    }

    const { data: subscription } = await supabase
      .from("subscriptions")
      .select(`
        *,
        sponsorships: sponsorship_id (
          child_details(*),
          street_involved_details(*),
          child_labor_details(*),
          family_details(*),
          puppy_details(*)
        )
      `)
      .eq("stripe_subscription_id", sessionId)
      .single();

    if (subscription) {
      const sponsorship = subscription.sponsorships || {};
      const childName =
        sponsorship.child_details?.[0]?.name ||
        sponsorship.street_involved_details?.[0]?.name ||
        sponsorship.child_labor_details?.[0]?.name ||
        sponsorship.family_details?.[0]?.name ||
        sponsorship.puppy_details?.[0]?.name ||
        "";

      console.log(`Found subscription in database for session: ${sessionId}`);
      return NextResponse.json({
        session: {
          id: sessionId,
          status: subscription.status,
          metadata: {
            childName,
            childLocation: '',
          },
          customer_details: {
            email: ''
          }
        },
        status: subscription.status
      });
    }
    

    const { data: partialSubscriptions } = await supabase
      .from("subscriptions")
      .select(`
        *,
        sponsorships: sponsorship_id (
          child_details(*),
          street_involved_details(*),
          child_labor_details(*),
          family_details(*),
          puppy_details(*)
        )
      `)
      .ilike("stripe_subscription_id", `%${sessionId}%`)
      .limit(1);
      
    if (partialSubscriptions && partialSubscriptions.length > 0) {
      const sponsorship = partialSubscriptions[0].sponsorships || {};
      const childName =
        sponsorship.child_details?.[0]?.name ||
        sponsorship.street_involved_details?.[0]?.name ||
        sponsorship.child_labor_details?.[0]?.name ||
        sponsorship.family_details?.[0]?.name ||
        sponsorship.puppy_details?.[0]?.name ||
        "";

      console.log(`Found partial match subscription in database for session: ${sessionId}`);
      return NextResponse.json({
        session: {
          id: sessionId,
          status: partialSubscriptions[0].status,
          metadata: {
            childName,
            childLocation: '',
          },
          customer_details: {
            email: '' 
          }
        },
        status: partialSubscriptions[0].status
      });
    }

    return NextResponse.json({ 
      error: "Payment session not found",
      code: "SESSION_NOT_FOUND",
      details: errorDetails,
      checkedStripe: true,
      checkedDatabase: true
    }, { status: 404 });
  } catch (error) {
    console.error('Error checking session status:', error);
    return NextResponse.json({ 
      error: "An unexpected error occurred",
      code: "UNKNOWN_ERROR",
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
