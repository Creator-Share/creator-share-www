import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { once } from "node:events"
import { rm } from "node:fs/promises"
import { createServer } from "node:net"
import { resolve } from "node:path"

import {
  expect,
  test,
  type Browser,
  type Page,
  type Route,
} from "@playwright/test"

const devPort = process.env.PLAYWRIGHT_DEV_PORT ?? "3000"
const tenantOrigin = `http://payment-shell-e2e.localhost:${devPort}`
const workspace = process.cwd()
const checkoutHarnessDirectory = resolve(
  workspace,
  "tests/fixtures/advocate-checkout-harness",
)
const nextExecutable = resolve(workspace, "node_modules/next/dist/bin/next")
const beneficiaryId = "11111111-1111-4111-8111-111111111111"
const sponsorEmail = "browser-parity@example.test"
const checkoutOperationStorageKey =
  "creator-share:sponsorship-checkout-operation:v1"
const checkoutReceiptStorageKey =
  "creator-share:sponsorship-checkout-receipt:v1"
const stripeReceipt = Buffer.alloc(32, 11).toString("base64url")
const paypalReceipt = Buffer.alloc(32, 13).toString("base64url")
const stripeProviderUrl =
  "https://checkout.stripe.com/c/pay/cs_test_browser_parity"
const paypalProviderUrl =
  "https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=browser-parity"
const uuidV4Pattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

let checkoutHarnessProcess: ChildProcessWithoutNullStreams | null = null
let checkoutHarnessOutput = ""
let checkoutHarnessBuildDirectory = ""
let primaryCheckoutHarnessOrigin = ""
let tenantCheckoutHarnessOrigin = ""

function checkoutHarnessEnv(distDirectory: string) {
  return {
    ...process.env,
    CHECKOUT_HARNESS_DIST_DIR: distDirectory,
    NEXT_PUBLIC_PAYPAL_CLIENT_ID: "checkout-harness-client",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "checkout-harness-anon-key",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_TELEMETRY_DISABLED: "1",
  }
}

interface BrowserCheckoutObservation {
  body: Record<string, unknown>
  headers: Record<string, string>
  operation: Record<string, unknown>
  receipt: Record<string, unknown>
  sessionStorage: Record<string, string>
  localStorage: Record<string, string>
}

interface ProviderNavigationObservation {
  isNavigationRequest: boolean
  resourceType: string
}

function reservePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.unref()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        server.close()
        reject(new Error("checkout_harness_port_unavailable"))
        return
      }
      const port = address.port
      server.close((error) => {
        if (error) reject(error)
        else resolvePort(port)
      })
    })
  })
}

async function waitForCheckoutHarness(origin: string): Promise<void> {
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    if (
      checkoutHarnessProcess?.exitCode !== null ||
      checkoutHarnessProcess?.signalCode !== null
    ) {
      throw new Error(
        `checkout_harness_exited\n${checkoutHarnessOutput.slice(-8_000)}`,
      )
    }
    try {
      const response = await fetch(origin)
      if (response.ok) return
    } catch {
      // The isolated Next.js fixture is still compiling.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 150))
  }
  throw new Error(
    `checkout_harness_start_timeout\n${checkoutHarnessOutput.slice(-8_000)}`,
  )
}

async function stopCheckoutHarness(): Promise<void> {
  const child = checkoutHarnessProcess
  checkoutHarnessProcess = null
  if (!child || child.exitCode !== null || child.signalCode !== null) return

  child.kill("SIGTERM")
  await Promise.race([
    once(child, "exit"),
    new Promise((resolveWait) => setTimeout(resolveWait, 5_000)),
  ])
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL")
    await once(child, "exit")
  }
}

/**
 * Observes the browser's outbound provider navigation and aborts it so the
 * suite never leaves the app origin. The navigation must be aborted as soon as
 * it is seen: while a main-frame navigation is pending, page.evaluate blocks,
 * so a held navigation would deadlock the storage read that follows.
 */
