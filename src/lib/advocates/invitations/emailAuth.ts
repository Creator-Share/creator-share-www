import "server-only"

import {
  issueAdvocateInvitationEmailProof,
  type AdvocateInvitationEmailProofOptions,
  type AdvocateInvitationEmailProofResult,
} from "@/lib/auth/supabaseEmailProofIssuer"

export interface AdvocateInvitationAuthProvider {
  issueEmailProof(
    options: AdvocateInvitationEmailProofOptions,
  ): Promise<AdvocateInvitationEmailProofResult>
}

export function createSharedAdvocateInvitationAuthProvider(
  issuer: (
    options: AdvocateInvitationEmailProofOptions,
  ) => Promise<AdvocateInvitationEmailProofResult> = issueAdvocateInvitationEmailProof,
): AdvocateInvitationAuthProvider {
  return Object.freeze({ issueEmailProof: issuer })
}
