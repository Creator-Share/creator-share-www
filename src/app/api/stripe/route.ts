import { NextResponse } from "next/server"
import Stripe from "stripe"
import { PERSON_PLACEHOLDER_PATH } from "@/utils/placeholders"
import {
  MAXIMUM_OPEN_SPONSORSHIP_CENTS,
  MINIMUM_OPEN_SPONSORSHIP_CENTS,
} from "@/config/beneficiaryTypes"
import { centsToDollars } from "@/utils/currency"

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

    // Validate enforced amount — integer cents, within [MIN, MAX] for open sponsorships.
    // Blind sponsorships are pre-set to 3333 cents above, so they always pass.
    if (
      !Number.isFinite(enforcedAmount) ||
      !Number.isInteger(enforcedAmount) ||
      enforcedAmount < MINIMUM_OPEN_SPONSORSHIP_CENTS ||
      enforcedAmount > MAXIMUM_OPEN_SPONSORSHIP_CENTS
    ) {
      const minDollars = Number(centsToDollars(MINIMUM_OPEN_SPONSORSHIP_CENTS))
      const maxDollars = Number(centsToDollars(MAXIMUM_OPEN_SPONSORSHIP_CENTS))
      return NextResponse.json(
        { error: `Amount must be between $${minDollars} and $${maxDollars}` },
        { status: 400 },
      )
    }

    const isMonthly = paymentType === "subscription"
    const isOneTime = paymentType === "one_time"

    // one_time is only valid for regular (non-blind, non-partnership) sponsorships.
    // Partnerships and blind sponsorships are always recurring.
    if (isOneTime && (type === "partnership" || isBlindSponsorship)) {
      return NextResponse.json(
        { error: "One-time payment is not supported for this payment type." },
        { status: 400 },
      )
    }

    // Interval is only relevant for recurring payments; one_time prices omit it entirely.
    const interval: "month" | "year" = isMonthly ? "month" : "year"

    let productName: string
    let productImages: string[]
    if (type === "partnership") {
      productName = `${isOneTime ? "One-time" : isMonthly ? "Monthly" : "Yearly"} Partnership - ${project}`
      productImages = []
    } else if (isBlindSponsorship) {
      productName = `${isOneTime ? "One-time" : isMonthly ? "Monthly" : "Yearly"} Blind Sponsorship`
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
      productName = `${isOneTime ? "One-time" : isMonthly ? "Monthly" : "Yearly"} Sponsorship for ${resolvedBeneficiaryName}`
      productImages = [fullImageUrl]
    }

    const product = await stripe.products.create({
      name: productName,
      images: productImages,
    })

    // Stripe MetadataParam requires all values to be string | number | null — cast explicitly.
    const priceMetadata: Record<string, string | null> =
      type === "partnership"
        ? { type: "partnership", project, amount: enforcedAmount.toString() }
        : {
            beneficiaryId: beneficiaryId || null,
            userId: userId || null,
            amount: enforcedAmount.toString(),
            sponsorshipMode: resolvedSponsorshipMode,
            blindLabel: resolvedBlindLabel,
            beneficiaryName: resolvedBeneficiaryName,
          }

    // One-time payments must NOT have a `recurring` property on the price
    const price = await stripe.prices.create({
      unit_amount: enforcedAmount,
      currency: "usd",
      ...(isOneTime ? {} : { recurring: { interval } }),
      product: product.id,
      metadata: priceMetadata,
    })

    const sessionMetadata: Record<string, string | null> =
      type === "partnership"
        ? {
            type: "partnership",
            amount: enforcedAmount.toString(),
            project,
            email,
            paymentType,
          }
        : {
            beneficiaryId: beneficiaryId || null,
            beneficiaryName: resolvedBeneficiaryName,
            childName: resolvedBeneficiaryName,
            amount: enforcedAmount.toString(),
            childLocation: location,
            userId: userId || null,
            paymentType,
            sponsorshipMode: resolvedSponsorshipMode,
            blindLabel: resolvedBlindLabel,
          }

    // One-time: mode="payment", no subscription_data.
    // Recurring: mode="subscription" with subscription_data metadata.
    const sessionConfig: Stripe.Checkout.SessionCreateParams = {
      payment_method_types: ["card"],
      mode: isOneTime ? "payment" : "subscription",
      line_items: [{ price: price.id, quantity: 1 }],
      billing_address_collection: "required",
      payment_method_options: {
        card: { request_three_d_secure: "automatic" },
      },
      customer_email: email,
      metadata: sessionMetadata,
      ...(!isOneTime && {
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
      }),
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
