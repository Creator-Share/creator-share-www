import { NextResponse } from "next/server"
import Stripe from "stripe"
import { PERSON_PLACEHOLDER_PATH } from "@/utils/placeholders"

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
    // Use SVG directly from public folder
    // For Stripe product images, we need a full URL (Stripe requires absolute URLs)
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://creator-share-www.vercel.app"
    const fallbackImage = `${baseUrl}${PERSON_PLACEHOLDER_PATH}`

    // For blind sponsorships, always use $33.33 (3333 cents).
    // For regular sponsorships, the client sends the correct amount:
    //   Fixed types: budget_goal (set at create from config)
    //   Open types: user-chosen amount (>= MINIMUM_OPEN_SPONSORSHIP_CENTS)
    let enforcedAmount: number
    if (isBlindSponsorship) {
      enforcedAmount = 3333 // Fixed $33.33 for blind sponsorships
    } else {
      enforcedAmount = amount // Use the amount sent from the client
    }

    // Validate enforced amount — minimum $5 (500 cents) for open sponsorships
    if (!enforcedAmount || enforcedAmount < 500) {
      return NextResponse.json(
        { error: "Minimum amount is $5." },
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
          ? `${baseUrl}${PERSON_PLACEHOLDER_PATH}` // Use path constant, construct full URL for Stripe
          : `${baseUrl}${safeImage}`
      productName = `${isMonthly ? "Monthly" : "Yearly"} Sponsorship for ${resolvedBeneficiaryName}`
      productImages = [fullImageUrl]
    }

    const product = await stripe.products.create({
      name: productName,
      images: productImages,
    })

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
            }
          : {
              beneficiaryId: beneficiaryId || null,
              userId: userId || null,
              amount: enforcedAmount.toString(),
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
            }
          : {
              beneficiaryId: beneficiaryId || undefined,
              beneficiaryName: resolvedBeneficiaryName,
              childName: resolvedBeneficiaryName,
              amount: enforcedAmount.toString(),
              childLocation: location,
              userId: userId || null,
              paymentType,
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
              }
            : {
                beneficiaryId: beneficiaryId || undefined,
                userId: userId || null,
                amount: enforcedAmount.toString(),
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
