import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

import type {
  PayPalPublicationPaymentCanaryEvidence,
  StripePublicationPaymentCanaryEvidence,
} from "../../src/lib/advocates/provisioning/paymentCanaries"
import type {
  PublicationCanaryClaims,
  PublicationCanaryResponseBody,
} from "../../src/lib/advocates/publicationCanary/challenge"
import type {
  PublicationCanaryReport,
  PublicationCanaryStepName,
} from "../../src/lib/advocates/publicationCanary/report"
import type {
  PublicationCanaryHttpRequest,
  PublicationCanaryHttpResponse,
  PublicationCanaryRunnerDependencies,
  PublicationCanaryRunnerTarget,
} from "../../src/lib/advocates/publicationCanary/runner"

type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown
type RunnerModule =
  typeof import("../../src/lib/advocates/publicationCanary/runner")
type ReportModule =
  typeof import("../../src/lib/advocates/publicationCanary/report")

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
  resolve(process.cwd(), "tests/advocates/publication-canary-runner.spec.ts"),
)
const runner = testRequire(
  "../../src/lib/advocates/publicationCanary/runner",
) as RunnerModule
const reportContract = testRequire(
  "../../src/lib/advocates/publicationCanary/report",
) as ReportModule
nodeModule._load = originalModuleLoad

const NOW = Date.parse("2026-07-18T20:00:00.000Z")
const OBSERVED_AT = "2026-07-18T20:00:00.000Z"
const PROVIDER_CREATED_AT = "2026-07-18T19:59:00.000Z"
const RUN_ID = "11111111-1111-4111-8111-111111111111"
const ADVOCATE_ID = "22222222-2222-4222-8222-222222222222"
const DOMAIN_ID = "33333333-3333-4333-8333-333333333333"
const STRIPE_US_ATTEMPT_ID = "44444444-4444-4444-8444-444444444444"
const STRIPE_UK_ATTEMPT_ID = "55555555-5555-4555-8555-555555555555"
const PAYPAL_ATTEMPT_ID = "66666666-6666-4666-8666-666666666666"
const HOSTNAME = "hope.creatorshare.com"
const DEPLOYMENT_ID = "dpl_publication_canary_123"
const REVISION = "a".repeat(40)
const NONCE = "n".repeat(43)
const RESPONSE_MAC = "m".repeat(43)
const TOKEN = `v1.payload.${"t".repeat(43)}`
const GENERIC_NOT_FOUND = new TextEncoder().encode("Not Found")
const SIBLING_HOSTNAME = `canary-${"ab".repeat(16)}.creatorshare.com`

const TARGET: PublicationCanaryRunnerTarget = Object.freeze({
  runId: RUN_ID,
  advocateId: ADVOCATE_ID,
  domainId: DOMAIN_ID,
  hostname: HOSTNAME,
  expectedAdvocateVersion: 7,
  deploymentId: DEPLOYMENT_ID,
  revision: REVISION,
  paymentAttemptIds: Object.freeze({
    stripeUs: STRIPE_US_ATTEMPT_ID,
    stripeUk: STRIPE_UK_ATTEMPT_ID,
    paypal: PAYPAL_ATTEMPT_ID,
  }),
})

const CHALLENGE_CLAIMS: PublicationCanaryClaims = Object.freeze({
  schemaVersion: 1,
  purpose: "advocate-publication-canary",
  keyId: "v1",
  runId: RUN_ID,
  nonce: NONCE,
  advocateId: ADVOCATE_ID,
  domainId: DOMAIN_ID,
  hostname: HOSTNAME,
  advocateVersion: 7,
  deploymentId: DEPLOYMENT_ID,
  revision: REVISION,
  issuedAt: Math.floor(NOW / 1_000),
  expiresAt: Math.floor(NOW / 1_000) + 120,
})

const CHALLENGE_RESPONSE: PublicationCanaryResponseBody = Object.freeze({
  schemaVersion: 1,
  purpose: "advocate-publication-canary-response",
  keyId: "v1",
  runId: RUN_ID,
  nonce: NONCE,
  advocateId: ADVOCATE_ID,
  domainId: DOMAIN_ID,
  hostname: HOSTNAME,
  advocateVersion: 7,
  deploymentId: DEPLOYMENT_ID,
  revision: REVISION,
  verifiedAt: OBSERVED_AT,
  responseMac: RESPONSE_MAC,
})

