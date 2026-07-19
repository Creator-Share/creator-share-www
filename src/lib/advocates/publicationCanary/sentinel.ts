import "server-only"

import type { DomainProviderAdapterFactory } from "../provisioning/adapters"
import {
  DomainProvisioningError,
  type ClaimedDomainProvisioningJob,
  type DomainProviderAdapter,
  type DomainProvisioningContext,
  type ProviderReconciliation,
  type SupportedDomainProvider,
} from "../provisioning/types"
import { PUBLICATION_CANARY_SENTINEL_HOSTNAME } from "./topology"

export { PUBLICATION_CANARY_SENTINEL_HOSTNAME } from "./topology"

const SENTINEL_ADVOCATE_ID = "00000000-0000-4000-8000-0000000000a1"
const SENTINEL_DOMAIN_ID = "00000000-0000-4000-8000-0000000000d1"
const SENTINEL_INTEGRATION_IDS = Object.freeze({
  cloudflare: "00000000-0000-4000-8000-0000000000c1",
  vercel: "00000000-0000-4000-8000-0000000000e1",
} satisfies Record<SupportedDomainProvider, string>)

export interface PublicationCanarySentinelReadiness {
  hostname: typeof PUBLICATION_CANARY_SENTINEL_HOSTNAME
  cloudflareReady: boolean
  vercelReady: boolean
}

export const PUBLICATION_CANARY_SENTINEL_STAGES = Object.freeze([
  "cloudflare_lookup",
  "cloudflare_apply",
  "cloudflare_verify",
  "vercel_lookup",
  "vercel_apply",
  "vercel_verify",
  "dns",
  "tls",
  "https",
  "complete",
] as const)

export const PUBLICATION_CANARY_SENTINEL_OUTCOME_CODES = Object.freeze([
  "ready",
  "not_found",
  "needs_apply",
  "apply_accepted",
  "provider_unavailable",
  "ownership_conflict",
  "blocked",
  "not_ready",
  "unexpected_response",
  "converging",
  "failed",
] as const)

export type PublicationCanarySentinelStage =
  (typeof PUBLICATION_CANARY_SENTINEL_STAGES)[number]
export type PublicationCanarySentinelOutcomeCode =
  (typeof PUBLICATION_CANARY_SENTINEL_OUTCOME_CODES)[number]

export const PUBLICATION_CANARY_SENTINEL_STAGE_OUTCOME_CODES = Object.freeze({
  cloudflare_lookup: Object.freeze([
    "ready",
    "not_found",
    "needs_apply",
    "provider_unavailable",
    "ownership_conflict",
  ]),
  cloudflare_apply: Object.freeze(["apply_accepted", "provider_unavailable"]),
  cloudflare_verify: Object.freeze([
    "ready",
    "not_ready",
    "provider_unavailable",
    "ownership_conflict",
    "failed",
  ]),
  vercel_lookup: Object.freeze([
    "ready",
    "not_found",
    "needs_apply",
    "provider_unavailable",
    "ownership_conflict",
    "blocked",
  ]),
  vercel_apply: Object.freeze(["apply_accepted", "provider_unavailable"]),
  vercel_verify: Object.freeze([
    "ready",
    "not_ready",
    "provider_unavailable",
    "ownership_conflict",
    "failed",
  ]),
  dns: Object.freeze(["ready", "not_ready"]),
  tls: Object.freeze(["ready", "not_ready"]),
  https: Object.freeze(["ready", "not_ready", "unexpected_response"]),
  complete: Object.freeze(["ready", "converging", "failed"]),
} as const satisfies Record<
  PublicationCanarySentinelStage,
  readonly PublicationCanarySentinelOutcomeCode[]
>)

export function publicationCanarySentinelEventIsValid(
  stage: PublicationCanarySentinelStage,
  outcomeCode: PublicationCanarySentinelOutcomeCode,
): boolean {
  return (
    PUBLICATION_CANARY_SENTINEL_STAGE_OUTCOME_CODES[
      stage
    ] as readonly PublicationCanarySentinelOutcomeCode[]
  ).includes(outcomeCode)
}

export interface PublicationCanarySentinelOperationalEvent {
  sequence: number
  stage: PublicationCanarySentinelStage
  outcome_code: PublicationCanarySentinelOutcomeCode
}

export interface PublicationCanarySentinelProviderReconciliation {
  readiness: PublicationCanarySentinelReadiness
  events: readonly PublicationCanarySentinelOperationalEvent[]
  outcome: "ready" | "converging" | "failed"
}

type ProviderOutcome = "ready" | "converging" | "failed"

interface ProviderResult {
  ready: boolean
  outcome: ProviderOutcome
}

type RecordOperationalEvent = (
  stage: PublicationCanarySentinelStage,
  outcomeCode: PublicationCanarySentinelOutcomeCode,
) => void

const TERMINAL_SENTINEL_PROVIDER_ERROR_CODES = new Set([
  "cloudflare_invalid_response",
  "provider_response_too_large",
  "vercel_invalid_response",
  "vercel_verification_identity_mismatch",
])

