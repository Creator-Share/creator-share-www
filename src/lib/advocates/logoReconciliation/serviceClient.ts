import "server-only"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import { createBoundedAdvocateLogoReconciliationFetch } from "./boundedFetch"

function serviceConfigurationError(): never {
  throw new Error("Advocate logo reconciliation worker is unavailable")
}

function loadServiceEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): { url: string; serviceRoleKey: string } {
  const rawUrl = environment.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = environment.NEXT_SERVICE_ROLE_KEY
  let url: URL
  try {
    url = new URL(rawUrl ?? "")
  } catch {
    serviceConfigurationError()
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username !== "" ||
    url.password !== "" ||
    typeof serviceRoleKey !== "string" ||
    serviceRoleKey.length < 32 ||
    serviceRoleKey.length > 4_096 ||
    serviceRoleKey !== serviceRoleKey.trim() ||
    /[\u0000-\u001f\u007f\s]/.test(serviceRoleKey)
  ) {
    serviceConfigurationError()
  }
  return { url: url.toString(), serviceRoleKey }
}

export function createAdvocateLogoReconciliationServiceClient(options: {
  requestTimeoutMilliseconds: number
  invocationDeadlineAt: number
  environment?: Readonly<Record<string, string | undefined>>
  now?: () => number
  fetchImplementation?: typeof fetch
}): SupabaseClient {
  const { url, serviceRoleKey } = loadServiceEnvironment(
    options.environment ?? process.env,
  )
  const boundedFetch = createBoundedAdvocateLogoReconciliationFetch({
    requestTimeoutMilliseconds: options.requestTimeoutMilliseconds,
    invocationDeadlineAt: options.invocationDeadlineAt,
    now: options.now,
    fetchImplementation: options.fetchImplementation,
  })

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: { fetch: boundedFetch },
  })
}
