import { expect, test } from "@playwright/test"

const TOKEN_HASH = "b".repeat(48)

test("a fresh cookie jar explicitly confirms one scrubbed token hash", async ({
  baseURL,
  browser,
}) => {
  expect(baseURL).toBeTruthy()
  const origin = new URL(baseURL!).origin
  const initiationContext = await browser.newContext()
  await initiationContext.addCookies([
    {
      name: "browser_bound_pkce_verifier",
      value: "present-only-in-the-initiation-browser",
      url: origin,
      httpOnly: true,
      sameSite: "Lax",
    },
  ])

  const confirmationContext = await browser.newContext()
  const page = await confirmationContext.newPage()
  const network: Array<{
    url: string
    method: string
    body: string | null
    referer: string | undefined
  }> = []
  page.on("request", (request) => {
    network.push({
      url: request.url(),
      method: request.method(),
      body: request.postData(),
      referer: request.headers().referer,
    })
  })

  let confirmationPosts = 0
  await page.route("**/auth/confirm", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue()
      return
    }
    confirmationPosts += 1
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      body: JSON.stringify({ ok: true, redirect: "/app" }),
    })
  })
  await page.route("**/app", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>Confirmed account</title><h1>Confirmed account</h1>",
    })
  })

  await page.goto(
    `${origin}/auth/confirm?next=%2Fapp#token_hash=${TOKEN_HASH}&v=1`,
    { waitUntil: "domcontentloaded" },
  )

  await expect(page).toHaveURL(`${origin}/auth/confirm?next=%2Fapp`)
  await expect(
    page.getByRole("button", { name: "Continue securely" }),
  ).toBeEnabled()
  await expect(page.getByRole("status")).toHaveText(
    "Your secure sign-in link is ready.",
  )
  expect(confirmationPosts).toBe(0)
  expect(
    await confirmationContext
      .cookies()
      .then((cookies) =>
        cookies.some((cookie) => cookie.name === "browser_bound_pkce_verifier"),
      ),
  ).toBe(false)
  expect(
    await page.evaluate(() => ({
      local: window.localStorage.length,
      session: window.sessionStorage.length,
      referrer: document.referrer,
    })),
  ).toEqual({ local: 0, session: 0, referrer: "" })
  expect(network.every((request) => !request.url.includes(TOKEN_HASH))).toBe(
    true,
  )

  const continueButton = page.getByRole("button", {
    name: "Continue securely",
  })
  await continueButton.focus()
  await page.keyboard.press("Enter")
  await expect.poll(() => confirmationPosts).toBe(1)
  await expect(page).toHaveURL(/\/app(?:\?|$)/)

  const post = network.find(
    (request) =>
      request.method === "POST" && request.url.endsWith("/auth/confirm"),
  )
  expect(post).toBeDefined()
  expect(JSON.parse(post!.body!)).toEqual({
    tokenHash: TOKEN_HASH,
    next: "/app",
  })
  expect(post!.url).not.toContain(TOKEN_HASH)
  expect(post!.referer ?? "").not.toContain(TOKEN_HASH)
  expect(confirmationPosts).toBe(1)

  await confirmationContext.close()
  await initiationContext.close()
})

test("an invalid duplicate-token envelope is scrubbed and never submitted", async ({
  baseURL,
  page,
}) => {
  expect(baseURL).toBeTruthy()
  const origin = new URL(baseURL!).origin
  let confirmationPosts = 0
  const requestUrls: string[] = []
  page.on("request", (request) => requestUrls.push(request.url()))
  await page.route("**/auth/confirm", async (route) => {
    if (route.request().method() === "POST") confirmationPosts += 1
    await route.continue()
  })

  await page.goto(
    `${origin}/auth/confirm?next=%2Fapp#token_hash=${TOKEN_HASH}&token_hash=${TOKEN_HASH}&v=1`,
    { waitUntil: "domcontentloaded" },
  )

  await expect(page).toHaveURL(`${origin}/auth/confirm?next=%2Fapp`)
  await expect(
    page.getByRole("button", { name: "Continue securely" }),
  ).toBeDisabled()
  await expect(page.getByRole("status")).toContainText("invalid or incomplete")
  await page.keyboard.press("Enter")
  expect(confirmationPosts).toBe(0)
  expect(requestUrls.every((url) => !url.includes(TOKEN_HASH))).toBe(true)
})