async function interceptProviderNavigation(
  page: Page,
  expectedUrl: string,
): Promise<{ requestSeen: Promise<ProviderNavigationObservation> }> {
  // Resolving on requestfailed rather than inside the route handler means the
  // abort has already landed, so the page is no longer mid-navigation and
  // subsequent locator and evaluate calls run against the original document.
  const requestSeen = page
    .waitForEvent("requestfailed", (request) => request.url() === expectedUrl)
    .then((request) => ({
      isNavigationRequest: request.isNavigationRequest(),
      resourceType: request.resourceType(),
    }))

  // "aborted" maps to net::ERR_ABORTED, which Chromium does not commit as an
  // error document, so the app page survives for the storage assertions.
  // "blockedbyclient" would replace the document and erase the evidence.
  await page.route(expectedUrl, (route: Route) => route.abort("aborted"))

  return { requestSeen }
}

async function browserStorage(
  page: Page,
): Promise<
  Pick<
    BrowserCheckoutObservation,
    "localStorage" | "operation" | "receipt" | "sessionStorage"
  >
> {
  return page.evaluate(
    ({ operationKey, receiptKey }) => {
      const readStorage = (storage: Storage) =>
        Object.fromEntries(
          Array.from({ length: storage.length }, (_, index) => {
            const key = storage.key(index)
            return key === null
              ? null
              : ([key, storage.getItem(key) ?? ""] as const)
          }).filter(
            (entry): entry is readonly [string, string] => entry !== null,
          ),
        )
      const session = readStorage(window.sessionStorage)
      return {
        localStorage: readStorage(window.localStorage),
        operation: JSON.parse(session[operationKey] ?? "null") as Record<
          string,
          unknown
        >,
        receipt: JSON.parse(session[receiptKey] ?? "null") as Record<
          string,
          unknown
        >,
        sessionStorage: session,
      }
    },
    {
      operationKey: checkoutOperationStorageKey,
      receiptKey: checkoutReceiptStorageKey,
    },
  )
}

async function installCheckoutPageSeams(page: Page, origin: string) {
  await page.route(`${origin}/api/payments/currency`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ currency: "USD" }),
    }),
  )
  await page.route(
    `${origin}/api/beneficiaries/images/${beneficiaryId}`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "[]",
      }),
  )
}

async function runBrowserCheckout(
  browser: Browser,
  origin: string,
  provider: "paypal" | "stripe",
): Promise<BrowserCheckoutObservation> {
  const context = await browser.newContext()
  const page = await context.newPage()
  const providerUrl =
    provider === "stripe" ? stripeProviderUrl : paypalProviderUrl
  const receipt = provider === "stripe" ? stripeReceipt : paypalReceipt
  const providerNavigation = await interceptProviderNavigation(
    page,
    providerUrl,
  )
  let body: Record<string, unknown> | null = null
  let headers: Record<string, string> | null = null

  try {
    await installCheckoutPageSeams(page, origin)
    await page.route(`${origin}/api/${provider}`, async (route) => {
      body = route.request().postDataJSON() as Record<string, unknown>
      headers = await route.request().allHeaders()
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          provider === "stripe"
            ? { checkoutReceipt: receipt, url: providerUrl }
            : { approvalUrl: providerUrl, checkoutReceipt: receipt },
        ),
      })
    })

    // The modal is server-rendered; typing before hydration is lost when the
    // controlled email input re-binds to React state. The currency request
    // only fires from a mount effect, so it proves the client is interactive.
    const hydrated = page.waitForResponse(`${origin}/api/payments/currency`)
    const response = await page.goto(origin, { waitUntil: "domcontentloaded" })
    expect(response?.status()).toBe(200)
    await expect(page.getByRole("dialog")).toBeVisible()
    await hydrated
    await page.getByPlaceholder("you@example.com").fill(sponsorEmail)

    if (provider === "stripe") {
      await page
        .getByRole("button", { name: /Sponsor Amina/ })
        .click({ noWaitAfter: true })
    } else {
      await page
        .getByRole("button", { name: "Continue with PayPal" })
        .click({ noWaitAfter: true })
    }

    const navigation = await providerNavigation.requestSeen
    expect(navigation.isNavigationRequest).toBe(true)
    expect(navigation.resourceType).toBe("document")

    // The aborted provider navigation keeps the original document, but its
    // discarded provisional context can transiently fail page.evaluate.
    await expect(page.getByRole("dialog")).toBeVisible()
    let storage: Awaited<ReturnType<typeof browserStorage>> | null = null
    for (let attempt = 0; storage === null; attempt += 1) {
      try {
        storage = await browserStorage(page)
      } catch (error) {
        if (attempt >= 4) throw error
        await page.waitForTimeout(100)
      }
    }
    if (body === null || headers === null) {
      throw new Error("checkout_browser_request_not_observed")
    }

    return { body, headers, ...storage }
  } finally {
    await context.close()
  }
}

