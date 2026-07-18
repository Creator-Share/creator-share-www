import "server-only"

import { createSponsorshipCryptoFromEnvironment } from "@/lib/sponsorships/crypto"
import {
  loadSponsorWelcomeEmailCanonicalOrigin,
  loadSponsorWelcomeEmailTransportConfig,
} from "@/lib/sponsorships/email/sponsorWelcomeEmailConfig"
import { createSupabaseSponsorWelcomeEmailRepository } from "@/lib/sponsorships/email/sponsorWelcomeEmailRepository"
import { createNodemailerSponsorWelcomeEmailTransport } from "@/lib/sponsorships/email/sponsorWelcomeEmailTransport"
import {
  runSponsorWelcomeEmailBatch,
  type SponsorWelcomeEmailBatchResult,
  type SponsorWelcomeEmailWorkerConfig,
  type SponsorWelcomeEmailWorkerContext,
} from "@/lib/sponsorships/email/sponsorWelcomeEmailWorker"
import { createServiceRoleClient } from "@/utils/supabase/server"

export async function runSponsorWelcomeEmailBatchFromEnvironment(options: {
  config: SponsorWelcomeEmailWorkerConfig
  workerId: string
  context: SponsorWelcomeEmailWorkerContext
  invocationDeadlineAt: number
}): Promise<SponsorWelcomeEmailBatchResult> {
  const crypto = createSponsorshipCryptoFromEnvironment()
  const dependencies = {
    repository: createSupabaseSponsorWelcomeEmailRepository(
      createServiceRoleClient(),
    ),
    transport: createNodemailerSponsorWelcomeEmailTransport(
      loadSponsorWelcomeEmailTransportConfig(),
    ),
    crypto,
    canonicalOrigin: loadSponsorWelcomeEmailCanonicalOrigin(),
    invocationDeadlineAt: options.invocationDeadlineAt,
  }
  return runSponsorWelcomeEmailBatch({ dependencies, ...options })
}
