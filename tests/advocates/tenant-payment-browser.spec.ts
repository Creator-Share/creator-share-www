import { expect, test } from "@playwright/test"

const devPort = process.env.PLAYWRIGHT_DEV_PORT ?? "3000"
const tenantOrigin = `http://payment-shell-e2e.localhost:${devPort}`

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