function checkoutPayloadWithoutOperation(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const { checkoutRequestId: _checkoutRequestId, ...rest } = body
  return rest
}

function assertBrowserCheckout(
  observation: BrowserCheckoutObservation,
  origin: string,
  provider: "paypal" | "stripe",
): void {
  const expectedReceipt = provider === "stripe" ? stripeReceipt : paypalReceipt
  const operationId = observation.body.checkoutRequestId

  expect(operationId).toEqual(expect.stringMatching(uuidV4Pattern))
  // Origin and Referer both pinned to the page origin prove the initiation is
  // a same-origin request issued by the app document itself. Sec-Fetch-* is
  // added by the network service after route interception, so it is never
  // observable here.
  expect(observation.headers.origin).toBe(origin)
  expect(observation.headers.referer).toBe(`${origin}/`)
  expect(observation.headers["content-type"]).toContain("application/json")
  expect(observation.body).toMatchObject({
    amount: 3_300,
    beneficiaryId,
    checkoutRequestId: operationId,
    currency: "USD",
    email: sponsorEmail,
    paymentType: "subscription",
    type: "sponsorship",
  })
  if (provider === "paypal") {
    expect(observation.body).toMatchObject({ action: "start" })
    expect(Object.keys(observation.body).sort()).toEqual([
      "action",
      "amount",
      "beneficiaryId",
      "checkoutRequestId",
      "currency",
      "email",
      "paymentType",
      "type",
    ])
  }

  expect(observation.operation).toMatchObject({
    createdAt: expect.any(String),
    operationId,
    scope: {
      baseAmountUsdCents: 3_300,
      beneficiaryId,
      currency: "USD",
      partnershipProject: null,
      paymentType: "subscription",
      provider,
      subject: "standard",
    },
    version: 1,
  })
  expect(observation.receipt).toMatchObject({
    operationId,
    provider,
    receipt: expectedReceipt,
    storedAt: expect.any(String),
    version: 1,
  })

  const serializedStorage = JSON.stringify({
    local: observation.localStorage,
    session: observation.sessionStorage,
  })
  expect(serializedStorage).not.toContain(sponsorEmail)
  expect(serializedStorage).not.toContain(stripeProviderUrl)
  expect(serializedStorage).not.toContain(paypalProviderUrl)
}

async function buildCheckoutHarness(distDirectory: string): Promise<void> {
  const build = spawn(
    process.execPath,
    [nextExecutable, "build", checkoutHarnessDirectory],
    {
      cwd: workspace,
      env: checkoutHarnessEnv(distDirectory),
      stdio: "pipe",
    },
  )
  build.stdout.on("data", (chunk: Buffer) => {
    checkoutHarnessOutput += chunk.toString()
  })
  build.stderr.on("data", (chunk: Buffer) => {
    checkoutHarnessOutput += chunk.toString()
  })
  const [exitCode] = (await once(build, "exit")) as [number | null]
  if (exitCode !== 0) {
    throw new Error(
      `checkout_harness_build_failed\n${checkoutHarnessOutput.slice(-8_000)}`,
    )
  }
}

