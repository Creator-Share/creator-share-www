import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

test("passwordless fetch pins same-origin no-store nonredirecting semantics", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/components/SignInModal.tsx"),
    "utf8",
  )
  expect(source).toContain('cache: "no-store"')
  expect(source).toContain('credentials: "same-origin"')
  expect(source).toContain('redirect: "error"')
  expect(source).toContain("response.status !== 202")
  expect(source).toContain('record.status === "check-email"')
})

test("sign in defaults to an email link and keeps password access optional", async ({
  page,
}) => {
  const requests: unknown[] = []
  await page.route("**/api/auth/passwordless", async (route) => {
    requests.push(route.request().postDataJSON())
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ status: "check-email" }),
    })
  })

  const response = await page.goto("/signin", {
    waitUntil: "domcontentloaded",
  })
  expect(response?.status()).toBe(200)

  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible({ timeout: 20_000 })
  await expect(
    dialog.getByRole("button", { name: "Email me a sign-in link" }),
  ).toBeVisible()
  await expect(dialog.locator('input[type="password"]')).toHaveCount(0)
  await expect(dialog.getByText(/remember me/i)).toHaveCount(0)

  await dialog.locator('input[type="email"]').fill("sponsor@example.com")
  await dialog.getByRole("button", { name: "Email me a sign-in link" }).click()

  await expect(
    dialog.getByText(
      "If an account exists for this email, we sent a secure sign-in link.",
      { exact: false },
    ),
  ).toBeVisible()
  expect(requests).toEqual([{ email: "sponsor@example.com" }])

  await dialog.getByRole("button", { name: "Use a password instead" }).click()
  await expect(dialog.locator('input[type="password"]')).toBeVisible()
  await expect(dialog.getByRole("button", { name: "Sign In" })).toBeVisible()

  await dialog
    .getByRole("button", { name: "Use an email link instead" })
    .click()
  await expect(dialog.locator('input[type="password"]')).toHaveCount(0)
  await expect(
    dialog.getByRole("button", { name: "Email me a sign-in link" }),
  ).toBeVisible()
})

test("passwordless success requires the exact generic 202 contract", async ({
  page,
}) => {
  let responseNumber = 0
  await page.route("**/api/auth/passwordless", async (route) => {
    responseNumber += 1
    const response =
      responseNumber === 1
        ? { status: 200, body: { status: "check-email" } }
        : responseNumber === 2
          ? {
              status: 202,
              body: { status: "check-email", accountExists: true },
            }
          : { status: 202, body: { status: "check-email" } }
    await route.fulfill({
      status: response.status,
      contentType: "application/json",
      body: JSON.stringify(response.body),
    })
  })

  await page.goto("/signin", { waitUntil: "domcontentloaded" })
  const dialog = page.getByRole("dialog")
  await dialog.locator('input[type="email"]').fill("sponsor@example.com")
  const sendButton = dialog.getByRole("button", {
    name: "Email me a sign-in link",
  })

  await sendButton.click()
  await expect(sendButton).toBeEnabled()
  await expect(
    dialog.getByText("The link opens your sponsorship dashboard."),
  ).toHaveCount(0)

  await sendButton.click()
  await expect(sendButton).toBeEnabled()
  await expect(
    dialog.getByText("The link opens your sponsorship dashboard."),
  ).toHaveCount(0)

  await sendButton.click()
  await expect(
    dialog.getByText("The link opens your sponsorship dashboard."),
  ).toBeVisible()
  expect(responseNumber).toBe(3)
})

test("password fallback remains keyboard accessible and submits its credentials", async ({
  page,
}) => {
  const loginBodies: unknown[] = []
  await page.route("**/api/auth/login", async (route) => {
    loginBodies.push(route.request().postDataJSON())
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ redirect: "/" }),
    })
  })

  await page.goto("/signin", { waitUntil: "domcontentloaded" })
  const dialog = page.getByRole("dialog")
  const passwordMode = dialog.getByRole("button", {
    name: "Use a password instead",
  })
  await passwordMode.focus()
  await page.keyboard.press("Enter")

  const email = dialog.locator('input[type="email"]')
  const password = dialog.locator("#creator-share-sign-in-password")
  await expect(password).toHaveAttribute("type", "password")
  await email.fill("sponsor@example.com")
  await password.fill("correct horse battery staple")

  const visibility = dialog.getByRole("button", { name: "Show password" })
  await visibility.focus()
  await page.keyboard.press("Enter")
  await expect(password).toHaveAttribute("type", "text")
  await expect(
    dialog.getByRole("button", { name: "Hide password" }),
  ).toHaveAttribute("aria-pressed", "true")
  await page.keyboard.press("Space")
  await expect(password).toHaveAttribute("type", "password")

  await dialog.getByRole("button", { name: "Sign In" }).click()
  await expect.poll(() => loginBodies.length).toBe(1)
  expect(loginBodies).toEqual([
    {
      email: "sponsor@example.com",
      password: "correct horse battery staple",
    },
  ])
})
