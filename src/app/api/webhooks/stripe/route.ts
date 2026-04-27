import { STRIPE_DEFAULT_REGION } from "@/lib/stripe/config"
import { handleStripeWebhook } from "./handler"

// Force dynamic rendering to prevent body pre-processing
export const dynamic = "force-dynamic"

// Backward-compat endpoint for Stripe dashboards still configured to post here.
// New configs should target /api/webhooks/stripe/{region}.
export async function POST(req: Request) {
  return handleStripeWebhook(req, STRIPE_DEFAULT_REGION)
}
