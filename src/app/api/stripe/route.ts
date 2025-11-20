import { NextResponse } from "next/server"
import Stripe from "stripe"

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string)

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
      email,
    } = await req.json()

    // If a hardcoded server-side price is configured, enforce it.
    const hardcodedRaw = process.env.NEXT_PUBLIC_SPONSORSHIP_GOAL
    const hardcoded = hardcodedRaw ? parseInt(hardcodedRaw, 10) : null
    if (hardcoded !== null && (isNaN(hardcoded) || hardcoded <= 0)) {
      console.warn(
        "NEXT_PUBLIC_SPONSORSHIP_GOAL is set but invalid:",
        hardcodedRaw,
      )
    }

    // Use the hardcoded value if present, otherwise use the client-provided amount.
    const enforcedAmount = hardcoded !== null ? hardcoded : amount

    // Validate enforced amount (keep existing minimum unless overriden intentionally)
    if (!enforcedAmount || (enforcedAmount < 1000 && !allowBelowMinimum)) {
      return NextResponse.json(
        { error: "Minimum amount is $10." },
        { status: 400 },
      )
    }

    // Check for duplicate active subscriptions (first line of defense)
    // This catches obvious duplicates but allows concurrent checkout attempts
    // The database unique constraint will be the final arbiter in the webhook
    if (beneficiaryId && type !== "partnership") {
      const { createClient } = await import("@/utils/supabase/server")
      const supabase = await createClient()
      
      // Check for any existing subscriptions in any active-like state
      const { data: existingSubscriptions, error: checkError } = await supabase
        .from("subscriptions")
        .select("id, status, stripe_subscription_id")
        .eq("beneficiary_id", beneficiaryId)
        .in("status", ["complete", "incomplete"])
        .limit(1)
      
      if (checkError) {
        console.error("Error checking for duplicate subscriptions:", checkError)
        // Continue anyway - don't block on this check
      }
      
      // If there's already an active subscription, reject immediately
      if (existingSubscriptions && existingSubscriptions.length > 0) {
        return NextResponse.json(
          { 
            error: "DUPLICATE_SPONSORSHIP",
            message: "This child already has an active sponsorship. Please choose a different child to sponsor.",
            existingSubscription: existingSubscriptions[0]
          },
          { status: 409 },
        )
      }
      
      // Also check for any in-progress checkouts
      const { data: inProgressCheckouts, error: checkoutError } = await supabase
        .from("subscriptions")
        .select("id")
        .eq("beneficiary_id", beneficiaryId)
        .eq("status", "incomplete")
        .limit(1)

      if (checkoutError) {
        console.error("Error checking for in-progress checkouts:", checkoutError)
      }

      // Block if there's an in-progress checkout
      if (inProgressCheckouts && inProgressCheckouts.length > 0) {
        return NextResponse.json(
          {
            error: "CHECKOUT_IN_PROGRESS",
            message: "This child is currently being sponsored by someone else. Please try again in a few minutes or choose another child.",
          },
          { status: 409 }
        )
      }

      // Create a pending subscription to block concurrent checkouts
      const { error: createError } = await supabase
        .from("subscriptions")
        .insert({
          beneficiary_id: beneficiaryId,
          user_id: userId,
          status: "incomplete",
          amount: enforcedAmount,
          interval: paymentType === "subscription" ? "month" : "year",
          sponsorship_method: "STRIPE"
        })

      if (createError) {
        console.error("Error creating pending subscription:", createError)
        return NextResponse.json(
          {
            error: "FAILED_TO_LOCK",
            message: "Unable to process checkout at this time. Please try again.",
          },
          { status: 500 }
        )
      }
    }

    const isMonthly = paymentType === "subscription"
    const interval = isMonthly ? "month" : "year"

    let productName: string
    let productImages: string[]
    if (type === "partnership") {
      productName = `${isMonthly ? "Monthly" : "Yearly"} Partnership - ${project}`
      productImages = []
    } else {
      const safeImage = beneficiaryImage
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || ""
      const isLocalBase = /localhost|127\.0\.0\.1/.test(baseUrl)
      const fullImageUrl = safeImage.startsWith("http")
        ? safeImage
        : isLocalBase
          ? "https://media.istockphoto.com/id/1288129985/vector/missing-image-of-a-person-placeholder.jpg?s=612x612&w=0&k=20&c=9kE777krx5mrFHsxx02v60ideRWvIgI1RWzR1X4MG2Y="
          : `${baseUrl}${safeImage}`
      productName = `${isMonthly ? "Monthly" : "Yearly"} Sponsorship for ${beneficiaryName}`
      productImages = [fullImageUrl]
    }

    const product = await stripe.products.create({
      name: productName,
      images: productImages,
    })

    // Create price using the enforced amount (either hardcoded server var or client-provided)
    const price = await stripe.prices.create({
      unit_amount: enforcedAmount,
      currency: "usd",
      recurring: { interval },
      product: product.id,
      metadata:
        type === "partnership"
          ? {
              type: "partnership",
              project,
              amount: enforcedAmount.toString(),
              hardcoded_override: hardcoded !== null ? "true" : "false",
            }
          : {
              beneficiaryId,
              userId: userId || null,
              amount: enforcedAmount.toString(),
              hardcoded_override: hardcoded !== null ? "true" : "false",
            },
    })

    // Common session configuration
    const sessionConfig: Stripe.Checkout.SessionCreateParams = {
      payment_method_types: ["card"],
      mode: "subscription",
      line_items: [{ price: price.id, quantity: 1 }],
      billing_address_collection: "required",
      payment_method_options: {
        card: { request_three_d_secure: "automatic" },
      },
      customer_email: email,
      metadata:
        type === "partnership"
          ? {
              type: "partnership",
              amount: enforcedAmount.toString(),
              project,
              email,
              paymentType,
              hardcoded_override: hardcoded !== null ? "true" : "false",
            }
          : {
              beneficiaryId,
              beneficiaryName,
              childName: beneficiaryName,
              amount: enforcedAmount.toString(),
              childLocation: location,
              userId: userId || null,
              paymentType,
              hardcoded_override: hardcoded !== null ? "true" : "false",
            },
      subscription_data: {
        metadata:
          type === "partnership"
            ? {
                type: "partnership",
                project,
                amount: enforcedAmount.toString(),
                email,
                hardcoded_override: hardcoded !== null ? "true" : "false",
              }
            : {
                beneficiaryId,
                userId: userId || null,
                amount: enforcedAmount.toString(),
                hardcoded_override: hardcoded !== null ? "true" : "false",
              },
      },
    }

    if (isEmbedded) {
      sessionConfig.ui_mode = "embedded"
      sessionConfig.return_url = `${process.env.NEXT_PUBLIC_BASE_URL}/payments/success?embedded=true&session_id={CHECKOUT_SESSION_ID}`
    } else {
      sessionConfig.success_url = `${process.env.NEXT_PUBLIC_BASE_URL}/payments/success?session_id={CHECKOUT_SESSION_ID}`
      sessionConfig.cancel_url = `${process.env.NEXT_PUBLIC_BASE_URL}/payments/failed?session_id={CHECKOUT_SESSION_ID}`
    }

    const session = await stripe.checkout.sessions.create(sessionConfig)

    return NextResponse.json({
      url: session.url,
      clientSecret: session.client_secret,
    })
  } catch (error) {
    console.error("Stripe Error:", error)
    return NextResponse.json(
      { error: "Failed to create checkout session" },
      { status: 500 },
    )
  }
}
