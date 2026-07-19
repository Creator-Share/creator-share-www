import { createServerClient, type CookieOptions } from "@supabase/ssr"
import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import { cookies } from "next/headers"

const MIN_SERVICE_ROLE_REQUEST_TIMEOUT_MILLISECONDS = 1_000
const MAX_SERVICE_ROLE_REQUEST_TIMEOUT_MILLISECONDS = 45_000

export type ServiceRoleClientOptions = {
  requestTimeoutMilliseconds?: number
}

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(
          cookiesToSet: {
            name: string
            value: string
            options?: CookieOptions
          }[],
        ) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    },
  )
}

function assertServiceRoleRequestTimeout(
  requestTimeoutMilliseconds: number,
): void {
  if (
    !Number.isSafeInteger(requestTimeoutMilliseconds) ||
    requestTimeoutMilliseconds <
      MIN_SERVICE_ROLE_REQUEST_TIMEOUT_MILLISECONDS ||
    requestTimeoutMilliseconds > MAX_SERVICE_ROLE_REQUEST_TIMEOUT_MILLISECONDS
  ) {
    throw new RangeError(
      `Service role request timeout must be an integer between ${MIN_SERVICE_ROLE_REQUEST_TIMEOUT_MILLISECONDS} and ${MAX_SERVICE_ROLE_REQUEST_TIMEOUT_MILLISECONDS} milliseconds`,
    )
  }
}

export function createAbortingServiceRoleFetch(
  requestTimeoutMilliseconds: number,
  fetchImplementation: typeof fetch = globalThis.fetch,
): typeof fetch {
  assertServiceRoleRequestTimeout(requestTimeoutMilliseconds)

  return (input, init) => {
    const timeoutSignal = AbortSignal.timeout(requestTimeoutMilliseconds)
    const signal = init?.signal
      ? AbortSignal.any([init.signal, timeoutSignal])
      : timeoutSignal

    return fetchImplementation(input, { ...init, signal })
  }
}

// Service role client for admin operations
export function createServiceRoleClient(
  options: ServiceRoleClientOptions = {},
) {
  const global =
    options.requestTimeoutMilliseconds === undefined
      ? undefined
      : {
          fetch: createAbortingServiceRoleFetch(
            options.requestTimeoutMilliseconds,
          ),
        }

  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      ...(global === undefined ? {} : { global }),
    },
  )
}