test.beforeAll(async ({}, workerInfo) => {
  // Production build + start: `next dev` compiles lazily and can serve
  // transient manifest 500s, and its error overlay matches role=dialog.
  test.setTimeout(300_000)
  checkoutHarnessOutput = ""
  // A worker-scoped build directory keeps parallel workers from corrupting a
  // shared .next while another worker is still writing it.
  const distDirectory = `.next-worker-${workerInfo.workerIndex}`
  checkoutHarnessBuildDirectory = resolve(
    checkoutHarnessDirectory,
    distDirectory,
  )
  await rm(checkoutHarnessBuildDirectory, { recursive: true, force: true })
  await buildCheckoutHarness(distDirectory)
  const port = await reservePort()
  primaryCheckoutHarnessOrigin = `http://localhost:${port}`
  tenantCheckoutHarnessOrigin = `http://checkout-parity.localhost:${port}`

  checkoutHarnessProcess = spawn(
    process.execPath,
    [
      nextExecutable,
      "start",
      checkoutHarnessDirectory,
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      cwd: workspace,
      env: checkoutHarnessEnv(distDirectory),
      stdio: "pipe",
    },
  )
  checkoutHarnessProcess.stdout.on("data", (chunk: Buffer) => {
    checkoutHarnessOutput += chunk.toString()
  })
  checkoutHarnessProcess.stderr.on("data", (chunk: Buffer) => {
    checkoutHarnessOutput += chunk.toString()
  })

  try {
    await waitForCheckoutHarness(primaryCheckoutHarnessOrigin)
  } catch (error) {
    await stopCheckoutHarness()
    await rm(checkoutHarnessBuildDirectory, { recursive: true, force: true })
    throw error
  }
})

test.afterAll(async () => {
  try {
    await stopCheckoutHarness()
  } finally {
    await rm(checkoutHarnessBuildDirectory, { recursive: true, force: true })
  }
})

test("applies Host policy before the legacy catalog redirect", async ({
  request,
}) => {
  const trackingQuery = "utm_source=creator&tag=one&tag=two"
  const tenant = await request.get(
    `${tenantOrigin}/sponsorships?${trackingQuery}`,
    {
      maxRedirects: 0,
    },
  )
  expect(tenant.status()).toBe(308)
  expect(tenant.headers().location).toBe(`/?${trackingQuery}`)
  expect(tenant.headers()["cache-control"]).toContain("no-store")
  expect(tenant.headers()["content-security-policy"]).toBe(
    "frame-ancestors 'none'",
  )

  const primary = await request.get(
    `http://localhost:${devPort}/sponsorships?${trackingQuery}`,
    {
      maxRedirects: 0,
    },
  )
  expect(primary.status()).toBe(308)
  expect(primary.headers().location).toBe(`/?${trackingQuery}`)

  for (const host of [
    `admin.localhost:${devPort}`,
    `nested.hope.localhost:${devPort}`,
    "unapproved.example",
  ]) {
    const denied = await request.get(
      `http://localhost:${devPort}/sponsorships`,
      {
        headers: { host },
        maxRedirects: 0,
      },
    )
    expect(denied.status(), host).toBe(404)
    expect(denied.headers().location, host).toBeUndefined()
  }
})

test("keeps tenant payment results neutral and exits with a document navigation", async ({
  page,
}) => {
  const requestedUrls: string[] = []
  page.on("request", (request) => requestedUrls.push(request.url()))

  const response = await page.goto(`${tenantOrigin}/payments/failed`, {
    waitUntil: "networkidle",
  })

  expect(response?.status()).toBe(200)
  expect(response?.headers()["content-security-policy"]).toBe(
    "frame-ancestors 'none'",
  )
  expect(response?.headers()["x-frame-options"]).toBe("DENY")
  await expect(page.locator('[data-public-site-kind="payment"]')).toBeVisible()
  await expect(page.locator("nav")).toHaveCount(0)
  expect(
    requestedUrls.filter(
      (url) =>
        url.includes("/auth/v1/") ||
        url.includes("/_vercel/insights") ||
        url.includes("/api/advocates/exposure"),
    ),
  ).toEqual([])

  await page.route(`${tenantOrigin}/sponsorships`, (route) => route.abort())
  const documentRequest = page.waitForRequest(
    (request) =>
      request.isNavigationRequest() &&
      request.url() === `${tenantOrigin}/sponsorships`,
  )
  await page
    .getByRole("button", { name: "Return to sponsorships" })
    .click({ noWaitAfter: true })

  expect((await documentRequest).resourceType()).toBe("document")
})

