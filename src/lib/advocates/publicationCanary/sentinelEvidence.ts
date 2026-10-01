import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  PUBLICATION_CANARY_SENTINEL_OUTCOME_CODES,
  PUBLICATION_CANARY_SENTINEL_STAGES,
  publicationCanarySentinelEventIsValid,
  type PublicationCanarySentinelOperationalEvent,
} from "./sentinel"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const ZERO_UUID = "00000000-0000-0000-0000-000000000000"
const STAGES = new Set<string>(PUBLICATION_CANARY_SENTINEL_STAGES)
const OUTCOMES = new Set<string>(PUBLICATION_CANARY_SENTINEL_OUTCOME_CODES)

export type PublicationCanarySentinelTerminalOutcome =
  "ready" | "converging" | "failed"

export interface PublicationCanarySentinelEvidenceInput {
  runId: string
  requestReferenceSha256: string
  outcome: PublicationCanarySentinelTerminalOutcome
  events: readonly PublicationCanarySentinelOperationalEvent[]
}

export interface PublicationCanarySentinelEvidenceRepository {
  record(input: PublicationCanarySentinelEvidenceInput): Promise<void>
}

export class PublicationCanarySentinelEvidenceError extends Error {
  constructor() {
    super("advocate_publication_sentinel_evidence_failure")
    this.name = "PublicationCanarySentinelEvidenceError"
  }
}

function inputValid(input: PublicationCanarySentinelEvidenceInput): boolean {
  if (
    !UUID_PATTERN.test(input.runId) ||
    input.runId === ZERO_UUID ||
    !SHA256_PATTERN.test(input.requestReferenceSha256) ||
    !["ready", "converging", "failed"].includes(input.outcome) ||
    !Array.isArray(input.events) ||
    input.events.length < 3 ||
    input.events.length > PUBLICATION_CANARY_SENTINEL_STAGES.length
  ) {
    return false
  }

  const seenStages = new Set<string>()
  let previousStageRank = -1
  for (const [index, event] of input.events.entries()) {
    const stageRank =
      typeof event === "object" && event !== null && !Array.isArray(event)
        ? PUBLICATION_CANARY_SENTINEL_STAGES.indexOf(event.stage)
        : -1
    if (
      typeof event !== "object" ||
      event === null ||
      Array.isArray(event) ||
      Object.keys(event).sort().join(",") !== "outcome_code,sequence,stage" ||
      event.sequence !== index ||
      !STAGES.has(event.stage) ||
      !OUTCOMES.has(event.outcome_code) ||
      !publicationCanarySentinelEventIsValid(event.stage, event.outcome_code) ||
      stageRank <= previousStageRank ||
      seenStages.has(event.stage)
    ) {
      return false
    }
    previousStageRank = stageRank
    seenStages.add(event.stage)
  }

  const finalEvent = input.events.at(-1)
  return (
    finalEvent?.stage === "complete" &&
    finalEvent.outcome_code === input.outcome
  )
}

export function assertPublicationCanarySentinelEvidenceInput(
  input: PublicationCanarySentinelEvidenceInput,
): void {
  if (!inputValid(input)) throw new PublicationCanarySentinelEvidenceError()
}

export function createPublicationCanarySentinelEvidenceRepository(
  client: SupabaseClient,
): PublicationCanarySentinelEvidenceRepository {
  return {
    async record(input) {
      assertPublicationCanarySentinelEvidenceInput(input)
      const { error } = await client.rpc(
        "record_advocate_publication_sentinel_reconciliation",
        {
          target_run_id: input.runId,
          target_request_reference_sha256: input.requestReferenceSha256,
          target_outcome_code: input.outcome,
          target_events: input.events,
        },
      )
      if (error) throw new PublicationCanarySentinelEvidenceError()
    },
  }
}
