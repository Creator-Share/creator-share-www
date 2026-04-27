"use server"

import Stripe from "stripe"

import {
  coerceRegion,
  getPublishableKey,
  getStripeClient,
  getStripeConfig,
  type StripeRegion,
} from "@/lib/stripe/config"
import { getPlaceholderImageUrl } from "@/utils/placeholders"

// For Stripe product images, we need a full URL
const FALLBACK_IMAGE = getPlaceholderImageUrl()
const BLIND_LABEL = "the next child who needs support"
const BLIND_SPONSORSHIP_AMOUNT_CENTS = 3333 // Fixed $33.33 for blind sponsorships

export interface CreateBlindSponsorshipCheckoutParams {
  paymentType: string
  userId?: string | null
  email?: string
  isEmbedded?: boolean
  region?: StripeRegion | string | null
}

export interface CreateBlindSponsorshipCheckoutResult {
  success: boolean
  url?: string
  clientSecret?: string
  region?: StripeRegion
  publishableKey?: string
  error?: string
}

/**
 * Server action to create a Stripe checkout session for blind sponsorship
 * Moves blind sponsorship checkout logic from API route to server action
 */
export async function createBlindSponsorshipCheckout(
  params: CreateBlindSponsorshipCheckoutParams,
): Promise<CreateBlindSponsorshipCheckoutResult> {
  try {
    const {
      paymentType,
      userId,
      email,
      isEmbedded = false,
      region: regionInput,
    } = params

    const region = coerceRegion(regionInput)
    const stripe = getStripeClient(region)
    const stripeCurrency = getStripeConfig(region).currency

    const isMonthly = paymentType === "subscription"
    const interval = isMonthly ? "month" : "year"
    const productName = `${isMonthly ? "Monthly" : "Yearly"} Blind Sponsorship`
    const beneficiaryName = "Blind sponsorship - we will match you with a child"

    // Create Stripe product for blind sponsorship
    const product = await stripe.products.create({
      name: productName,
      images: [FALLBACK_IMAGE],
    })

    // Create price using the fixed amount ($33.33)
    const price = await stripe.prices.create({
      unit_amount: BLIND_SPONSORSHIP_AMOUNT_CENTS,
      currency: stripeCurrency,
      recurring: { interval },
      product: product.id,
      metadata: {
        userId: userId || null,
        amount: BLIND_SPONSORSHIP_AMOUNT_CENTS.toString(),
        sponsorshipMode: "blind",
        blindLabel: BLIND_LABEL,
        beneficiaryName,
      },
    })

    // Configure checkout session
    const sessionConfig: Stripe.Checkout.SessionCreateParams = {
      payment_method_types: ["card"],
      mode: "subscription",
      line_items: [{ price: price.id, quantity: 1 }],
      billing_address_collection: "required",
      payment_method_options: {
        card: { request_three_d_secure: "automatic" },
      },
      customer_email: email,
      metadata: {
        beneficiaryName,
        childName: beneficiaryName,
        amount: BLIND_SPONSORSHIP_AMOUNT_CENTS.toString(),
        childLocation: "Flexible",
        userId: userId || null,
        paymentType,
        sponsorshipMode: "blind",
        blindLabel: BLIND_LABEL,
        region,
      },
      subscription_data: {
        metadata: {
          userId: userId || null,
          amount: BLIND_SPONSORSHIP_AMOUNT_CENTS.toString(),
          sponsorshipMode: "blind",
          blindLabel: BLIND_LABEL,
          beneficiaryName,
          region,
        },
      },
    }

    // Configure return URLs based on embedded mode
    if (isEmbedded) {
      sessionConfig.ui_mode = "embedded"
      sessionConfig.return_url = `${process.env.NEXT_PUBLIC_BASE_URL}/payments/success?embedded=true&session_id={CHECKOUT_SESSION_ID}&region=${region}`
    } else {
      sessionConfig.success_url = `${process.env.NEXT_PUBLIC_BASE_URL}/payments/success?session_id={CHECKOUT_SESSION_ID}&region=${region}`
      sessionConfig.cancel_url = `${process.env.NEXT_PUBLIC_BASE_URL}/payments/failed?session_id={CHECKOUT_SESSION_ID}&region=${region}`
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create(sessionConfig)

    return {
      success: true,
      url: session.url || undefined,
      clientSecret: session.client_secret || undefined,
      region,
      publishableKey: getPublishableKey(region),
    }
  } catch (error) {
    console.error("Blind sponsorship checkout error:", error)
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to create checkout session",
    }
  }
}