test("keeps Stripe and PayPal browser initiation identical on primary and advocate origins", async ({
  browser,
}) => {
  // Four full browser checkouts share this test: two providers on two origins.
  test.setTimeout(120_000)
  for (const provider of ["stripe", "paypal"] as const) {
    const primary = await runBrowserCheckout(
      browser,
      primaryCheckoutHarnessOrigin,
      provider,
    )
    const tenant = await runBrowserCheckout(
      browser,
      tenantCheckoutHarnessOrigin,
      provider,
    )

    assertBrowserCheckout(primary, primaryCheckoutHarnessOrigin, provider)
    assertBrowserCheckout(tenant, tenantCheckoutHarnessOrigin, provider)
    expect(checkoutPayloadWithoutOperation(tenant.body)).toEqual(
      checkoutPayloadWithoutOperation(primary.body),
    )
    expect(tenant.body.checkoutRequestId).not.toBe(
      primary.body.checkoutRequestId,
    )
  }
})

test("confirms an opaque tenant payment return and clears its bearer state", async ({
  page,
}) => {
  const operationId = "11111111-1111-4111-8111-111111111111"
  await page.goto(`${tenantOrigin}/payments/failed`, {
    waitUntil: "domcontentloaded",
  })
  await page.evaluate(
    ({ operationKey, receiptKey, operation, receipt }) => {
      window.sessionStorage.setItem(
        operationKey,
        JSON.stringify({
          version: 1,
          operationId: operation,
          createdAt: new Date().toISOString(),
          scope: {
            provider: "stripe",
            subject: "standard",
            beneficiaryId: "11111111-1111-4111-8111-111111111111",
            partnershipProject: null,
            paymentType: "subscription",
            baseAmountUsdCents: 3_300,
            currency: "USD",
          },
        }),
      )
      window.sessionStorage.setItem(
        receiptKey,
        JSON.stringify({
          version: 1,
          provider: "stripe",
          receipt,
          operationId: operation,
          storedAt: new Date().toISOString(),
        }),
      )
    },
    {
      operationKey: checkoutOperationStorageKey,
      receiptKey: checkoutReceiptStorageKey,
      operation: operationId,
      receipt: stripeReceipt,
    },
  )

  let statusRequestBody: unknown = null
  await page.route(
    `${tenantOrigin}/api/sponsorships/checkout-status`,
    async (route) => {
      statusRequestBody = route.request().postDataJSON()
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "succeeded", terminal: true }),
      })
    },
  )
  const response = await page.goto(`${tenantOrigin}/payments/success`, {
    waitUntil: "domcontentloaded",
  })

  expect(response?.status()).toBe(200)
  await expect(
    page.getByRole("heading", { name: "Thank You for Changing a Life!" }),
  ).toBeVisible()
  expect(statusRequestBody).toEqual({ receipt: stripeReceipt })
  expect(
    await page.evaluate(
      ({ operationKey, receiptKey }) => ({
        operation: window.sessionStorage.getItem(operationKey),
        receipt: window.sessionStorage.getItem(receiptKey),
      }),
      {
        operationKey: checkoutOperationStorageKey,
        receiptKey: checkoutReceiptStorageKey,
      },
    ),
  ).toEqual({ operation: null, receipt: null })
  await expect(page.locator('[data-public-site-kind="payment"]')).toBeVisible()
  await expect(page.locator("nav")).toHaveCount(0)
})