const CHALLENGE_BODY = new TextEncoder().encode(
  JSON.stringify(CHALLENGE_RESPONSE),
)

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

function stripeEvidence(
  provider: "stripe_us" | "stripe_uk",
  extra: Record<string, unknown> = {},
): StripePublicationPaymentCanaryEvidence {
  return {
    schema_version: 1,
    provider,
    provider_resource_id: `cs_live_${provider === "stripe_us" ? "us" : "uk"}${"s".repeat(16)}`,
    provider_status: "checkout_session_expired_unpaid",
    create_provider_status: "open",
    provider_created_at: PROVIDER_CREATED_AT,
    provider_return_urls_sha256:
      provider === "stripe_us" ? "1".repeat(64) : "2".repeat(64),
    outbound_request_id_sha256:
      provider === "stripe_us" ? "3".repeat(64) : "4".repeat(64),
    cleanup_request_id_sha256:
      provider === "stripe_us" ? "5".repeat(64) : "6".repeat(64),
    create_http_status: 200,
    cleanup_http_status: 200,
    cleanup_performed: true,
    financial_charge_attempted: false,
    provider_capture_attempted: false,
    sponsorship_state_created: false,
    webhook_delivery_verified: false,
    verified: true,
    verified_at: OBSERVED_AT,
    provider_create_request_id: `req_create_${provider}`,
    provider_cleanup_request_id: `req_cleanup_${provider}`,
    ...extra,
  }
}

function paypalEvidence(
  extra: Record<string, unknown> = {},
): PayPalPublicationPaymentCanaryEvidence {
  return {
    schema_version: 1,
    provider: "paypal",
    provider_resource_id: "I-BW452GLLEP1G",
    provider_status: "subscription_approval_pending",
    provider_created_at: PROVIDER_CREATED_AT,
    provider_return_urls_sha256: "7".repeat(64),
    outbound_request_id_sha256: "8".repeat(64),
    create_http_status: 201,
    financial_charge_attempted: false,
    provider_capture_attempted: false,
    sponsorship_state_created: false,
    webhook_delivery_verified: false,
    verified: true,
    verified_at: OBSERVED_AT,
    provider_credential_request_id: "paypal_oauth_request",
    provider_create_request_id: "paypal_create_request",
    ...extra,
  }
}

function httpResponse(options: {
  request: PublicationCanaryHttpRequest
  status: number
  body: Uint8Array
  contentType: string
  requestedHostname?: string
  finalUrl?: string
  redirected?: boolean
}): PublicationCanaryHttpResponse {
  return {
    requestedHostname: options.requestedHostname ?? options.request.hostname,
    finalUrl: options.finalUrl ?? options.request.url,
    status: options.status,
    redirected: options.redirected ?? false,
    contentType: options.contentType,
    body: options.body,
  }
}

function monotonicNow(): () => number {
  let offset = 0
  return () => NOW + offset++
}

