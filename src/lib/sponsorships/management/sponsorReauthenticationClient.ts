export const SPONSOR_REAUTHENTICATION_PATH = "/api/sponsor-account/reauth/start"
export const RECENT_VERIFICATION_REQUIRED =
  "recent-verification-required" as const

export type SponsorReauthenticationAction =
  "cancel-sponsorship" | "update-payment-method"

type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  return (
    Object.keys(value).sort().join("\0") === [...expectedKeys].sort().join("\0")
  )
}

export function isRecentVerificationRequiredResponse(
  status: number,
  body: unknown,
): boolean {
  return (
    status === 428 &&
    isRecord(body) &&
    hasExactKeys(body, ["error"]) &&
    body.error === RECENT_VERIFICATION_REQUIRED
  )
}

export async function requestFreshSponsorAuthentication(
  fetchImplementation: FetchImplementation = globalThis.fetch,
): Promise<boolean> {
  try {
    const response = await fetchImplementation(SPONSOR_REAUTHENTICATION_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
    })
    if (response.status !== 202) return false

    const body = (await response.json().catch(() => null)) as unknown
    return (
      isRecord(body) &&
      hasExactKeys(body, ["status"]) &&
      body.status === "check-email"
    )
  } catch {
    return false
  }
}

export function sponsorReauthenticationMessage(
  action: SponsorReauthenticationAction,
  requestAccepted: boolean,
): string {
  if (!requestAccepted) {
    return "We could not start secure verification. Please try again shortly."
  }

  if (action === "cancel-sponsorship") {
    return "Check your email for a secure sign-in link. After the link returns you to Creator Share, open this sponsorship and confirm cancellation again. No cancellation has been submitted yet."
  }

  return "Check your email for a secure sign-in link. After the link returns you to Creator Share, select Payment Method again."
}
