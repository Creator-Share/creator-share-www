import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"
import { NextRequest } from "next/server"

type GatewayRoute =
  typeof import("../../src/app/api/internal/payments/gateway-events/route")
type WelcomeRoute =
  typeof import("../../src/app/api/internal/sponsorships/welcome-emails/route")
type CancellationRoute =
  typeof import("../../src/app/api/internal/sponsorships/subscription-cancellations/route")
type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown

const gatewayHealthy = Object.freeze({
  claimed: 0,
  applied: 0,
  ignored: 0,
  retried: 0,
  terminalFailed: 0,
  leaseLost: 0,
  settlementUnknown: 0,
  contactErasure: Object.freeze({
    erased: 0,
    succeeded: 0,
    failed: 0,
    cancelled: 0,
    expired: 0,
  }),
  results: Object.freeze([]),
})
const welcomeHealthy = Object.freeze({
  claimed: 0,
  sent: 0,
  retried: 0,
  terminalFailed: 0,
  leaseLost: 0,
  manualReview: 0,
  settlementUnknown: 0,
  results: Object.freeze([]),
})
const cancellationHealthy = Object.freeze({
  candidates: 0,
  cancelled: 0,
  retryScheduled: 0,
  manualReview: 0,
  alreadyProcessing: 0,
  deferred: 0,
  claimFailed: 0,
  settlementUnknown: 0,
  results: Object.freeze([]),
})

let gatewayResult: object | Error = gatewayHealthy
let welcomeResult: object | Error = welcomeHealthy
let cancellationResult: object | Error = cancellationHealthy

function resolveResult(value: object | Error): object {
  if (value instanceof Error) throw value
  return value
}

const nodeModule = Module as unknown as { _load: NodeModuleLoader }
const originalModuleLoad = nodeModule._load
nodeModule._load = function mockedModuleLoad(
  this: unknown,
  request: string,
  parent: unknown,
  isMain: boolean,
) {
  if (request === "server-only") return {}
  if (request === "@/lib/sponsorships/gateways/paymentGatewayEventAuth") {
    return { isAuthorizedPaymentGatewayEventWorkerRequest: () => true }
  }
  if (request === "@/lib/sponsorships/gateways/paymentGatewayEventConfig") {
    return {
      loadPaymentGatewayEventWorkerConfig: () => ({}),
      loadPaymentGatewayEventWorkerSecret: () => "g".repeat(32),
    }
  }
  if (request === "@/lib/sponsorships/gateways/paymentGatewayEventRuntime") {
    return {
      runPaymentGatewayEventBatchFromEnvironment: async () =>
        resolveResult(gatewayResult),
    }
  }
  if (request === "@/lib/sponsorships/email/sponsorWelcomeEmailAuth") {
    return { isAuthorizedSponsorWelcomeEmailWorkerRequest: () => true }
  }
  if (request === "@/lib/sponsorships/email/sponsorWelcomeEmailConfig") {
    return {
      loadSponsorWelcomeEmailWorkerConfig: () => ({}),
      loadSponsorWelcomeEmailWorkerSecret: () => "w".repeat(32),
    }
  }
  if (request === "@/lib/sponsorships/email/sponsorWelcomeEmailRuntime") {
    return {
      runSponsorWelcomeEmailBatchFromEnvironment: async () =>
        resolveResult(welcomeResult),
    }
  }
  if (
    request ===
    "@/lib/sponsorships/cancellation/subscriptionCancellationWorkerAuth"
  ) {
    return { isAuthorizedSubscriptionCancellationWorkerRequest: () => true }
  }
  if (
    request ===
    "@/lib/sponsorships/cancellation/subscriptionCancellationWorkerConfig"
  ) {
    return {
      loadSubscriptionCancellationWorkerConfig: () => ({}),
      loadSubscriptionCancellationWorkerSecret: () => "c".repeat(32),
    }
  }
  if (
    request ===
    "@/lib/sponsorships/cancellation/subscriptionCancellationWorkerRuntime"
  ) {
    return {
      runSubscriptionCancellationWorkerBatchFromEnvironment: async () =>
        resolveResult(cancellationResult),
    }
  }
  return originalModuleLoad.call(this, request, parent, isMain)
}

const testRequire = createRequire(
  resolve(process.cwd(), "tests/sponsorships/worker-route-health.spec.ts"),
)
const gatewayRoute = testRequire(
  resolve(
    process.cwd(),
    "src/app/api/internal/payments/gateway-events/route.ts",
  ),
) as GatewayRoute
const welcomeRoute = testRequire(
  resolve(
    process.cwd(),
    "src/app/api/internal/sponsorships/welcome-emails/route.ts",
  ),
) as WelcomeRoute
const cancellationRoute = testRequire(
  resolve(
    process.cwd(),
    "src/app/api/internal/sponsorships/subscription-cancellations/route.ts",
  ),
) as CancellationRoute
nodeModule._load = originalModuleLoad

function request(path: string): NextRequest {
  return new NextRequest(`https://creatorshare.com${path}`, {
    headers: { authorization: `Bearer ${"x".repeat(32)}` },
  })
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>
}