function createDependencies(
  calls: string[],
  overrides: Partial<PublicationCanaryRunnerDependencies> = {},
): PublicationCanaryRunnerDependencies {
  const dependencies: PublicationCanaryRunnerDependencies = {
    now: monotonicNow(),
    randomBytes(size) {
      calls.push(`random:${size}`)
      return new Uint8Array(size).fill(0xab)
    },
    async observeDns(input) {
      calls.push("dns")
      expect(input).toEqual({ hostname: HOSTNAME, timeoutMs: 10_000 })
      return {
        hostname: HOSTNAME,
        resolved: true,
        providerTargetMatched: true,
        recordTypes: ["CNAME", "A"],
        answerCount: 2,
        observedAt: OBSERVED_AT,
      }
    },
    async inspectTls(input) {
      calls.push("tls")
      expect(input).toEqual({
        hostname: HOSTNAME,
        serverName: HOSTNAME,
        rejectUnauthorized: true,
        timeoutMs: 10_000,
      })
      return {
        hostname: HOSTNAME,
        serverName: HOSTNAME,
        certificateVerified: true,
        hostnameMatched: true,
        normalCertificateVerification: true,
        protocol: "TLSv1.3",
        certificateNotBefore: "2026-07-01T00:00:00.000Z",
        certificateNotAfter: "2026-10-01T00:00:00.000Z",
        observedAt: OBSERVED_AT,
      }
    },
    createProtectedChallenge(input) {
      calls.push("challenge:create")
      expect(input).toEqual({
        runId: RUN_ID,
        advocateId: ADVOCATE_ID,
        domainId: DOMAIN_ID,
        hostname: HOSTNAME,
        advocateVersion: 7,
        deploymentId: DEPLOYMENT_ID,
        revision: REVISION,
      })
      return { token: TOKEN, claims: CHALLENGE_CLAIMS }
    },
    verifyProtectedChallengeResponse(rawBody, expectedClaims) {
      calls.push("challenge:verify")
      expect(rawBody).toBe(JSON.stringify(CHALLENGE_RESPONSE))
      expect(expectedClaims).toEqual(CHALLENGE_CLAIMS)
      return CHALLENGE_RESPONSE
    },
    async requestHttp(request) {
      calls.push(`http:${request.kind}`)
      expect(request.redirect).toBe("error")
      expect(request.credentials).toBe("omit")
      expect(request.cache).toBe("no-store")
      expect(request.timeoutMs).toBe(10_000)
      if (request.kind === "protected_exact_host_challenge") {
        expect(request).toMatchObject({
          method: "POST",
          hostname: HOSTNAME,
          url: `https://${HOSTNAME}/.well-known/creator-share/advocate-publication-canary`,
          maxResponseBytes: 4_096,
        })
        expect(request.headers).toEqual({
          Accept: "application/json",
          Authorization: `Bearer ${TOKEN}`,
        })
        return httpResponse({
          request,
          status: 200,
          body: CHALLENGE_BODY,
          contentType: "application/json; charset=utf-8",
        })
      }
      expect(request.method).toBe("GET")
      expect(request.maxResponseBytes).toBe(32_768)
      expect(request.headers).toEqual({
        Accept: "text/html, text/plain;q=0.9",
      })
      return httpResponse({
        request,
        status: 404,
        body: GENERIC_NOT_FOUND,
        contentType: "text/plain; charset=utf-8",
      })
    },
    async isHostnameProvisioned(hostname) {
      calls.push("sibling:lookup")
      expect(hostname).toBe(SIBLING_HOSTNAME)
      return false
    },
    async runStripeUsPaymentCanary(input) {
      calls.push("payment:stripe_us")
      expect(input).toEqual({
        advocateHostname: HOSTNAME,
        canaryAttemptId: STRIPE_US_ATTEMPT_ID,
      })
      return stripeEvidence("stripe_us", {
        credential_secret_must_not_escape: "sk_live_secret_marker",
        checkout_redirect_url_must_not_escape:
          "https://checkout.stripe.com/secret_marker",
      })
    },
    async runStripeUkPaymentCanary(input) {
      calls.push("payment:stripe_uk")
      expect(input).toEqual({
        advocateHostname: HOSTNAME,
        canaryAttemptId: STRIPE_UK_ATTEMPT_ID,
      })
      return stripeEvidence("stripe_uk")
    },
    async runPayPalPaymentCanary(input) {
      calls.push("payment:paypal")
      expect(input).toEqual({
        advocateHostname: HOSTNAME,
        canaryAttemptId: PAYPAL_ATTEMPT_ID,
      })
      return paypalEvidence({
        payer_email_must_not_escape: "sponsor@example.com",
        approval_url_must_not_escape:
          "https://www.paypal.com/approve?token=secret_marker",
      })
    },
  }
  return Object.assign(dependencies, overrides)
}

function reverseObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseObjectKeys)
  if (typeof value !== "object" || value === null) return value
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, item]) => [key, reverseObjectKeys(item)]),
  )
}