function providerFailureOutcome(error: unknown): ProviderOutcome {
  if (!(error instanceof DomainProvisioningError) || !error.retryable) {
    return "failed"
  }

  // A retryable tenant provisioning error is not automatically harmless to
  // the shared publication sentinel. Reachable malformed responses and
  // ambiguous resource identity must stop publication immediately, even if
  // the background tenant worker may make another bounded attempt later.
  return TERMINAL_SENTINEL_PROVIDER_ERROR_CODES.has(error.code)
    ? "failed"
    : "converging"
}

function sentinelJob(
  provider: SupportedDomainProvider,
): ClaimedDomainProvisioningJob {
  return Object.freeze({
    jobId:
      provider === "cloudflare"
        ? "00000000-0000-4000-8000-0000000000c2"
        : "00000000-0000-4000-8000-0000000000e2",
    advocateId: SENTINEL_ADVOCATE_ID,
    domainId: SENTINEL_DOMAIN_ID,
    integrationId: SENTINEL_INTEGRATION_IDS[provider],
    kind: "provision" as const,
    provider,
    attemptCount: 1,
    maxAttempts: 1,
    providerIdempotencyKey: `publication-sentinel:${provider}:v1`,
    requestPayload: Object.freeze({
      schema_version: 1 as const,
      reconciliation_policy: "lookup_before_mutation" as const,
    }),
    leaseToken:
      provider === "cloudflare"
        ? "00000000-0000-4000-8000-0000000000c3"
        : "00000000-0000-4000-8000-0000000000e3",
    leaseExpiresAt: "9999-12-31T23:59:59.999Z",
    reconciliationRequired: true,
  })
}

function sentinelContext(
  provider: SupportedDomainProvider,
): DomainProvisioningContext {
  return Object.freeze({
    advocateId: SENTINEL_ADVOCATE_ID,
    advocateRelationshipStatus: "active",
    advocatePublicationStatus: "provisioning",
    domainId: SENTINEL_DOMAIN_ID,
    hostname: PUBLICATION_CANARY_SENTINEL_HOSTNAME,
    domainStatus: "verifying",
    integrationId: SENTINEL_INTEGRATION_IDS[provider],
    integrationProvider: provider,
    integrationIsRequired: true,
    integrationStatus: "pending",
    integrationExternalIdentifier: null,
  })
}

function hasOwnedResourceIdentity(
  reconciliation: ProviderReconciliation,
): boolean {
  return (
    reconciliation.ownedResource === true &&
    typeof reconciliation.resourceId === "string" &&
    reconciliation.resourceId.trim().length > 0
  )
}

function isReady(reconciliation: ProviderReconciliation): boolean {
  return (
    reconciliation.outcome === "matches_intent" &&
    reconciliation.desiredStateVerified === true &&
    hasOwnedResourceIdentity(reconciliation)
  )
}

async function reconcileProvider(
  adapter: DomainProviderAdapter,
  provider: SupportedDomainProvider,
  recordEvent: RecordOperationalEvent,
): Promise<ProviderResult> {
  const lookupStage = `${provider}_lookup` as PublicationCanarySentinelStage
  const applyStage = `${provider}_apply` as PublicationCanarySentinelStage
  const verifyStage = `${provider}_verify` as PublicationCanarySentinelStage
  if (adapter.provider !== provider) {
    recordEvent(lookupStage, "ownership_conflict")
    return { ready: false, outcome: "failed" }
  }

  const job = sentinelJob(provider)
  const context = sentinelContext(provider)
  let reconciliation: ProviderReconciliation
  try {
    reconciliation = await adapter.reconcile(job, context)
  } catch (error) {
    recordEvent(lookupStage, "provider_unavailable")
    return { ready: false, outcome: providerFailureOutcome(error) }
  }
  if (isReady(reconciliation)) {
    recordEvent(lookupStage, "ready")
    return { ready: true, outcome: "ready" }
  }
  const canCreate =
    reconciliation.outcome === "not_found" &&
    reconciliation.desiredStateVerified === false &&
    reconciliation.resourceId === undefined &&
    reconciliation.ownedResource === undefined
  const canRepair =
    reconciliation.outcome === "needs_apply" &&
    reconciliation.desiredStateVerified === false &&
    hasOwnedResourceIdentity(reconciliation)
  if (!canCreate && !canRepair) {
    recordEvent(lookupStage, "ownership_conflict")
    return { ready: false, outcome: "failed" }
  }
  recordEvent(lookupStage, canCreate ? "not_found" : "needs_apply")

  let applyFailure: ProviderOutcome | null = null
  try {
    await adapter.apply(job, context, reconciliation)
    recordEvent(applyStage, "apply_accepted")
  } catch (error) {
    // A concurrent reconciler can win the provider create race. The exact
    // lookup below is authoritative and never treats the mutation response as
    // readiness evidence.
    applyFailure = providerFailureOutcome(error)
    recordEvent(applyStage, "provider_unavailable")
  }

  try {
    const verified = await adapter.reconcile(job, context)
    if (isReady(verified)) {
      const terminalApplyFailure = applyFailure === "failed"
      recordEvent(verifyStage, terminalApplyFailure ? "failed" : "ready")
      return terminalApplyFailure
        ? { ready: false, outcome: "failed" }
        : { ready: true, outcome: "ready" }
    }
    const safelyConverging =
      (verified.outcome === "not_found" &&
        verified.desiredStateVerified === false &&
        verified.resourceId === undefined &&
        verified.ownedResource === undefined) ||
      (verified.outcome === "needs_apply" &&
        verified.desiredStateVerified === false &&
        hasOwnedResourceIdentity(verified)) ||
      (verified.outcome === "matches_intent" &&
        verified.desiredStateVerified === false &&
        hasOwnedResourceIdentity(verified))
    recordEvent(
      verifyStage,
      safelyConverging ? "not_ready" : "ownership_conflict",
    )
    return {
      ready: false,
      outcome:
        safelyConverging && applyFailure !== "failed" ? "converging" : "failed",
    }
  } catch (error) {
    recordEvent(verifyStage, "provider_unavailable")
    return {
      ready: false,
      outcome:
        applyFailure === "failed" ? "failed" : providerFailureOutcome(error),
    }
  }
}

