import { NextRequest, NextResponse } from "next/server"

import {
  buildSponsorAccountHistoryPage,
  parseSponsorAccountHistoryRequest,
  SponsorAccountHistoryRequestError,
} from "@/lib/sponsorships/sponsorAccountHistory"
import { createClient } from "@/utils/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function response(body: object, status: number) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      Pragma: "no-cache",
      "Referrer-Policy": "no-referrer",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
    },
  })
}

export async function GET(request: NextRequest) {
  const client = await createClient()
  const { data: authentication, error: authenticationError } =
    await client.auth.getUser()

  if (authenticationError || !authentication.user) {
    return response({ error: "unauthorized" }, 401)
  }

  let pageRequest
  try {
    pageRequest = parseSponsorAccountHistoryRequest(
      request.nextUrl.searchParams,
    )
  } catch (error) {
    if (error instanceof SponsorAccountHistoryRequestError) {
      return response({ error: "invalid_request" }, 400)
    }
    return response({ error: "unavailable" }, 503)
  }

  try {
    const { data, error } = await client.rpc(
      "list_my_one_time_sponsorship_history",
      {
        target_limit: pageRequest.rpcLimit,
        target_before_paid_at: pageRequest.beforePaidAt,
        target_before_sponsorship_intent_id:
          pageRequest.beforeSponsorshipIntentId,
      },
    )
    if (error) throw error

    return response(
      buildSponsorAccountHistoryPage(data, pageRequest.pageSize),
      200,
    )
  } catch {
    return response({ error: "unavailable" }, 503)
  }
}
