import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@/utils/supabase/server";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

export async function POST(req: Request) {
  try {
    const { subscriptionId } = await req.json();
    
    if (!subscriptionId) {
      return NextResponse.json({ error: "Subscription ID is required" }, { status: 400 });
    }
    
    const supabase = await createClient();

    // First check if the subscription exists in our database
    const { data: subscription, error: fetchError } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("stripe_subscription_id", subscriptionId)
      .single();
      
    if (fetchError || !subscription) {
      return NextResponse.json({ 
        error: "Subscription not found in database" 
      }, { status: 404 });
    }
    
    // If subscription is already cancelled, just return success
    if (subscription.status === "cancelled") {
      return NextResponse.json({ 
        message: "Subscription was already cancelled",
        alreadyCancelled: true
      });
    }

    try {
      // Cancel the subscription in Stripe
      await stripe.subscriptions.cancel(subscriptionId);
      
      // Update our database record
      const { error } = await supabase
        .from("subscriptions")
        .update({ 
          status: "cancelled",
          canceled_at: new Date().toISOString()
        })
        .eq("stripe_subscription_id", subscriptionId);

      if (error) {
        console.error("Database error when cancelling subscription:", error);
        return NextResponse.json({ 
          error: "Failed to update subscription in database",
          details: error.message
        }, { status: 500 });
      }

      return NextResponse.json({ 
        message: "Subscription cancelled successfully" 
      });
    } catch (stripeError) {
      console.error("Stripe error when cancelling subscription:", stripeError);
      
      // If Stripe cancellation fails but it's because the subscription doesn't exist there,
      // we should still update our database
      if (stripeError instanceof Stripe.errors.StripeInvalidRequestError) {
        
        // Update our database to show cancelled anyway
        const { error } = await supabase
          .from("subscriptions")
          .update({ 
            status: "cancelled",
            canceled_at: new Date().toISOString()
          })
          .eq("stripe_subscription_id", subscriptionId);
          
        if (error) {
          console.error("Database error when cancelling subscription:", error);
        }
        
        return NextResponse.json({ 
          message: "Subscription marked as cancelled in database",
          warning: "Subscription not found in Stripe"
        });
      }
      
      return NextResponse.json({ 
        error: "Failed to cancel subscription with Stripe",
        details: stripeError instanceof Error ? stripeError.message : 'Unknown error'
      }, { status: 500 });
    }
  } catch (error) {
    console.error("Error cancelling subscription:", error);
    return NextResponse.json({
      error: "Failed to process cancellation request",
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
