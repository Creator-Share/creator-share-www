export type AdvocateAttributionIdentityCompletionFetch = (
  input: string,
  init: RequestInit,
) => Promise<Pick<Response, "ok">>

/**
 * Completes a client-created Supabase session on the primary application
 * origin so the server can issue its separate, HttpOnly attribution exclusion
 * signal. The response contains no identity material.
 */
export async function completeAdvocateAttributionIdentitySignal(
  fetcher: AdvocateAttributionIdentityCompletionFetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetcher("/api/auth/attribution-identity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
    })
    return response.ok
  } catch {
    return false
  }
}
