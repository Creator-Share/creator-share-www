import { expect, test } from "@playwright/test"

import {
  classifyAdvocateProvisioningStartFailure,
  deriveAdvocateProvisioningRequestId,
  isJsonRequestContentType,
  MAX_PROVISIONING_START_BODY_BYTES,
  parseAdvocateProvisioningStartInput,
  parseAdvocateProvisioningStartResult,
  readBoundedProvisioningStartBody,
} from "../../src/lib/advocates/provisioning/start"

const ADVOCATE_ID = "11111111-1111-4111-8111-111111111111"
const DOMAIN_ID = "22222222-2222-4222-8222-222222222222"
const ACTOR_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const JOB_IDS = [
  "30000000-0000-4000-8000-000000000001",
  "30000000-0000-4000-8000-000000000002",
  "30000000-0000-4000-8000-000000000003",
  "30000000-0000-4000-8000-000000000004",
  "30000000-0000-4000-8000-000000000005",
]

test.describe("advocate provisioning start boundary", () => {
  test("uses an exact JSON media type", () => {
    expect(isJsonRequestContentType("application/json")).toBe(true)
    expect(isJsonRequestContentType(" Application/JSON ; charset=utf-8")).toBe(
      true,
    )
    expect(isJsonRequestContentType("application/jsonp")).toBe(false)
    expect(isJsonRequestContentType("text/json")).toBe(false)
    expect(isJsonRequestContentType(null)).toBe(false)
  })

  test("derives one server-owned operation id across transport retries", () => {
    const input = {
      actorUserId: ACTOR_ID,
      advocateId: ADVOCATE_ID,
      expectedVersion: 7,
    }
    const requestId = deriveAdvocateProvisioningRequestId(input)
    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(deriveAdvocateProvisioningRequestId(input)).toBe(requestId)
    expect(
      deriveAdvocateProvisioningRequestId({ ...input, expectedVersion: 8 }),
    ).not.toBe(requestId)
    expect(
      deriveAdvocateProvisioningRequestId({ ...input, actorUserId: "invalid" }),
    ).toBeNull()
  })

  test("accepts only one positive safe optimistic version", () => {
    expect(
      parseAdvocateProvisioningStartInput('{"expectedVersion":7}'),
    ).toEqual({ expectedVersion: 7 })
    for (const invalid of [
      "",
      "{}",
      "[]",
      '{"expectedVersion":0}',
      '{"expectedVersion":1.5}',
      '{"expectedVersion":"1"}',
      '{"expectedVersion":1,"slug":"alice"}',
      "x".repeat(MAX_PROVISIONING_START_BODY_BYTES + 1),
    ]) {
      expect(parseAdvocateProvisioningStartInput(invalid)).toBeNull()
    }
  })

  test("bounds and strictly decodes the streamed request body", async () => {
    await expect(
      readBoundedProvisioningStartBody(
        new Request(
          "https://creatorshare.com/api/admin/advocates/id/provisioning",
          {
            method: "POST",
            body: '{"expectedVersion":7}',
          },
        ),
      ),
    ).resolves.toBe('{"expectedVersion":7}')

    const oversized = "x".repeat(MAX_PROVISIONING_START_BODY_BYTES + 1)
    await expect(
      readBoundedProvisioningStartBody(
        new Request(
          "https://creatorshare.com/api/admin/advocates/id/provisioning",
          {
            method: "POST",
            body: oversized,
          },
        ),
      ),
    ).resolves.toBeNull()

    await expect(
      readBoundedProvisioningStartBody(
        new Request(
          "https://creatorshare.com/api/admin/advocates/id/provisioning",
          {
            method: "POST",
            body: Uint8Array.from([0xc3, 0x28]),
          },
        ),
      ),
    ).resolves.toBeNull()
  })

  test("accepts only an exact five-job production tenant result", () => {
    const row = {
      advocate_id: ADVOCATE_ID,
      advocate_version: 8,
      domain_id: DOMAIN_ID,
      hostname: "alice.creatorshare.com",
      job_ids: JOB_IDS,
    }
    expect(
      parseAdvocateProvisioningStartResult([row], {
        advocateId: ADVOCATE_ID,
        expectedVersion: 7,
      }),
    ).toEqual({
      advocateId: ADVOCATE_ID,
      advocateVersion: 8,
      domainId: DOMAIN_ID,
      hostname: "alice.creatorshare.com",
      jobIds: JOB_IDS,
    })

    for (const invalid of [
      null,
      [],
      [row, row],
      [{ ...row, advocate_version: 7 }],
      [{ ...row, hostname: "www.creatorshare.com" }],
      [{ ...row, hostname: "alice.example.com" }],
      [{ ...row, job_ids: JOB_IDS.slice(0, 4) }],
      [{ ...row, job_ids: [JOB_IDS[0], ...JOB_IDS.slice(0, 4)] }],
      [{ ...row, internal_provider_secret: "must-not-leak" }],
    ]) {
      expect(
        parseAdvocateProvisioningStartResult(invalid, {
          advocateId: ADVOCATE_ID,
          expectedVersion: 7,
        }),
      ).toBeNull()
    }
  })

  test("maps database failures to static public outcomes", () => {
    expect(classifyAdvocateProvisioningStartFailure("22023")).toEqual({
      status: 400,
      code: "invalid_request",
    })
    expect(classifyAdvocateProvisioningStartFailure("42501")).toEqual({
      status: 403,
      code: "forbidden",
    })
    expect(classifyAdvocateProvisioningStartFailure("23503")).toEqual({
      status: 404,
      code: "portal_not_found",
    })
    expect(classifyAdvocateProvisioningStartFailure("40001")).toEqual({
      status: 409,
      code: "provisioning_conflict",
    })
    expect(classifyAdvocateProvisioningStartFailure("XX000")).toEqual({
      status: 500,
      code: "provisioning_failed",
    })
  })
})
