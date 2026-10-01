import { expect, test } from "@playwright/test"

import {
  bindPublicationCanaryRun,
  parsePublicationCanaryClientResponse,
  parseSavedPublicationCanaryOperation,
  publicationCanaryOperationsEqual,
  publicationCanaryOperationStorageKey,
} from "../../src/lib/advocates/publicationCanary/clientOperation"

const ADVOCATE_ID = "11111111-1111-4111-8111-111111111111"
const OPERATION_ID = "22222222-2222-4222-8222-222222222222"
const OTHER_OPERATION_ID = "33333333-3333-4333-8333-333333333333"
const RUN_ID = "44444444-4444-5444-8444-444444444444"
const OTHER_RUN_ID = "55555555-5555-5555-8555-555555555555"

const savedOperation = Object.freeze({
  version: 1,
  advocateId: ADVOCATE_ID,
  operationId: OPERATION_ID,
  expectedVersion: 17,
  adminReason: "Initial advocate publication after release review.",
  runId: null,
})

const responseExpectation = Object.freeze({
  status: 202,
  operationId: OPERATION_ID,
  expectedVersion: 17,
  retryAfterHeader: "2",
})

test.describe("publication canary browser operation contract", () => {
  test("round trips only an exact same-tab storage record", () => {
    expect(publicationCanaryOperationStorageKey(ADVOCATE_ID)).toBe(
      `creator-share:advocate-publication-operation:v1:${ADVOCATE_ID}`,
    )
    const parsed = parseSavedPublicationCanaryOperation(
      JSON.parse(JSON.stringify(savedOperation)),
    )
    expect(parsed).toEqual(savedOperation)
    expect(Object.isFrozen(parsed)).toBe(true)

    for (const invalid of [
      null,
      [],
      {},
      { ...savedOperation, version: 2 },
      { ...savedOperation, advocateId: "invalid" },
      {
        ...savedOperation,
        operationId: "22222222-2222-5222-8222-222222222222",
      },
      { ...savedOperation, expectedVersion: 0 },
      { ...savedOperation, adminReason: " leading space" },
      { ...savedOperation, adminReason: "line\nbreak" },
      { ...savedOperation, runId: "invalid" },
      { ...savedOperation, providerSecret: "must-not-persist" },
    ]) {
      expect(parseSavedPublicationCanaryOperation(invalid)).toBeNull()
    }
  })

  test("binds one immutable server run and detects storage mismatches", () => {
    const parsed = parseSavedPublicationCanaryOperation(savedOperation)
    if (parsed === null) throw new Error("Expected saved operation")
    const bound = bindPublicationCanaryRun(parsed, RUN_ID)
    if (bound === null) throw new Error("Expected run binding")

    expect(bound).toEqual({ ...savedOperation, runId: RUN_ID })
    expect(Object.isFrozen(bound)).toBe(true)
    expect(bindPublicationCanaryRun(bound, RUN_ID)).toBe(bound)
    expect(bindPublicationCanaryRun(bound, OTHER_RUN_ID)).toBeNull()
    expect(bindPublicationCanaryRun(bound, "invalid")).toBeNull()
    expect(publicationCanaryOperationsEqual(bound, { ...bound })).toBe(true)
    expect(
      publicationCanaryOperationsEqual(bound, {
        ...bound,
        operationId: OTHER_OPERATION_ID,
      }),
    ).toBe(false)
    expect(
      publicationCanaryOperationsEqual(bound, {
        ...bound,
        adminReason: "Different reason.",
      }),
    ).toBe(false)
  })

  test("accepts only a status and header bound pending response", () => {
    const body = {
      ok: true,
      code: "publication_canary_pending",
      operationId: OPERATION_ID,
      runId: RUN_ID,
      publicationStatus: "verifying",
      retryAfterSeconds: 2,
    }
    expect(
      parsePublicationCanaryClientResponse(body, responseExpectation),
    ).toEqual({
      kind: "pending",
      operationId: OPERATION_ID,
      runId: RUN_ID,
      retryAfterSeconds: 2,
    })

    for (const [invalidBody, invalidExpected] of [
      [{ ...body, operationId: OTHER_OPERATION_ID }, responseExpectation],
      [body, { ...responseExpectation, operationId: OTHER_OPERATION_ID }],
      [body, { ...responseExpectation, retryAfterHeader: null }],
      [body, { ...responseExpectation, retryAfterHeader: "3" }],
      [body, { ...responseExpectation, status: 200 }],
      [{ ...body, retryAfterSeconds: 0 }, responseExpectation],
      [{ ...body, retryAfterSeconds: 31 }, responseExpectation],
      [{ ...body, publicationStatus: "active" }, responseExpectation],
      [{ ...body, providerSecret: "must-not-leak" }, responseExpectation],
    ] as const) {
      expect(
        parsePublicationCanaryClientResponse(invalidBody, invalidExpected),
      ).toBeNull()
    }
  })

  test("accepts only exact published and terminal response shapes", () => {
    const published = {
      ok: true,
      code: "publication_committed",
      operationId: OPERATION_ID,
      runId: RUN_ID,
      advocateVersion: 18,
    }
    const publishedExpected = {
      ...responseExpectation,
      status: 200,
      retryAfterHeader: null,
    }
    expect(
      parsePublicationCanaryClientResponse(published, publishedExpected),
    ).toEqual({
      kind: "published",
      operationId: OPERATION_ID,
      runId: RUN_ID,
      advocateVersion: 18,
    })
    expect(
      parsePublicationCanaryClientResponse(
        { ...published, advocateVersion: 19 },
        publishedExpected,
      ),
    ).toMatchObject({ kind: "published", advocateVersion: 19 })

    for (const invalid of [
      { ...published, advocateVersion: 17 },
      { ...published, advocateVersion: 20 },
      { ...published, publicationStatus: "verifying" },
      { ...published, reportSha256: "must-not-be-public" },
    ]) {
      expect(
        parsePublicationCanaryClientResponse(invalid, publishedExpected),
      ).toBeNull()
    }
    expect(
      parsePublicationCanaryClientResponse(published, {
        ...publishedExpected,
        retryAfterHeader: "2",
      }),
    ).toBeNull()

    for (const code of [
      "publication_canary_failed",
      "publication_canary_expired",
      "publication_deployment_changed",
    ] as const) {
      const terminal = {
        ok: false,
        code,
        operationId: OPERATION_ID,
        runId: RUN_ID,
        retryWithNewOperationId: true,
      }
      expect(
        parsePublicationCanaryClientResponse(terminal, {
          ...responseExpectation,
          status: 409,
          retryAfterHeader: null,
        }),
      ).toEqual({
        kind: "terminal",
        operationId: OPERATION_ID,
        runId: RUN_ID,
        code,
      })
      expect(
        parsePublicationCanaryClientResponse(
          { ...terminal, retryWithNewOperationId: false },
          {
            ...responseExpectation,
            status: 409,
            retryAfterHeader: null,
          },
        ),
      ).toBeNull()
    }
  })

  test("binds every static failure code to its exact HTTP status", () => {
    const cases = [
      ["invalid_request", 400],
      ["unauthorized", 401],
      ["forbidden", 403],
      ["portal_not_found", 404],
      ["publication_conflict", 409],
      ["publication_failed", 500],
      ["publication_configuration_unavailable", 503],
      ["publication_unavailable", 503],
    ] as const

    for (const [code, status] of cases) {
      const body = { ok: false, code, operationId: OPERATION_ID }
      expect(
        parsePublicationCanaryClientResponse(body, {
          ...responseExpectation,
          status,
          retryAfterHeader: null,
        }),
      ).toEqual({ kind: "failure", operationId: OPERATION_ID, code })
      expect(
        parsePublicationCanaryClientResponse(body, {
          ...responseExpectation,
          status: status === 400 ? 500 : 400,
          retryAfterHeader: null,
        }),
      ).toBeNull()
      expect(
        parsePublicationCanaryClientResponse(
          { ...body, detail: "database message" },
          {
            ...responseExpectation,
            status,
            retryAfterHeader: null,
          },
        ),
      ).toBeNull()
    }
  })
})
