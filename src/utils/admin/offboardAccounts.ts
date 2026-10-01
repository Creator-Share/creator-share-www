import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function offboardAccounts(supabase: SupabaseClient, suppliedIds: unknown) {
  const response = (body: object, status = 200) => NextResponse.json(body, {
    status, headers: { "Cache-Control": "no-store" },
  })
  if (!Array.isArray(suppliedIds) || suppliedIds.length === 0 || suppliedIds.length > 500 ||
      suppliedIds.some(id => typeof id !== "string" || !UUID_PATTERN.test(id))) {
    return response({ error: "Provide between 1 and 500 valid account IDs" }, 400)
  }
  const ids = [...new Set((suppliedIds as string[]).map(id => id.toLowerCase()))]
  try {
    const { data, error } = await supabase.rpc("offboard_creator_share_accounts", {
      target_user_ids: ids, request_id: crypto.randomUUID(),
    })
    if (error) {
      if (error.code === "55000") return response({ error: "Transfer Advocate ownership before disabling these accounts." }, 409)
      if (error.code === "23514") return response({ error: "You cannot disable your own account." }, 409)
      if (error.code === "23503") return response({ error: "A selected account no longer exists." }, 409)
      return response({ error: "Unable to disable account access." },
        ["42501", "28000"].includes(error.code) ? 403 : 503)
    }
    if (data?.disabled_count !== ids.length) return response({ error: "Unable to confirm account disablement." }, 503)
    return response({ success: true, disabled_count: ids.length })
  } catch {
    return response({ error: "Unable to confirm account disablement." }, 503)
  }
}
