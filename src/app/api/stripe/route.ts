import { NextResponse } from "next/server"
import Stripe from "stripe"
import { PERSON_PLACEHOLDER_PATH } from "@/utils/placeholders"
import { createServiceRoleClient } from "@/utils/supabase/server"
import {
  filterExistingMediaRows,
  getExternalCheckoutImageUrl,
  MediaRow,
} from "@/utils/supabase/media"
import {
  getPublishableKey,
  getStripeClient,
} from "@/lib/stripe/config"
import { getStripeRegionForPaymentCurrency } from "@/lib/stripe/currencyRouting"
import { MINIMUM_OPEN_SPONSORSHIP_CENTS } from "@/config/beneficiaryTypes"
import {
  buildPaymentCurrencyMetadata,
  coerceSupportedCurrency,
  convertUsdCentsToCurrency,
  formatConversionForDisplay,
} from "@/utils/currency"

const PUBLIC_BASE_URL = "https://creator-share-www.vercel.app"

function getPublicSiteBaseUrl(): string {
  const base = process.env.NEXT_PUBLIC_BASE_URL || PUBLIC_BASE_URL
  if (base.includes("localhost") || base.includes("127.0.0.1")) {
    return PUBLIC_BASE_URL
  }
  return base.replace(/\/$/, "")
}

async function getStripeProductImageUrl(
  beneficiaryId: string | null | undefined,
  fallbackImage: string,
): Promise<string> {
  if (!beneficiaryId) return fallbackImage

  try {
    const supabase = createServiceRoleClient()
    const { data, error } = await supabase
      .from("media")
      .select("*")
      .eq("parent_id", beneficiaryId)
      .eq("type", "IMAGE")
      .order("weight", { ascending: true })
      .limit(10)

    if (error || !data || data.length === 0) return fallbackImage

    const existingMedia = await filterExistingMediaRows(
      supabase,
      data as unknown as MediaRow[],
    )
    if (existingMedia.length === 0) return fallbackImage

    return getExternalCheckoutImageUrl(existingMedia[0])
  } catch (error) {
    console.error("Failed to resolve Stripe product image:", error)
    return fallbackImage
  }
}