let errorCalls: unknown[][] = []
const originalConsoleError = console.error

test.beforeEach(() => {
  gatewayResult = gatewayHealthy
  welcomeResult = welcomeHealthy
  cancellationResult = cancellationHealthy
  errorCalls = []
  console.error = (...args: unknown[]) => {
    errorCalls.push(args)
  }
})

test.afterEach(() => {
  console.error = originalConsoleError
})

test("healthy scheduled worker batches remain clean 200 responses", async () => {
  for (const response of [
    await gatewayRoute.GET(request("/api/internal/payments/gateway-events")),
    await welcomeRoute.GET(
      request("/api/internal/sponsorships/welcome-emails"),
    ),
    await cancellationRoute.GET(
      request("/api/internal/sponsorships/subscription-cancellations"),
    ),
  ]) {
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toContain("no-store")
    expect(await body(response)).toMatchObject({ ok: true })
  }
  expect(errorCalls).toEqual([])
})

test("gateway terminal and uncertain settlements fail the invocation visibly", async () => {
  for (const counts of [
    { terminalFailed: 1, settlementUnknown: 0 },
    { terminalFailed: 0, settlementUnknown: 1 },
  ]) {
    errorCalls = []
    gatewayResult = { ...gatewayHealthy, ...counts }
    const response = await gatewayRoute.GET(
      request("/api/internal/payments/gateway-events"),
    )
    expect(response.status).toBe(503)
    expect(await body(response)).toMatchObject({
      ok: false,
      code: "worker_batch_incomplete",
      ...counts,
    })
    expect(errorCalls).toEqual([
      [
        "PAYMENT_GATEWAY_EVENT_WORKER_REQUIRES_ATTENTION",
        expect.objectContaining({ code: "worker_batch_incomplete", ...counts }),
      ],
    ])
  }
})

test("welcome terminal, manual, and uncertain results fail visibly", async () => {
  for (const counts of [
    { terminalFailed: 1, manualReview: 0, settlementUnknown: 0 },
    { terminalFailed: 0, manualReview: 1, settlementUnknown: 0 },
    { terminalFailed: 0, manualReview: 0, settlementUnknown: 1 },
  ]) {
    errorCalls = []
    welcomeResult = { ...welcomeHealthy, ...counts }
    const response = await welcomeRoute.GET(
      request("/api/internal/sponsorships/welcome-emails"),
    )
    expect(response.status).toBe(503)
    expect(await body(response)).toMatchObject({
      ok: false,
      code: "worker_batch_incomplete",
      ...counts,
    })
    expect(errorCalls).toEqual([
      [
        "SPONSOR_WELCOME_EMAIL_WORKER_REQUIRES_ATTENTION",
        expect.objectContaining({ code: "worker_batch_incomplete", ...counts }),
      ],
    ])
  }
})

test("cancellation manual, claim, and uncertain results fail visibly", async () => {
  for (const counts of [
    { manualReview: 1, claimFailed: 0, settlementUnknown: 0 },
    { manualReview: 0, claimFailed: 1, settlementUnknown: 0 },
    { manualReview: 0, claimFailed: 0, settlementUnknown: 1 },
  ]) {
    errorCalls = []
    cancellationResult = { ...cancellationHealthy, ...counts }
    const response = await cancellationRoute.GET(
      request("/api/internal/sponsorships/subscription-cancellations"),
    )
    expect(response.status).toBe(503)
    expect(await body(response)).toMatchObject({
      ok: false,
      code: "worker_batch_incomplete",
      ...counts,
    })
    expect(errorCalls).toEqual([
      [
        "SUBSCRIPTION_CANCELLATION_WORKER_REQUIRES_ATTENTION",
        expect.objectContaining({ code: "worker_batch_incomplete", ...counts }),
      ],
    ])
  }
})

test("unexpected worker failures emit static attention signals", async () => {
  gatewayResult = new Error("sensitive gateway detail")
  welcomeResult = new Error("sensitive email detail")
  cancellationResult = new Error("sensitive cancellation detail")

  for (const [route, path, code] of [
    [
      gatewayRoute,
      "/api/internal/payments/gateway-events",
      "PAYMENT_GATEWAY_EVENT_WORKER_REQUIRES_ATTENTION",
    ],
    [
      welcomeRoute,
      "/api/internal/sponsorships/welcome-emails",
      "SPONSOR_WELCOME_EMAIL_WORKER_REQUIRES_ATTENTION",
    ],
    [
      cancellationRoute,
      "/api/internal/sponsorships/subscription-cancellations",
      "SUBSCRIPTION_CANCELLATION_WORKER_REQUIRES_ATTENTION",
    ],
  ] as const) {
    const response = await route.GET(request(path))
    expect(response.status).toBe(503)
    const payload = await body(response)
    expect(payload).toMatchObject({
      ok: false,
      code: "worker_execution_failed",
    })
    expect(JSON.stringify(payload)).not.toContain("sensitive")
    expect(errorCalls.at(-1)).toEqual([
      code,
      expect.objectContaining({ code: "worker_execution_failed" }),
    ])
  }
})
