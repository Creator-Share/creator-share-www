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
    
    // First try to get the session directly from Stripe
    try {
      session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ['customer_details', 'payment_intent']
      });
      
      sessionStatus = session.status;
      console.log(`Retrieved session from Stripe: ${sessionId}, status: ${sessionStatus}`);
      
      // If we found the session in Stripe, return it immediately
      return NextResponse.json({ 
        session,
        status: sessionStatus 
      });
    } catch (stripeError) {
      console.log("Could not retrieve session from Stripe, checking database:", stripeError);
      errorDetails = stripeError instanceof Error ? stripeError.message : 'Unknown Stripe error';
      
      // Continue to check database
    }
    
    // If Stripe retrieval fails, check our database records
    
    // First check transaction ledger
    const { data: transaction } = await supabase
      .from("transaction_ledger")
      .select("*, sponsor_people(name)")
      .eq("reference", sessionId)
      .single();

    if (transaction) {
      console.log(`Found transaction in database for session: ${sessionId}`);
      return NextResponse.json({
        session: {
          id: sessionId,
          status: 'complete',
          metadata: {
            childName: transaction.sponsor_people?.name || '',
            childLocation: '',
          },
          customer_details: {
            email: transaction.customer_email
          }
        },
        status: 'completed'
      });
    }
    
    // Then check subscriptions
    const { data: subscription } = await supabase
      .from("subscriptions")
      .select("*, sponsor_people!inner(name)")
      .eq("stripe_subscription_id", sessionId)
      .single();

    if (subscription) {
      console.log(`Found subscription in database for session: ${sessionId}`);
      return NextResponse.json({
        session: {
          id: sessionId,
          status: subscription.status,
          metadata: {
            childName: subscription.sponsor_people?.name || '',
            childLocation: '',
          },
          customer_details: {
            email: '' // We might not have this in the subscription record
          }
        },
        status: subscription.status
      });
    }
    
    // Check if there's any subscription with this ID as a substring
    // This helps when the session ID is part of a longer subscription ID
    const { data: partialSubscriptions } = await supabase
      .from("subscriptions")
      .select("*, sponsor_people!inner(name)")
      .ilike("stripe_subscription_id", `%${sessionId}%`)
      .limit(1);
      
    if (partialSubscriptions && partialSubscriptions.length > 0) {
      console.log(`Found partial match subscription in database for session: ${sessionId}`);
      return NextResponse.json({
        session: {
          id: sessionId,
          status: partialSubscriptions[0].status,
          metadata: {
            childName: partialSubscriptions[0].sponsor_people?.name || '',
            childLocation: '',
          },
          customer_details: {
            email: '' 
          }
        },
        status: partialSubscriptions[0].status
      });
    }
    
    // If we can't find any records, return a clear error with details
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