export async function POST(req: Request) {
  try {
    const {
      beneficiaryId,
      beneficiaryName,
      amount,
      paymentType,
      location,
      userId,
      isEmbedded,
      type,
      beneficiaryType,
      project,
      email,
      sponsorshipMode,
      blindLabel,
      currency: currencyInput,
    } = await req.json()

    const selectedCurrency = coerceSupportedCurrency(currencyInput)
    const region = getStripeRegionForPaymentCurrency(selectedCurrency)
    const stripe = getStripeClient(region)

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
    const fallbackImage = `${getPublicSiteBaseUrl()}${PERSON_PLACEHOLDER_PATH}`

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

    // Validate enforced amount — integer cents, at least MINIMUM for open sponsorships.
    // Blind sponsorships are pre-set to 3333 cents above, so they always pass.
    if (
      !Number.isFinite(enforcedAmount) ||
      !Number.isInteger(enforcedAmount) ||
      enforcedAmount < MINIMUM_OPEN_SPONSORSHIP_CENTS
    ) {
      const minimumConversion = convertUsdCentsToCurrency(
        MINIMUM_OPEN_SPONSORSHIP_CENTS,
        selectedCurrency,
      )
      return NextResponse.json(
        { error: `Minimum amount is ${formatConversionForDisplay(minimumConversion)}` },
        { status: 400 },
      )
    }
    const conversion = convertUsdCentsToCurrency(enforcedAmount, selectedCurrency)
    const paymentCurrencyMetadata = buildPaymentCurrencyMetadata(conversion)

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
      productName = `${isOneTime ? "One-time" : isMonthly ? "Monthly" : "Yearly"} Sponsorship for ${resolvedBeneficiaryName}`
      productImages = [
        await getStripeProductImageUrl(beneficiaryId, fallbackImage),
      ]
    }

    const product = await stripe.products.create({
      name: productName,
      images: productImages,
    })

    // Stripe MetadataParam requires all values to be string | number | null — cast explicitly.
    const priceMetadata: Record<string, string | null> =
      type === "partnership"
        ? {
            type: "partnership",
            project,
            amount: enforcedAmount.toString(),
            ...paymentCurrencyMetadata,
          }
        : {
            beneficiaryId: beneficiaryId || null,
            userId: userId || null,
            amount: enforcedAmount.toString(),
            sponsorshipMode: resolvedSponsorshipMode,
            blindLabel: resolvedBlindLabel,
            beneficiaryName: resolvedBeneficiaryName,
            beneficiaryType: beneficiaryType || null,
            ...paymentCurrencyMetadata,
          }

    // One-time payments must NOT have a `recurring` property on the price
    const price = await stripe.prices.create({
      unit_amount: conversion.chargedAmountMinor,
      currency: conversion.chargedCurrency.toLowerCase(),
      ...(isOneTime ? {} : { recurring: { interval } }),
      product: product.id,
      metadata: priceMetadata,
    })

    // Platform identity marker — every checkout created by this route includes
    // creatorshare_platform so the Stripe webhook can positively identify
    // sessions originating from Creator Share. Sessions without this tag
    // (e.g. from other surfaces sharing this Stripe account) are silently
    // acknowledged and dropped.
    const sessionMetadata: Record<string, string | null> =
      type === "partnership"
        ? {
            type: "partnership",
            amount: enforcedAmount.toString(),
            project,
            email,
            paymentType,
            region,
            creatorshare_platform: "true",
            ...paymentCurrencyMetadata,
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
            beneficiaryType: beneficiaryType || null,
            region,
            creatorshare_platform: "true",
            ...paymentCurrencyMetadata,
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
        // subscription_data.metadata is what Stripe stamps onto the resulting
        // Stripe.Subscription, which is the metadata read by every
        // customer.subscription.* / invoice.* event handler. It MUST carry
        // creatorshare_platform (so the identity gate protects those events
        // too) and `type` (so the type-name filter for subscription events
        // routes sponsorship cancellations through reconciliation instead of
        // dropping them silently when a sponsor cancels via Stripe's
        // hosted billing portal).
        subscription_data: {
          metadata:
            type === "partnership"
              ? {
                  type: "partnership",
                  project,
                  amount: enforcedAmount.toString(),
                  email,
                  region,
                  creatorshare_platform: "true",
                  ...paymentCurrencyMetadata,
                }
              : {
                  type: "sponsorship",
                  beneficiaryId: beneficiaryId || undefined,
                  userId: userId || null,
                  amount: enforcedAmount.toString(),
                  sponsorshipMode: resolvedSponsorshipMode,
                  blindLabel: resolvedBlindLabel,
                  beneficiaryName: resolvedBeneficiaryName,
                  beneficiaryType: beneficiaryType || undefined,
                  region,
                  creatorshare_platform: "true",
                  ...paymentCurrencyMetadata,
                },
        },
      }),
    }

    if (isEmbedded) {
      sessionConfig.ui_mode = "embedded"
      sessionConfig.return_url = `${process.env.NEXT_PUBLIC_BASE_URL}/payments/success?embedded=true&session_id={CHECKOUT_SESSION_ID}&region=${region}&currency=${conversion.chargedCurrency}`
    } else {
      sessionConfig.success_url = `${process.env.NEXT_PUBLIC_BASE_URL}/payments/success?session_id={CHECKOUT_SESSION_ID}&region=${region}&currency=${conversion.chargedCurrency}`
      sessionConfig.cancel_url = `${process.env.NEXT_PUBLIC_BASE_URL}/payments/failed?session_id={CHECKOUT_SESSION_ID}&region=${region}&currency=${conversion.chargedCurrency}`
    }

    const session = await stripe.checkout.sessions.create(sessionConfig)

    return NextResponse.json({
      url: session.url,
      clientSecret: session.client_secret,
      region,
      publishableKey: getPublishableKey(region),
      chargedAmountMinor: conversion.chargedAmountMinor,
      chargedCurrency: conversion.chargedCurrency,
    })
  } catch (error) {
    console.error("Stripe Error:", error)
    return NextResponse.json(
      { error: "Failed to create checkout session" },
      { status: 500 },
    )
  }
}
