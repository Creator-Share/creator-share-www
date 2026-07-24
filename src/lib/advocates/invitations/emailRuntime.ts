import "server-only"

import { createSponsorshipCryptoFromEnvironment } from "@/lib/sponsorships/crypto"
import { assertAdvocateStagingEmailRecipientAllowed } from "@/lib/stagingOutboundEmail"
import { createServiceRoleClient } from "@/utils/supabase/server"

import { createSharedAdvocateInvitationAuthProvider } from "./emailAuth"
import {
  loadAdvocateInvitationEmailCanonicalOrigin,
  loadAdvocateInvitationEmailTransportConfig,
  type AdvocateInvitationEmailEnvironment,
} from "./emailConfig"
import { createSupabaseAdvocateInvitationEmailRepository } from "./emailRepository"
import { createNodemailerAdvocateInvitationEmailTransport } from "./emailTransport"
import type {
  AdvocateInvitationEmailWorkerConfig,
  AdvocateInvitationEmailWorkerDependencies,
} from "./emailWorker"

export function createAdvocateInvitationEmailWorkerDependencies(options: {
  config: AdvocateInvitationEmailWorkerConfig
  environment?: AdvocateInvitationEmailEnvironment
}): AdvocateInvitationEmailWorkerDependencies {
  const environment = options.environment ?? process.env
  const transportConfig =
    loadAdvocateInvitationEmailTransportConfig(environment)
  const stagingRecipientPolicy = transportConfig.stagingRecipientPolicy
  const serviceClient = createServiceRoleClient({
    requestTimeoutMilliseconds:
      options.config.serviceRequestTimeoutMilliseconds,
  })
  return {
    repository: createSupabaseAdvocateInvitationEmailRepository(serviceClient),
    authProvider: createSharedAdvocateInvitationAuthProvider(),
    transport:
      createNodemailerAdvocateInvitationEmailTransport(transportConfig),
    crypto: createSponsorshipCryptoFromEnvironment(environment),
    canonicalOrigin: loadAdvocateInvitationEmailCanonicalOrigin(environment),
    ...(stagingRecipientPolicy === undefined
      ? {}
      : {
          assertRecipientAllowed(recipientEmail: string) {
            assertAdvocateStagingEmailRecipientAllowed(
              recipientEmail,
              stagingRecipientPolicy,
            )
          },
        }),
  }
}
