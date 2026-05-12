"use client"

import { createClient } from "@/utils/supabase/client"
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js"

type ChangeCallback = (
  payload: RealtimePostgresChangesPayload<Record<string, unknown>>,
) => void

/**
 * Module-level singletons. Created lazily on first subscriber, torn down
 * after the last subscriber leaves (with a short grace period so that
 * Strict Mode double-mounts and route transitions don't churn the WebSocket).
 *
 * NOTE on HMR: in dev, hot reload can leave these in inconsistent states
 * across module reloads. If you see phantom listeners or missing channels
 * after editing this file, hard-refresh the browser.
 */
let supabaseInstance: ReturnType<typeof createClient> | null = null
let channelInstance: ReturnType<
  ReturnType<typeof createClient>["channel"]
> | null = null
const listenerMap = new Map<string, Set<ChangeCallback>>()

const TEARDOWN_GRACE_MS = 200
let teardownTimer: ReturnType<typeof setTimeout> | null = null

function envIsConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  )
}

function getSupabase() {
  if (!supabaseInstance) supabaseInstance = createClient()
  return supabaseInstance
}

function openChannel() {
  if (channelInstance) return channelInstance
  channelInstance = getSupabase()
    .channel("shared_subscriptions_rt")
    .on(
      "postgres_changes",
      { schema: "public", table: "subscriptions", event: "*" },
      (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
        listenerMap.forEach((handlers) => handlers.forEach((cb) => cb(payload)))
      },
    )
    .subscribe((status, err) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.warn(
          `[subscriptionsRealtime] channel ${status}`,
          err ?? "",
        )
      }
    })
  return channelInstance
}

function closeChannel() {
  if (!channelInstance) return
  if (supabaseInstance) supabaseInstance.removeChannel(channelInstance)
  channelInstance = null
}

function totalSubscribers(): number {
  let total = 0
  listenerMap.forEach((set) => {
    total += set.size
  })
  return total
}

/**
 * Subscribe to `public.subscriptions` realtime changes.
 *
 * `id` is a logical identity (e.g. "beneficiary-pagination") used so multiple
 * instances of the same hook can register without colliding. Multiple handlers
 * can register under the same id; each unsubscribe removes only its own handler.
 *
 * Returns an unsubscribe function. The underlying channel is created on first
 * subscriber and torn down ~200ms after the last subscriber leaves, so a fast
 * resubscribe (e.g. Strict Mode double-mount or route transition) re-uses
 * the existing connection.
 */
export function subscribeToSubscriptions(
  id: string,
  handler: ChangeCallback,
): () => void {
  if (!envIsConfigured()) {
    console.warn(
      "[subscriptionsRealtime] Supabase env missing; realtime disabled",
    )
    return () => {}
  }

  if (teardownTimer) {
    clearTimeout(teardownTimer)
    teardownTimer = null
  }

  let handlers = listenerMap.get(id)
  if (!handlers) {
    handlers = new Set()
    listenerMap.set(id, handlers)
  }
  handlers.add(handler)

  if (totalSubscribers() === 1) openChannel()

  return () => {
    const set = listenerMap.get(id)
    if (set) {
      set.delete(handler)
      if (set.size === 0) listenerMap.delete(id)
    }

    if (totalSubscribers() === 0 && channelInstance) {
      if (teardownTimer) clearTimeout(teardownTimer)
      teardownTimer = setTimeout(() => {
        teardownTimer = null
        if (totalSubscribers() === 0) closeChannel()
      }, TEARDOWN_GRACE_MS)
    }
  }
}
