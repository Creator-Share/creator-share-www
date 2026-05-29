import { handleStripeWebhook } from "./handler"

// Force dynamic rendering to prevent body pre-processing
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  return handleStripeWebhook(req)
}
