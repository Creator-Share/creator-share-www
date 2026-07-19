import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { normalizeSponsorEmailV1 } from "@/lib/sponsorships/crypto"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const HASHED_TOKEN_PATTERN = /^[A-Za-z0-9._~-]{32,384}$/

export interface AdvocateInvitationAuthProof {
  userId: string
  hashedToken: string
}

export interface AdvocateInvitationAuthProvider {
  generateMagicLink(options: {
    recipientEmail: string
    redirectTo: string
    createUserIfMissing: true
  }): Promise<AdvocateInvitationAuthProof>
}

export class AdvocateInvitationAuthProviderError extends Error {
  readonly targetUnavailable: boolean

  constructor(options: { targetUnavailable?: boolean } = {}) {
    super("advocate_invitation_auth_link_failed")
    this.name = "AdvocateInvitationAuthProviderError"
    this.targetUnavailable = options.targetUnavailable === true
  }
}

function providerError(options?: { targetUnavailable?: boolean }): never {
  throw new AdvocateInvitationAuthProviderError(options)
}

export function createSupabaseAdvocateInvitationAuthProvider(
  client: SupabaseClient,
): AdvocateInvitationAuthProvider {
  return {
    async generateMagicLink(options) {
      if (options.createUserIfMissing !== true) providerError()

      let normalizedEmail: string
      let redirect: URL
      try {
        normalizedEmail = normalizeSponsorEmailV1(options.recipientEmail)
        redirect = new URL(options.redirectTo)
      } catch {
        providerError()
      }
      if (
        redirect.protocol !== "https:" ||
        redirect.hostname !== "creatorshare.com" ||
        redirect.port !== "" ||
        redirect.pathname !== "/advocate-invitation" ||
        redirect.search !== "" ||
        redirect.hash !== "" ||
        redirect.username !== "" ||
        redirect.password !== ""
      ) {
        providerError()
      }

      let response: Awaited<ReturnType<typeof client.auth.admin.generateLink>>
      try {
        response = await client.auth.admin.generateLink({
          type: "magiclink",
          email: normalizedEmail,
          options: { redirectTo: redirect.toString() },
        })
      } catch {
        providerError()
      }
      const { data, error } = response
      if (error || !data) providerError()

      let returnedEmail: string
      try {
        returnedEmail = normalizeSponsorEmailV1(data.user.email ?? "")
      } catch {
        providerError({ targetUnavailable: true })
      }
      if (
        returnedEmail !== normalizedEmail ||
        !UUID_PATTERN.test(data.user.id) ||
        data.properties.verification_type !== "magiclink" ||
        !HASHED_TOKEN_PATTERN.test(data.properties.hashed_token)
      ) {
        providerError({ targetUnavailable: true })
      }

      return Object.freeze({
        userId: data.user.id,
        hashedToken: data.properties.hashed_token,
      })
    },
  }
}
