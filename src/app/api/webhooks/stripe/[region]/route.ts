import { NextResponse } from "next/server"
import { isValidRegion } from "@/lib/stripe/config"
import { handleStripeWebhook } from "../handler"

// Force dynamic rendering to prevent body pre-processing
export const dynamic = "force-dynamic"

export async function POST(
  req: Request,
  { params }: { params: Promise<{ region: string }> },
) {
  const { region } = await params
  if (!isValidRegion(region)) {
    return NextResponse.json(
      { error: `Unknown Stripe region: ${region}` },
      { status: 404 },
    )
  }
  return handleStripeWebhook(req, region)
}
