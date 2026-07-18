export interface SponsorClaimFragmentPayload {
  token: string
  email: string
}

const MAXIMUM_FRAGMENT_LENGTH = 2048

/**
 * Parses private welcome-link data from a URL fragment. Validation remains a
 * server responsibility. This boundary only prevents duplicate or oversized
 * values from reaching the API.
 */
export function parseSponsorClaimFragment(
  fragment: string,
): SponsorClaimFragmentPayload | null {
  if (
    typeof fragment !== "string" ||
    fragment.length < 2 ||
    fragment.length > MAXIMUM_FRAGMENT_LENGTH
  ) {
    return null
  }

  const params = new URLSearchParams(
    fragment.startsWith("#") ? fragment.slice(1) : fragment,
  )
  const tokens = params.getAll("token")
  const emails = params.getAll("email")
  if (tokens.length !== 1 || emails.length !== 1) return null
  if (!tokens[0] || !emails[0]) return null

  return { token: tokens[0], email: emails[0] }
}
