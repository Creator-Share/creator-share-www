"use client"

import { createClient } from "@/utils/supabase/client"
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js"

type ChangeCallback = (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => void

// Module-level singletons — created once, shared across all consumers
let supabaseInstance: ReturnType<typeof createClient> | null = null
let channelInstance: ReturnType<ReturnType<typeof createClient>["channel"]> | null = null
const listenerMap = new Map<string, ChangeCallback>()
let subscriberCount = 0

function getSupabase() {
  if (!supabaseInstance) supabaseInstance = createClient()
  return supabaseInstance
}

function getChannel() {
  if (channelInstance) return channelInstance
  const supabase = getSupabase()
  channelInstance = supabase
    .channel("shared_subscriptions_rt")
    .on(
      "postgres_changes",
      { schema: "public", table: "subscriptions", event: "*" },
      (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
        listenerMap.forEach((cb) => cb(payload))
      },
    )
    .subscribe()
  return channelInstance
}

/**
 * Subscribe to `public.subscriptions` realtime changes.
 * Returns an unsubscribe function. Safe to call from any number of
 * components/hooks — the underlying channel is created once and shared.
 */
export function subscribeToSubscriptions(id: string, handler: ChangeCallback): () => void {
  listenerMap.set(id, handler)
  subscriberCount++
  if (subscriberCount === 1) getChannel()

  return () => {
    listenerMap.delete(id)
    subscriberCount--
    if (subscriberCount === 0 && channelInstance) {
      getSupabase().removeChannel(channelInstance)
      channelInstance = null
    }
  }
}
