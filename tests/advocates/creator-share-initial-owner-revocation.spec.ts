import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

import {
  MAX_CREATOR_SHARE_INITIAL_OWNER_REVOCATION_BODY_BYTES,
  parseCreatorShareInitialOwnerRevocationRequest,
  parseCreatorShareInitialOwnerRevocationResponse,
  readBoundedCreatorShareInitialOwnerRevocationBody,
} from "../../src/lib/advocates/creatorShareAdmin/initialOwnerRevocationContracts"

type RevocationModule =
  typeof import("../../src/lib/advocates/creatorShareAdmin/initialOwnerRevocation")
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
    "tests/advocates/creator-share-initial-owner-revocation.spec.ts",
  ),
)
const revocation = testRequire(
  "../../src/lib/advocates/creatorShareAdmin/initialOwnerRevocation",
) as RevocationModule
nodeModule._load = originalModuleLoad

const ADVOCATE_ID = "11111111-1111-4111-8111-111111111111"
const OPERATION_ID = "22222222-2222-4222-8222-222222222222"
const REASON = "The current owner link was sent to the wrong recipient."
const REQUEST = Object.freeze({
  expectedVersion: 3,
  reason: REASON,
  operationId: OPERATION_ID,
  confirmation: "REVOKE_INITIAL_OWNER" as const,
})

test.describe("Creator Share initial owner revocation contracts", () => {
  test("accepts only the exact versioned privacy-bounded request", () => {
    expect(
      parseCreatorShareInitialOwnerRevocationRequest(JSON.stringify(REQUEST)),
    ).toEqual(REQUEST)

    for (const invalid of [
      { ...REQUEST, expectedVersion: 0 },
      { ...REQUEST, expectedVersion: 3.5 },
      { ...REQUEST, reason: " padded " },
      { ...REQUEST, reason: "Line one\nLine two" },
      { ...REQUEST, reason: "x".repeat(2_001) },
      {
        ...REQUEST,
        operationId: "11111111-1111-1111-8111-111111111111",
      },
      { ...REQUEST, confirmation: "REVOKE" },
      { ...REQUEST, ownerEmail: "owner@example.com" },
      { ...REQUEST, invitationId: ADVOCATE_ID },
      { ...REQUEST, provider: "resend" },
      { ...REQUEST, sessionId: "browser-owned" },
    ]) {
      expect(
        parseCreatorShareInitialOwnerRevocationRequest(JSON.stringify(invalid)),
      ).toBeNull()
    }
  })

  test("accepts only sanitized immutable response evidence", () => {
    const expected = {
      operationId: OPERATION_ID,
      advocateId: ADVOCATE_ID,
      expectedVersion: 3,
    }
    const success = {
      ok: true,
      operationId: OPERATION_ID,
      advocateId: ADVOCATE_ID,
      advocateVersion: 4,
      revocationStatus: "initial_owner_invitation_revoked",
    }
    expect(
      parseCreatorShareInitialOwnerRevocationResponse(success, expected),
    ).toEqual(success)
    for (const invalid of [
      { ...success, advocateVersion: 3 },
      { ...success, advocateId: OPERATION_ID },
      { ...success, revocationStatus: "revoked" },
      { ...success, invitationId: ADVOCATE_ID },
      { ...success, ownerEmail: "owner@example.com" },
      { ...success, providerMessageId: "private" },
    ]) {
      expect(
        parseCreatorShareInitialOwnerRevocationResponse(invalid, expected),
      ).toBeNull()
    }
  })

  test("bounds body bytes and rejects invalid UTF-8", async () => {
    await expect(
      readBoundedCreatorShareInitialOwnerRevocationBody(
        new Request("https://creatorshare.com/revoke", {
          method: "POST",
          body: JSON.stringify(REQUEST),
        }),
      ),
    ).resolves.toBe(JSON.stringify(REQUEST))
    await expect(
      readBoundedCreatorShareInitialOwnerRevocationBody(
        new Request("https://creatorshare.com/revoke", {
          method: "POST",
          body: "x".repeat(
            MAX_CREATOR_SHARE_INITIAL_OWNER_REVOCATION_BODY_BYTES + 1,
          ),
        }),
      ),
    ).resolves.toBeNull()
    await expect(
      readBoundedCreatorShareInitialOwnerRevocationBody(
        new Request("https://creatorshare.com/revoke", {
          method: "POST",
          body: Uint8Array.from([0xc3, 0x28]),
        }),
      ),
    ).resolves.toBeNull()
  })
})

test.describe("Creator Share initial owner revocation repository", () => {
  test("uses the exact audited revocation RPC without contact material", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = []
    const repository =
      revocation.createCreatorShareInitialOwnerRevocationRepository({
        async rpc(name: string, args: Record<string, unknown>) {
          calls.push({ name, args })
          return {
            data: [
              {
                operation_id: OPERATION_ID,
                advocate_id: ADVOCATE_ID,
                advocate_version: 4,
                revocation_status: "initial_owner_invitation_revoked",
                created: true,
              },
            ],
            error: null,
          }
        },
      } as never)

    await expect(
      repository.revoke({
        advocateId: ADVOCATE_ID,
        expectedVersion: 3,
        reason: REASON,
        operationId: OPERATION_ID,
        context: {
          traceId: "trace-123",
          sessionId: null,
          clientIp: "203.0.113.42",
          userAgent: "Creator Share Admin Test/1.0",
        },
      }),
    ).resolves.toEqual({
      operationId: OPERATION_ID,
      advocateId: ADVOCATE_ID,
      advocateVersion: 4,
      revocationStatus: "initial_owner_invitation_revoked",
      created: true,
    })

    expect(calls).toEqual([
      {
        name: "revoke_advocate_initial_owner_invitation",
        args: {
          revocation_operation_id: OPERATION_ID,
          target_advocate_id: ADVOCATE_ID,
          expected_advocate_version: 3,
          change_reason: REASON,
          request_id: OPERATION_ID,
          trace_id: "trace-123",
          session_id: null,
          client_ip: "203.0.113.42",
          user_agent: "Creator Share Admin Test/1.0",
        },
      },
    ])
    expect(JSON.stringify(calls)).not.toMatch(
      /email|capability|ciphertext|provider/i,
    )
  })

  test("rejects malformed RPC output and maps only static failures", async () => {
    const malformed =
      revocation.createCreatorShareInitialOwnerRevocationRepository({
        async rpc() {
          return {
            data: [
              {
                operation_id: OPERATION_ID,
                advocate_id: ADVOCATE_ID,
                advocate_version: 4,
                revocation_status: "initial_owner_invitation_revoked",
                created: true,
                invitation_id: ADVOCATE_ID,
              },
            ],
            error: null,
          }
        },
      } as never)
    await expect(
      malformed.revoke({
        advocateId: ADVOCATE_ID,
        expectedVersion: 3,
        reason: REASON,
        operationId: OPERATION_ID,
        context: {
          traceId: "trace-123",
          sessionId: null,
          clientIp: null,
          userAgent: null,
        },
      }),
    ).rejects.toMatchObject({ stage: "shape" })

    expect(
      revocation.classifyCreatorShareInitialOwnerRevocationFailure("42501"),
    ).toEqual({ status: 403, code: "forbidden" })
    expect(
      revocation.classifyCreatorShareInitialOwnerRevocationFailure("55000"),
    ).toEqual({ status: 409, code: "initial_owner_revocation_conflict" })
    expect(
      revocation.classifyCreatorShareInitialOwnerRevocationFailure("XX000"),
    ).toEqual({ status: 503, code: "initial_owner_revocation_unavailable" })
  })
})
