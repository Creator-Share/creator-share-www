import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@/utils/supabase/server";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('id');
  const supabase = await createClient();

  if (!sessionId) {
    return NextResponse.json({ error: "Session ID is required" }, { status: 400 });
  }

  try {
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ['customer_details', 'payment_intent']
      });
      
      return NextResponse.json({ 
        session,
        status: session.status 
      });
      
    } catch {
      const { data: transaction } = await supabase
        .from("transaction_ledger")
        .select("*, sponsor_people(name)")
        .eq("reference", sessionId)
        .single();

      if (transaction) {
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
      const { data: pendingSubscription } = await supabase
        .from("subscriptions")
        .select("*, sponsor_people(name)")
        .eq("stripe_subscription_id", sessionId)
        .single();

      if (pendingSubscription) {
        return NextResponse.json({
          session: {
            id: sessionId,
            status: pendingSubscription.status,
            metadata: {
              childName: pendingSubscription.sponsor_people?.name || '',
              childLocation: '',
            }
          },
          status: pendingSubscription.status
        });
      }
      return NextResponse.json({ 
        error: "Payment session not found",
        code: "SESSION_NOT_FOUND"
      }, { status: 404 });
    }
  } catch (error) {
    console.error('Error checking session status:', error);
    return NextResponse.json({ 
      error: "An unexpected error occurred",
      code: "UNKNOWN_ERROR",
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
} 