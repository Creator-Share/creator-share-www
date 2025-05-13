import { NextResponse } from "next/server";
import { createClient } from '@/utils/supabase/server';
import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

export async function POST(req: Request) {
  try {
    const {
      sponsorshipId,
      sponsorshipType,
      name,
      amount,
      paymentType,
      image,
      location,
      isEmbedded,
    } = await req.json();

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const userId = user?.id || null;

    if (!amount || amount < 1000) { // 1000 cents = $10.00
      return NextResponse.json(
        { error: "Minimum amount is $10." },
        { status: 400 }
      );
    }

    const fullImageUrl = image.startsWith('http') 
      ? image 
      : `${process.env.NEXT_PUBLIC_BASE_URL}${image}`;

    const isMonthly = paymentType === "subscription";
    
    let sessionConfig: Stripe.Checkout.SessionCreateParams;

    if (isMonthly) {
      const product = await stripe.products.create({
        name: `Monthly ${sponsorshipType.toLowerCase()} Sponsorship for ${name}`,
        images: [fullImageUrl],
        metadata: {
          sponsorshipId,
          sponsorshipType,
          userId,
        }
      });

      const price = await stripe.prices.create({
        unit_amount: amount,
        currency: 'usd',
        recurring: { interval: 'month' },
        product: product.id,
        metadata: {
          sponsorshipId,
          sponsorshipType,
          userId,
          amount: amount.toString()
        }
      });

      sessionConfig = {
        payment_method_types: ["card"],
        mode: 'subscription',
        line_items: [{ 
          price: price.id, 
          quantity: 1,
          adjustable_quantity: {
            enabled: false
          }
        }],
        allow_promotion_codes: false,
        subscription_data: {
          metadata: {
            sponsorshipId,
            sponsorshipType,
            userId,
            name, // <-- Add the beneficiary's name here
            amount: amount.toString(),
            paymentType: "subscription"
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
          adjustable_quantity: {
            enabled: false
          },
          price_data: {
            currency: 'usd',
            unit_amount: amount,
            product_data: {
              name: `One-time ${sponsorshipType.toLowerCase()} Sponsorship for ${name}`,
              images: [fullImageUrl],
              metadata: {
                sponsorshipId,
                sponsorshipType,
                userId,
              }
            },
          },
        }]
      };
    }

    // Base config for both payment types
    const baseConfig: Partial<Stripe.Checkout.SessionCreateParams> = {
      payment_method_options: {
        card: { request_three_d_secure: 'automatic' }
      },
      metadata: {
        sponsorshipId,
        sponsorshipType,
        name,
        amount: amount.toString(),
        location,
        userId,
        paymentType
      },
      allow_promotion_codes: false,
      billing_address_collection: 'required' as const,
      phone_number_collection: {
        enabled: true
      }
    };

    // Only add customer_creation for one-time payments
    if (!isMonthly) {
      sessionConfig = {
        ...sessionConfig,
        ...baseConfig,
        customer_creation: 'always' as const
      };
    } else {
      sessionConfig = {
        ...sessionConfig,
        ...baseConfig
      };
    }

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

    console.log('Creating Stripe session with config:', JSON.stringify(sessionConfig, null, 2));
    const session = await stripe.checkout.sessions.create(sessionConfig);
    console.log('Created Stripe session:', session.id);

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
