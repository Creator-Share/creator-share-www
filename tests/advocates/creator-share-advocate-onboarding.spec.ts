import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"
import type { SupabaseClient } from "@supabase/supabase-js"

import {
  parseCreatorShareAdvocateOnboardingRequest,
  parseCreatorShareAdvocateOnboardingResponse,
} from "../../src/lib/advocates/creatorShareAdmin/onboardingContracts"

type OnboardingModule =
  typeof import("../../src/lib/advocates/creatorShareAdmin/onboarding")
type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown

const nodeModule = Module as unknown as { _load: NodeModuleLoader }
const originalModuleLoad = nodeModule._load
nodeModule._load = function mockedModuleLoad(
  this: unknown,
  request: string,
  parent: unknown,
  isMain: boolean,
) {
  if (request === "server-only") return {}
  return originalModuleLoad.call(this, request, parent, isMain)
}
const testRequire = createRequire(
  resolve(
    process.cwd(),
    "tests/advocates/creator-share-advocate-onboarding.spec.ts",
  ),
)
const onboardingModule = testRequire(
  "../../src/lib/advocates/creatorShareAdmin/onboarding",
) as OnboardingModule
nodeModule._load = originalModuleLoad

const OPERATION_ID = "11111111-1111-4111-8111-111111111111"
const ADVOCATE_ID = "22222222-2222-4222-8222-222222222222"
const CAPABILITY = "ab".repeat(32)
const requestInput = Object.freeze({
  slug: "hope-partners",
  displayName: "Hope Partners",
  advocateType: "organization",
  ownerEmail: "Owner@Example.com",
  reason: "Create the approved Hope Partners advocate portal.",
  operationId: OPERATION_ID,
})

const delivery = Object.freeze({
  capability: CAPABILITY,
  capabilityDigest: `\\x${"11".repeat(32)}` as const,
  normalizedEmail: "owner@example.com",
  recipientEmailCiphertext: `\\x${"22".repeat(48)}` as const,
  recipientEmailHmac: `\\x${"33".repeat(32)}` as const,
  secretPayloadCiphertext: `\\x${"44".repeat(64)}` as const,
  emailNormalizationVersion: 1,
  emailHmacKeyVersion: 1,
  emailEncryptionKeyVersion: 1,
})

test.describe("Creator Share advocate onboarding contracts", () => {
  test("accepts only the exact bounded email-first request", () => {
    expect(
      parseCreatorShareAdvocateOnboardingRequest(JSON.stringify(requestInput)),
    ).toEqual(requestInput)

    for (const invalid of [
      { ...requestInput, extra: true },
      { ...requestInput, slug: "Hope-Partners" },
      { ...requestInput, displayName: " padded " },
      { ...requestInput, advocateType: "Social Influencer" },
      { ...requestInput, ownerEmail: "owner@localhost" },
      { ...requestInput, ownerEmail: "owner@@example.com" },
      { ...requestInput, reason: "" },
      {
        ...requestInput,
        operationId: "22222222-2222-2222-8222-222222222222",
      },
    ]) {
      expect(
        parseCreatorShareAdvocateOnboardingRequest(JSON.stringify(invalid)),
      ).toBeNull()
    }
    expect(
      parseCreatorShareAdvocateOnboardingRequest(
        JSON.stringify({ ...requestInput, reason: "x".repeat(8_300) }),
      ),
    ).toBeNull()
  })

  test("accepts only the sanitized response projection", () => {
    const success = {
      ok: true,
      operationId: OPERATION_ID,
      advocateId: ADVOCATE_ID,
      advocateVersion: 1,
      onboardingStatus: "initial_owner_invitation_queued",
    }
    expect(
      parseCreatorShareAdvocateOnboardingResponse(success, OPERATION_ID),
    ).toEqual(success)

    for (const forbidden of [
      { ...success, ownerEmail: "owner@example.com" },
      { ...success, invitationId: ADVOCATE_ID },
      { ...success, outboxId: ADVOCATE_ID },
      { ...success, capability: CAPABILITY },
      { ...success, targetAuthUserId: ADVOCATE_ID },
      { ...success, onboardingStatus: "pending" },
    ]) {
      expect(
        parseCreatorShareAdvocateOnboardingResponse(forbidden, OPERATION_ID),
      ).toBeNull()
    }
    expect(JSON.stringify(success)).not.toMatch(
      /email|invitationId|outbox|capability|ciphertext|targetAuth|provider/i,
    )
    expect(
      parseCreatorShareAdvocateOnboardingResponse(
        {
          ok: false,
          operationId: OPERATION_ID,
          code: "unexpected_failure",
        },
        OPERATION_ID,
      ),
    ).toBeNull()
  })
})

