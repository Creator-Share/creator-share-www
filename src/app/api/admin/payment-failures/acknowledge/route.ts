import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { requireSuperAdminRequest } from "@/utils/auth/requireSuperAdminRequest"
import { readBoundedSponsorManagementBody } from "@/lib/sponsorships/management/passwordlessAccess"

export async function POST(request: Request) {
  const response = (body: object, status: number) => NextResponse.json(body, {
    status, headers: { "Cache-Control": "no-store" },
  })
  try {
    const client = await createClient({ requestTimeoutMilliseconds: 15_000 })
    const auth = await requireSuperAdminRequest(client, request)
    if (!auth.ok) {
      auth.response.headers.set("Cache-Control", "no-store")
      return auth.response
    }
    let body: unknown
    try {
      const raw = await readBoundedSponsorManagementBody(request, 2048)
      body = raw === null ? null : JSON.parse(raw)
    } catch { body = null }
    if (!body || typeof body !== "object" || Array.isArray(body)) return response({ error: "Invalid acknowledgment." }, 400)
    const eventId = Reflect.get(body, "eventId")
    const version = Reflect.get(body, "failureVersion")
    const reason = Reflect.get(body, "reason")
    if (typeof eventId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventId) ||
        typeof version !== "string" || !/^[0-9a-f]{64}$/.test(version) ||
        !["investigating", "awaiting_provider", "awaiting_repair"].includes(reason)) {
      return response({ error: "Invalid acknowledgment." }, 400)
    }
    const { data, error } = await client.rpc("acknowledge_payment_failure", {
      target_event_id: eventId, expected_failure_version: version, reason_code: reason, request_id: randomUUID(),
    })
    if (error?.code === "40001") return response({ error: "This failure changed. Refresh before acknowledging it." }, 409)
    if (error) return response({ error: "Unable to acknowledge this failure." },
      ["42501", "28000"].includes(error.code) ? 403 : 503)
    if (data?.acknowledged !== true || data?.resolved !== false) return response({ error: "Unable to confirm acknowledgment. Refresh to check its status." }, 503)
    return response({ acknowledged: true, resolved: false }, 200)
  } catch {
    return response({ error: "Unable to confirm acknowledgment. Refresh to check its status." }, 503)
  }
}
