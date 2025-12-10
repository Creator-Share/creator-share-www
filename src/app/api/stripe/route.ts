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
      sponsorshipMode,
      blindLabel,
    } = await req.json()

    const resolvedSponsorshipMode =
      type === "blind_sponsorship" || sponsorshipMode === "blind"
        ? "blind"
        : "standard"
    const isBlindSponsorship = resolvedSponsorshipMode === "blind"
    const resolvedBeneficiaryName =
      beneficiaryName ||
      (isBlindSponsorship
        ? "Blind sponsorship - we will match you with a child"
        : "Unknown Beneficiary")
    const resolvedBlindLabel =
      blindLabel || "the next child who needs support"
    const fallbackImage =
      "https://media.istockphoto.com/id/1288129985/vector/missing-image-of-a-person-placeholder.jpg?s=612x612&w=0&k=20&c=9kE777krx5mrFHsxx02v60ideRWvIgI1RWzR1X4MG2Y="

    // For blind sponsorships, always use $33.33 (3333 cents) regardless of env var
    // For regular sponsorships, check if a hardcoded server-side price is configured
    const hardcodedRaw = process.env.NEXT_PUBLIC_SPONSORSHIP_GOAL
    const hardcoded = hardcodedRaw ? parseInt(hardcodedRaw, 10) : null
    if (hardcoded !== null && (isNaN(hardcoded) || hardcoded <= 0)) {
      console.warn(
        "NEXT_PUBLIC_SPONSORSHIP_GOAL is set but invalid:",
        hardcodedRaw,
      )
    }

    let enforcedAmount: number
    if (isBlindSponsorship) {
      enforcedAmount = 3333 // Fixed $33.33 for blind sponsorships
    } else {
      // Use the hardcoded value if present, otherwise use the client-provided amount.
      enforcedAmount = hardcoded !== null ? hardcoded : amount
    }

    // Validate enforced amount (keep existing minimum unless overriden intentionally)
    if (!enforcedAmount || (enforcedAmount < 1000 && !allowBelowMinimum)) {
      return NextResponse.json(
        { error: "Minimum amount is $10." },
        { status: 400 },
      )
    }

    const isMonthly = paymentType === "subscription"
    const interval = isMonthly ? "month" : "year"

    let productName: string
    let productImages: string[]
    if (type === "partnership") {
      productName = `${isMonthly ? "Monthly" : "Yearly"} Partnership - ${project}`
      productImages = []
    } else if (isBlindSponsorship) {
      productName = `${isMonthly ? "Monthly" : "Yearly"} Blind Sponsorship`
      productImages = [fallbackImage]
    } else {
      const safeImage = beneficiaryImage
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || ""
      const isLocalBase = /localhost|127\.0\.0\.1/.test(baseUrl)
      const fullImageUrl = safeImage.startsWith("http")
        ? safeImage
        : isLocalBase
          ? "https://media.istockphoto.com/id/1288129985/vector/missing-image-of-a-person-placeholder.jpg?s=612x612&w=0&k=20&c=9kE777krx5mrFHsxx02v60ideRWvIgI1RWzR1X4MG2Y="
          : `${baseUrl}${safeImage}`
      productName = `${isMonthly ? "Monthly" : "Yearly"} Sponsorship for ${resolvedBeneficiaryName}`
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
              beneficiaryId: beneficiaryId || null,
              userId: userId || null,
              amount: enforcedAmount.toString(),
              hardcoded_override: hardcoded !== null ? "true" : "false",
              sponsorshipMode: resolvedSponsorshipMode,
              blindLabel: resolvedBlindLabel,
              beneficiaryName: resolvedBeneficiaryName,
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
              beneficiaryId: beneficiaryId || undefined,
              beneficiaryName: resolvedBeneficiaryName,
              childName: resolvedBeneficiaryName,
              amount: enforcedAmount.toString(),
              childLocation: location,
              userId: userId || null,
              paymentType,
              hardcoded_override: hardcoded !== null ? "true" : "false",
              sponsorshipMode: resolvedSponsorshipMode,
              blindLabel: resolvedBlindLabel,
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
                beneficiaryId: beneficiaryId || undefined,
                userId: userId || null,
                amount: enforcedAmount.toString(),
                hardcoded_override: hardcoded !== null ? "true" : "false",
                sponsorshipMode: resolvedSponsorshipMode,
                blindLabel: resolvedBlindLabel,
                beneficiaryName: resolvedBeneficiaryName,
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
