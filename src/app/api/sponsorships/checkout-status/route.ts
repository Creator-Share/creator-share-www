import { NextResponse } from "next/server"

import {
  isTrustedCheckoutJsonRequest,
  resolveTrustedCheckoutRequestOrigin,
} from "@/lib/sponsorships/checkout/requestSecurity"
import {
  parseCheckoutStatusBody,
  readPublicCheckoutStatus,
  type CheckoutStatusRecord,
} from "@/lib/sponsorships/checkout/status"
import { createSponsorshipCryptoFromEnvironment } from "@/lib/sponsorships/crypto"
import { createServiceRoleClient } from "@/utils/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAXIMUM_STATUS_BODY_BYTES = 1024

function response(
  body: Record<string, unknown>,
  status = 200,
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  })
}

async function readBoundedBody(request: Request): Promise<string | null> {
  const contentLength = request.headers.get("content-length")
  if (
    contentLength !== null &&
    (!/^\d+$/.test(contentLength) ||
      Number(contentLength) > MAXIMUM_STATUS_BODY_BYTES)
  ) {
    return null
  }

  try {
    const body = await request.text()
    return Buffer.byteLength(body, "utf8") <= MAXIMUM_STATUS_BODY_BYTES
      ? body
      : null
  } catch {
    return null
  }
}

export async function POST(request: Request) {
  const expectedOrigin = resolveTrustedCheckoutRequestOrigin({
    rawHost: request.headers.get("host"),
  })
  if (
    !expectedOrigin ||
    !isTrustedCheckoutJsonRequest(request.headers, expectedOrigin)
  ) {
    return response({ status: "unknown", terminal: false }, 400)
  }

  const rawBody = await readBoundedBody(request)
  const receipt = rawBody === null ? null : parseCheckoutStatusBody(rawBody)
  if (!receipt) return response({ status: "unknown", terminal: false }, 400)

  try {
    const supabase = createServiceRoleClient()
    const status = await readPublicCheckoutStatus({
      receipt,
      crypto: createSponsorshipCryptoFromEnvironment(),
      repository: {
        async readByReceiptDigest(digest) {
          const { data, error } = await supabase.rpc(
            "read_sponsorship_checkout_status",
            { target_checkout_receipt_digest: digest },
          )
          if (error) throw new Error("Checkout status lookup failed")
          if (!Array.isArray(data) || data.length === 0) return null
          if (data.length !== 1) {
            throw new Error("Checkout status lookup was ambiguous")
          }
          return data[0] as CheckoutStatusRecord
        },
      },
    })
    return response({ ...status })
  } catch {
    return response({ status: "unknown", terminal: false }, 503)
  }
}