test.describe("advocate publication canary runner", () => {
  test("runs the fixed exact-host proof in order and returns strict safe evidence", async () => {
    const calls: string[] = []
    const result = await runner.runPublicationCanary(
      TARGET,
      createDependencies(calls),
    )

    expect(calls).toEqual([
      "dns",
      "tls",
      "challenge:create",
      "http:protected_exact_host_challenge",
      "challenge:verify",
      "http:verifying_tenant_root",
      "random:16",
      "sibling:lookup",
      "http:unprovisioned_sibling_root",
      "payment:stripe_us",
      "payment:stripe_uk",
      "payment:paypal",
    ])
    expect(result.report).toMatchObject({
      schema_version: 1,
      report_type: "advocate_publication_canary",
      canonicalization_version: 1,
      outcome: "succeeded",
      error_code: null,
      safety_claims: {
        financial_charge_attempted: false,
        provider_capture_attempted: false,
        sponsorship_state_created: false,
        webhook_delivery_verified: false,
      },
      target: {
        run_id: RUN_ID,
        advocate_id: ADVOCATE_ID,
        domain_id: DOMAIN_ID,
        hostname: HOSTNAME,
        expected_advocate_version: 7,
        deployment_id: DEPLOYMENT_ID,
        revision: REVISION,
        payment_attempt_ids: {
          stripe_us: STRIPE_US_ATTEMPT_ID,
          stripe_uk: STRIPE_UK_ATTEMPT_ID,
          paypal: PAYPAL_ATTEMPT_ID,
        },
      },
    })
    expect(result.report.steps.map((step) => step.name)).toEqual(
      reportContract.PUBLICATION_CANARY_STEP_ORDER,
    )
    expect(
      result.report.steps.every((step) => step.outcome === "succeeded"),
    ).toBe(true)
    expect(result.report.steps[0].evidence).toMatchObject({
      hostname: HOSTNAME,
      record_types: ["A", "CNAME"],
      answer_count: 2,
    })
    expect(result.report.steps[1].evidence).toMatchObject({
      hostname: HOSTNAME,
      server_name: HOSTNAME,
      certificate_verified: true,
      normal_certificate_verification: true,
    })
    expect(result.report.steps[4].evidence).toMatchObject({
      hostname: SIBLING_HOSTNAME,
      unprovisioned: true,
      identical_to_tenant_root: true,
    })
    expect(result.report.steps.slice(5).map((step) => step.evidence)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: "stripe_us" }),
        expect.objectContaining({ provider: "stripe_uk" }),
        expect.objectContaining({ provider: "paypal" }),
      ]),
    )
    expect(JSON.parse(result.canonicalReport)).toEqual(result.report)
    expect(result.reportSha256).toBe(sha256(result.canonicalReport))
    expect(
      Buffer.byteLength(result.canonicalReport, "utf8"),
    ).toBeLessThanOrEqual(reportContract.MAX_PUBLICATION_CANARY_REPORT_BYTES)

    for (const forbidden of [
      TOKEN,
      NONCE,
      RESPONSE_MAC,
      "Not Found",
      "sk_live_secret_marker",
      "checkout.stripe.com",
      "sponsor@example.com",
      "paypal.com/approve",
      "secret_marker",
    ]) {
      expect(result.canonicalReport).not.toContain(forbidden)
    }
  })

  test("canonical serialization is stable across object insertion order and rejects unknown fields", async () => {
    const result = await runner.runPublicationCanary(
      TARGET,
      createDependencies([]),
    )
    const reordered = reverseObjectKeys(
      result.report,
    ) as PublicationCanaryReport

    expect(
      reportContract.serializeCanonicalPublicationCanaryReport(reordered),
    ).toBe(result.canonicalReport)
    expect(reportContract.publicationCanaryReportSha256(reordered)).toBe(
      result.reportSha256,
    )
    expect(() =>
      reportContract.serializeCanonicalPublicationCanaryReport({
        ...result.report,
        token: "must-not-be-accepted",
      } as PublicationCanaryReport),
    ).toThrow(reportContract.PublicationCanaryReportContractError)
  })

  test("binds DNS, TLS, challenge, and HTTP observations to the exact tenant hostname", async () => {
    const calls: string[] = []
    const result = await runner.runPublicationCanary(
      TARGET,
      createDependencies(calls, {
        async observeDns() {
          calls.push("dns")
          return {
            hostname: "sibling.creatorshare.com",
            resolved: true,
            providerTargetMatched: true,
            recordTypes: ["A"],
            answerCount: 1,
            observedAt: OBSERVED_AT,
          }
        },
      }),
    )

    expect(result.report).toMatchObject({
      outcome: "failed",
      error_code: "dns_exact_host_failed",
    })
    expect(result.report.steps).toHaveLength(1)
    expect(calls).toEqual(["dns"])
  })

  test("generates a high-entropy valid sibling and proves it has no provisioned row before HTTP", async () => {
    const calls: string[] = []
    const result = await runner.runPublicationCanary(
      TARGET,
      createDependencies(calls, {
        async isHostnameProvisioned(hostname) {
          calls.push(`sibling:lookup:${hostname}`)
          return true
        },
      }),
    )

    expect(result.report).toMatchObject({
      outcome: "failed",
      error_code: "unprovisioned_sibling_not_hidden",
    })
    expect(calls).toContain(`sibling:lookup:${SIBLING_HOSTNAME}`)
    expect(calls).not.toContain("http:unprovisioned_sibling_root")
    expect(calls).not.toContain("payment:stripe_us")
  })

  test("requires byte-identical generic 404s and stores only their digest", async () => {
    const calls: string[] = []
    const result = await runner.runPublicationCanary(
      TARGET,
      createDependencies(calls, {
        async requestHttp(request) {
          calls.push(`http:${request.kind}`)
          if (request.kind === "protected_exact_host_challenge") {
            return httpResponse({
              request,
              status: 200,
              body: CHALLENGE_BODY,
              contentType: "application/json",
            })
          }
          return httpResponse({
            request,
            status: 404,
            body:
              request.kind === "verifying_tenant_root"
                ? new TextEncoder().encode("Not Found")
                : new TextEncoder().encode("Not FounD"),
            contentType: "text/plain; charset=utf-8",
          })
        },
      }),
    )

    expect(result.report).toMatchObject({
      outcome: "failed",
      error_code: "unprovisioned_sibling_not_hidden",
    })
    expect(result.canonicalReport).not.toContain("Not Found")
    expect(result.canonicalReport).not.toContain("Not FounD")
    expect(calls).not.toContain("payment:stripe_us")
  })

  test("fails closed when a bounded challenge or generic response body is exceeded", async () => {
    for (const scenario of ["challenge", "tenant-root"] as const) {
      const calls: string[] = []
      const result = await runner.runPublicationCanary(
        TARGET,
        createDependencies(calls, {
          async requestHttp(request) {
            calls.push(`http:${request.kind}`)
            if (request.kind === "protected_exact_host_challenge") {
              return httpResponse({
                request,
                status: 200,
                body:
                  scenario === "challenge"
                    ? new Uint8Array(4_097)
                    : CHALLENGE_BODY,
                contentType: "application/json",
              })
            }
            return httpResponse({
              request,
              status: 404,
              body:
                scenario === "tenant-root"
                  ? new Uint8Array(32_769)
                  : GENERIC_NOT_FOUND,
              contentType: "text/plain; charset=utf-8",
            })
          },
        }),
      )

      expect(result.report.outcome).toBe("failed")
      expect(result.report.error_code).toBe(
        scenario === "challenge"
          ? "protected_exact_host_challenge_failed"
          : "verifying_tenant_root_not_hidden",
      )
      expect(calls).not.toContain("payment:stripe_us")
      if (scenario === "challenge") {
        expect(calls).not.toContain("challenge:verify")
        expect(calls).not.toContain("http:verifying_tenant_root")
      } else {
        expect(calls).not.toContain("random:16")
      }
    }
  })

  const failureStages: readonly {
    step: PublicationCanaryStepName
    errorCode: string
    overrides(calls: string[]): Partial<PublicationCanaryRunnerDependencies>
    forbiddenLaterCall: string
  }[] = [
    {
      step: "dns_exact_host",
      errorCode: "dns_exact_host_failed",
      overrides: (calls) => ({
        async observeDns() {
          calls.push("dns:failed")
          throw new Error("resolver secret detail")
        },
      }),
      forbiddenLaterCall: "tls",
    },
    {
      step: "tls_exact_host",
      errorCode: "tls_exact_host_failed",
      overrides: (calls) => ({
        async inspectTls() {
          calls.push("tls:failed")
          throw new Error("certificate provider detail")
        },
      }),
      forbiddenLaterCall: "challenge:create",
    },
    {
      step: "protected_exact_host_challenge",
      errorCode: "protected_exact_host_challenge_failed",
      overrides: (calls) => ({
        createProtectedChallenge() {
          calls.push("challenge:create:failed")
          throw new Error("token secret detail")
        },
      }),
      forbiddenLaterCall: "http:verifying_tenant_root",
    },
    {
      step: "verifying_tenant_root_hidden",
      errorCode: "verifying_tenant_root_not_hidden",
      overrides: (calls) => ({
        async requestHttp(request) {
          calls.push(`http:${request.kind}`)
          if (request.kind === "protected_exact_host_challenge") {
            return httpResponse({
              request,
              status: 200,
              body: CHALLENGE_BODY,
              contentType: "application/json",
            })
          }
          return httpResponse({
            request,
            status: 200,
            body: new TextEncoder().encode("portal leaked"),
            contentType: "text/html",
          })
        },
      }),
      forbiddenLaterCall: "random:16",
    },
    {
      step: "unprovisioned_sibling_hidden",
      errorCode: "unprovisioned_sibling_not_hidden",
      overrides: (calls) => ({
        async isHostnameProvisioned() {
          calls.push("sibling:lookup:failed")
          throw new Error("database secret detail")
        },
      }),
      forbiddenLaterCall: "payment:stripe_us",
    },
    {
      step: "stripe_us_payment_canary",
      errorCode: "stripe_us_payment_canary_failed",
      overrides: (calls) => ({
        async runStripeUsPaymentCanary() {
          calls.push("payment:stripe_us:failed")
          throw new Error("sk_live_provider_detail")
        },
      }),
      forbiddenLaterCall: "payment:stripe_uk",
    },
    {
      step: "stripe_uk_payment_canary",
      errorCode: "stripe_uk_payment_canary_failed",
      overrides: (calls) => ({
        async runStripeUkPaymentCanary() {
          calls.push("payment:stripe_uk:failed")
          throw new Error("sk_live_provider_detail")
        },
      }),
      forbiddenLaterCall: "payment:paypal",
    },
    {
      step: "paypal_payment_canary",
      errorCode: "paypal_payment_canary_failed",
      overrides: (calls) => ({
        async runPayPalPaymentCanary() {
          calls.push("payment:paypal:failed")
          throw new Error("payer email provider detail")
        },
      }),
      forbiddenLaterCall: "after:paypal",
    },
  ]

  for (const [index, failure] of failureStages.entries()) {
    test(`returns only static evidence and stops after ${failure.step} failure`, async () => {
      const calls: string[] = []
      const result = await runner.runPublicationCanary(
        TARGET,
        createDependencies(calls, failure.overrides(calls)),
      )

      expect(result.report).toMatchObject({
        outcome: "failed",
        error_code: failure.errorCode,
      })
      expect(result.report.steps).toHaveLength(index + 1)
      expect(result.report.steps.at(-1)).toEqual(
        expect.objectContaining({
          name: failure.step,
          outcome: "failed",
          evidence: {
            schema_version: 1,
            failure_code: failure.errorCode,
          },
        }),
      )
      expect(calls).not.toContain(failure.forbiddenLaterCall)
      for (const unsafe of [
        "resolver secret detail",
        "certificate provider detail",
        "token secret detail",
        "database secret detail",
        "sk_live_provider_detail",
        "payer email provider detail",
      ]) {
        expect(result.canonicalReport).not.toContain(unsafe)
      }
    })
  }

  test("rejects malformed server-derived bindings before any dependency call", async () => {
    const calls: string[] = []
    await expect(
      runner.runPublicationCanary(
        { ...TARGET, hostname: "HOPE.creatorshare.com" },
        createDependencies(calls),
      ),
    ).rejects.toThrow(runner.PublicationCanaryRunnerInputError)
    expect(calls).toEqual([])

    await expect(
      runner.runPublicationCanary(
        {
          ...TARGET,
          paymentAttemptIds: {
            ...TARGET.paymentAttemptIds,
            stripeUk: TARGET.paymentAttemptIds.stripeUs,
          },
        },
        createDependencies(calls),
      ),
    ).rejects.toThrow(runner.PublicationCanaryRunnerInputError)
    expect(calls).toEqual([])
  })

  test("fails challenge verification on a sibling final URL and never sends a later request", async () => {
    const calls: string[] = []
    const result = await runner.runPublicationCanary(
      TARGET,
      createDependencies(calls, {
        async requestHttp(request) {
          calls.push(`http:${request.kind}`)
          return httpResponse({
            request,
            status: 200,
            body: CHALLENGE_BODY,
            contentType: "application/json",
            finalUrl: `https://sibling.creatorshare.com/.well-known/creator-share/advocate-publication-canary`,
          })
        },
      }),
    )

    expect(result.report.error_code).toBe(
      "protected_exact_host_challenge_failed",
    )
    expect(calls).not.toContain("challenge:verify")
    expect(calls).not.toContain("http:verifying_tenant_root")
  })
})
