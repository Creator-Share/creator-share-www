import "server-only"

import type { PublicationCanaryHttpResponse } from "./runner"
import {
  type PublicationCanarySentinelOperationalEvent,
  type PublicationCanarySentinelProviderReconciliation,
} from "./sentinel"
import type {
  PublicationCanarySentinelEvidenceInput,
  PublicationCanarySentinelEvidenceRepository,
  PublicationCanarySentinelTerminalOutcome,
} from "./sentinelEvidence"
import { PUBLICATION_CANARY_SENTINEL_HOSTNAME } from "./topology"

const SAFE_CONTENT_TYPE_PATTERN = /^[\x20-\x7e]{1,200}$/
const MAXIMUM_SENTINEL_BODY_BYTES = 32_768

export const PUBLICATION_CANARY_SENTINEL_INVOCATION_BUDGET_MS = 50_000
export const PUBLICATION_CANARY_SENTINEL_SETTLEMENT_RESERVE_MS = 10_000

export interface PublicationCanarySentinelBootstrapDependencies {
  evidence: PublicationCanarySentinelEvidenceRepository
  reconcileProviders(): Promise<PublicationCanarySentinelProviderReconciliation>
  observeDns(): Promise<void>
  inspectTls(): Promise<void>
  requestHttps(): Promise<PublicationCanaryHttpResponse>
}

export interface PublicationCanarySentinelBootstrapResult {
  ready: boolean
  outcome: PublicationCanarySentinelTerminalOutcome
}

export class PublicationCanaryReachableHttpResponseError extends Error {
  constructor() {
    super("publication_canary_http_response_invalid")
    this.name = "PublicationCanaryReachableHttpResponseError"
  }
}

export type PublicationCanarySentinelGateResult<T> =
  | Readonly<{
      ready: false
      outcome: "converging" | "failed"
    }>
  | Readonly<{
      ready: true
      outcome: "ready"
      execution: T
    }>

function appendEvent(
  events: PublicationCanarySentinelOperationalEvent[],
  stage: PublicationCanarySentinelOperationalEvent["stage"],
  outcomeCode: PublicationCanarySentinelOperationalEvent["outcome_code"],
): void {
  events.push({ sequence: events.length, stage, outcome_code: outcomeCode })
}

function validHttpsResponse(response: PublicationCanaryHttpResponse): boolean {
  return (
    typeof response === "object" &&
    response !== null &&
    response.requestedHostname === PUBLICATION_CANARY_SENTINEL_HOSTNAME &&
    response.finalUrl === `https://${PUBLICATION_CANARY_SENTINEL_HOSTNAME}/` &&
    response.status === 404 &&
    response.redirected === false &&
    typeof response.contentType === "string" &&
    SAFE_CONTENT_TYPE_PATTERN.test(response.contentType) &&
    response.body instanceof Uint8Array &&
    response.body.byteLength >= 1 &&
    response.body.byteLength <= MAXIMUM_SENTINEL_BODY_BYTES
  )
}

async function finish(
  input: {
    runId: string
    requestReferenceSha256: string
    outcome: PublicationCanarySentinelTerminalOutcome
    events: PublicationCanarySentinelOperationalEvent[]
  },
  evidence: PublicationCanarySentinelEvidenceRepository,
): Promise<PublicationCanarySentinelBootstrapResult> {
  appendEvent(input.events, "complete", input.outcome)
  await evidence.record({
    runId: input.runId,
    requestReferenceSha256: input.requestReferenceSha256,
    outcome: input.outcome,
    events: input.events,
  } satisfies PublicationCanarySentinelEvidenceInput)
  return Object.freeze({
    ready: input.outcome === "ready",
    outcome: input.outcome,
  })
}

/**
 * Continuously converges the shared sentinel before any tenant canary is
 * claimed. DNS, TLS, and HTTPS readiness here are a precondition only. The
 * terminal tenant canary independently repeats every observation.
 */
export async function runPublicationCanarySentinelBootstrap(
  input: { runId: string; requestReferenceSha256: string },
  dependencies: PublicationCanarySentinelBootstrapDependencies,
): Promise<PublicationCanarySentinelBootstrapResult> {
  const providers = await dependencies.reconcileProviders()
  const events = providers.events.map((event) => ({ ...event }))

  if (providers.outcome !== "ready") {
    return finish(
      {
        ...input,
        outcome: providers.outcome,
        events,
      },
      dependencies.evidence,
    )
  }

  try {
    await dependencies.observeDns()
    appendEvent(events, "dns", "ready")
  } catch {
    appendEvent(events, "dns", "not_ready")
    return finish(
      { ...input, outcome: "converging", events },
      dependencies.evidence,
    )
  }

  try {
    await dependencies.inspectTls()
    appendEvent(events, "tls", "ready")
  } catch {
    appendEvent(events, "tls", "not_ready")
    return finish(
      { ...input, outcome: "converging", events },
      dependencies.evidence,
    )
  }

  let response: PublicationCanaryHttpResponse
  try {
    response = await dependencies.requestHttps()
  } catch (error) {
    const reachableMalformedResponse =
      error instanceof PublicationCanaryReachableHttpResponseError
    appendEvent(
      events,
      "https",
      reachableMalformedResponse ? "unexpected_response" : "not_ready",
    )
    return finish(
      {
        ...input,
        outcome: reachableMalformedResponse ? "failed" : "converging",
        events,
      },
      dependencies.evidence,
    )
  }
  if (!validHttpsResponse(response)) {
    appendEvent(events, "https", "unexpected_response")
    return finish(
      { ...input, outcome: "failed", events },
      dependencies.evidence,
    )
  }

  appendEvent(events, "https", "ready")
  return finish({ ...input, outcome: "ready", events }, dependencies.evidence)
}

/**
 * Runs tenant work only after the persistent shared sentinel is ready. Both
 * cron recovery and the post-response low-latency path use this gate so no
 * execution path can claim a tenant canary while sentinel infrastructure is
 * still converging.
 */
export async function runAfterPublicationCanarySentinel<T>(
  input: { runId: string; requestReferenceSha256: string },
  dependencies: PublicationCanarySentinelBootstrapDependencies,
  execute: () => Promise<T>,
): Promise<PublicationCanarySentinelGateResult<T>> {
  const sentinel = await runPublicationCanarySentinelBootstrap(
    input,
    dependencies,
  )
  if (!sentinel.ready) {
    if (sentinel.outcome === "ready") {
      throw new Error("publication_canary_sentinel_result_invalid")
    }
    return Object.freeze({ ready: false, outcome: sentinel.outcome })
  }
  return Object.freeze({
    ready: true,
    outcome: "ready",
    execution: await execute(),
  })
}