async function reconcileConfiguredProvider(
  createAdapter: DomainProviderAdapterFactory,
  provider: SupportedDomainProvider,
  recordEvent: RecordOperationalEvent,
): Promise<ProviderResult> {
  try {
    return await reconcileProvider(
      createAdapter(provider),
      provider,
      recordEvent,
    )
  } catch (error) {
    recordEvent(
      `${provider}_lookup` as PublicationCanarySentinelStage,
      "provider_unavailable",
    )
    return { ready: false, outcome: providerFailureOutcome(error) }
  }
}

function aggregateProviderOutcome(
  cloudflare: ProviderResult,
  vercel: ProviderResult,
): "ready" | "converging" | "failed" {
  if (cloudflare.ready && vercel.ready) return "ready"
  if (cloudflare.outcome === "failed" || vercel.outcome === "failed") {
    return "failed"
  }
  return "converging"
}

export async function reconcilePublicationCanarySentinelProviders(
  createAdapter: DomainProviderAdapterFactory,
): Promise<PublicationCanarySentinelProviderReconciliation> {
  const events: PublicationCanarySentinelOperationalEvent[] = []
  const recordEvent: RecordOperationalEvent = (stage, outcomeCode) => {
    if (!publicationCanarySentinelEventIsValid(stage, outcomeCode)) {
      throw new Error("advocate_publication_sentinel_event_invalid")
    }
    events.push({ sequence: events.length, stage, outcome_code: outcomeCode })
  }
  const cloudflare = await reconcileConfiguredProvider(
    createAdapter,
    "cloudflare",
    recordEvent,
  )
  const vercel = cloudflare.ready
    ? await reconcileConfiguredProvider(createAdapter, "vercel", recordEvent)
    : (() => {
        recordEvent("vercel_lookup", "blocked")
        return {
          ready: false,
          outcome: cloudflare.outcome === "failed" ? "failed" : "converging",
        } satisfies ProviderResult
      })()

  return Object.freeze({
    readiness: Object.freeze({
      hostname: PUBLICATION_CANARY_SENTINEL_HOSTNAME,
      cloudflareReady: cloudflare.ready,
      vercelReady: vercel.ready,
    }),
    events: Object.freeze(events.map((event) => Object.freeze(event))),
    outcome: aggregateProviderOutcome(cloudflare, vercel),
  })
}

async function inspectConfiguredProvider(
  createAdapter: DomainProviderAdapterFactory,
  provider: SupportedDomainProvider,
): Promise<boolean> {
  try {
    const adapter = createAdapter(provider)
    if (adapter.provider !== provider) return false
    return isReady(
      await adapter.reconcile(sentinelJob(provider), sentinelContext(provider)),
    )
  } catch {
    return false
  }
}

/**
 * Read-only terminal provider inspection. Unlike bootstrap reconciliation it
 * never calls apply, so the final publication proof cannot create or repair
 * the infrastructure it is asserting.
 */
export async function inspectPublicationCanarySentinel(
  createAdapter: DomainProviderAdapterFactory,
): Promise<PublicationCanarySentinelReadiness> {
  const cloudflareReady = await inspectConfiguredProvider(
    createAdapter,
    "cloudflare",
  )
  const vercelReady = await inspectConfiguredProvider(createAdapter, "vercel")
  return Object.freeze({
    hostname: PUBLICATION_CANARY_SENTINEL_HOSTNAME,
    cloudflareReady,
    vercelReady,
  })
}

/**
 * Reconciles persistent shared negative-control infrastructure. It deliberately
 * returns only booleans, while the exact provider adapters retain ownership,
 * lookup-before-mutation, DNS-only CNAME, and project-binding semantics.
 */
export async function reconcilePublicationCanarySentinel(
  createAdapter: DomainProviderAdapterFactory,
): Promise<PublicationCanarySentinelReadiness> {
  return (await reconcilePublicationCanarySentinelProviders(createAdapter))
    .readiness
}