test.describe("Creator Share advocate onboarding repository", () => {
  test("uses the authenticated RPC with sealed delivery material and returns immutable evidence", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = []
    const client = {
      async rpc(name: string, args: Record<string, unknown>) {
        calls.push({ name, args })
        return {
          data: [
            {
              operation_id: OPERATION_ID,
              advocate_id: ADVOCATE_ID,
              advocate_version: "1",
              onboarding_status: "initial_owner_invitation_queued",
              created: true,
            },
          ],
          error: null,
        }
      },
    } as unknown as SupabaseClient
    const preparedEmails: string[] = []
    const repository =
      onboardingModule.createCreatorShareAdvocateOnboardingRepository(client, {
        prepareInvitationDelivery(email) {
          preparedEmails.push(email)
          return delivery
        },
      })

    await expect(
      repository.onboard({
        onboarding: requestInput,
        context: {
          traceId: "trace-reference",
          sessionId: null,
          clientIp: "203.0.113.42",
          userAgent: "Creator Share Admin Test/1.0",
        },
      }),
    ).resolves.toEqual({
      operationId: OPERATION_ID,
      advocateId: ADVOCATE_ID,
      advocateVersion: 1,
      onboardingStatus: "initial_owner_invitation_queued",
      created: true,
    })
    expect(preparedEmails).toEqual(["owner@example.com"])
    expect(calls).toEqual([
      {
        name: "onboard_creator_share_advocate",
        args: {
          onboarding_operation_id: OPERATION_ID,
          portal_slug: "hope-partners",
          portal_display_name: "Hope Partners",
          portal_advocate_type: "organization",
          owner_email: "owner@example.com",
          capability_digest: delivery.capabilityDigest,
          recipient_email_ciphertext: delivery.recipientEmailCiphertext,
          recipient_email_hmac: delivery.recipientEmailHmac,
          secret_payload_ciphertext: delivery.secretPayloadCiphertext,
          email_normalization_version: 1,
          email_hmac_key_version: 1,
          email_encryption_key_version: 1,
          change_reason: requestInput.reason,
          request_id: OPERATION_ID,
          trace_id: "trace-reference",
          session_id: null,
          client_ip: "203.0.113.42",
          user_agent: "Creator Share Admin Test/1.0",
        },
      },
    ])
    expect(JSON.stringify(calls)).not.toContain(CAPABILITY)
  })

  test("rejects unexpected RPC result fields before they can reach the route", async () => {
    const repository =
      onboardingModule.createCreatorShareAdvocateOnboardingRepository(
        {
          async rpc() {
            return {
              data: [
                {
                  operation_id: OPERATION_ID,
                  advocate_id: ADVOCATE_ID,
                  advocate_version: 1,
                  onboarding_status: "initial_owner_invitation_queued",
                  created: true,
                  invitation_id: ADVOCATE_ID,
                },
              ],
              error: null,
            }
          },
        } as unknown as SupabaseClient,
        { prepareInvitationDelivery: () => delivery },
      )
    await expect(
      repository.onboard({
        onboarding: requestInput,
        context: {
          traceId: "trace-reference",
          sessionId: null,
          clientIp: null,
          userAgent: null,
        },
      }),
    ).rejects.toMatchObject({ stage: "shape" })
  })

  test("classifies stable client, authority, conflict, and outage failures", () => {
    expect(
      onboardingModule.classifyCreatorShareAdvocateOnboardingFailure("22023"),
    ).toEqual({ status: 400, code: "invalid_request" })
    expect(
      onboardingModule.classifyCreatorShareAdvocateOnboardingFailure("42501"),
    ).toEqual({ status: 403, code: "forbidden" })
    expect(
      onboardingModule.classifyCreatorShareAdvocateOnboardingFailure("23505"),
    ).toEqual({ status: 409, code: "onboarding_conflict" })
    expect(
      onboardingModule.classifyCreatorShareAdvocateOnboardingFailure(undefined),
    ).toEqual({ status: 503, code: "onboarding_unavailable" })
  })
})
