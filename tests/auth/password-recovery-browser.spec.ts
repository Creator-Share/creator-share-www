import { expect, test, type Page } from "@playwright/test"

const ACCEPTED_ISSUANCE_BODY = JSON.stringify({ status: "check-email" })
const ACCEPTED_VERIFICATION_BODY = JSON.stringify({
  message: "OTP verified successfully.",
})
const ACCEPTED_PASSWORD_CHANGE_BODY = JSON.stringify({
  message: "Password reset successful! User has been logged out.",
})

async function seedPrivacySentinels(page: Page) {
  await page.evaluate(() => {
    localStorage.setItem("recovery-test-local-sentinel", "local-ok")
    sessionStorage.setItem("recovery-test-session-sentinel", "session-ok")
  })
}

async function expectContactFreeBrowserState(page: Page) {
  const browserState = await page.evaluate(() => ({
    local: Object.entries(localStorage),
    session: Object.entries(sessionStorage),
    history: JSON.stringify(history.state),
    url: location.href,
    cookie: document.cookie,
  }))
  const serialized = JSON.stringify(browserState).toLowerCase()

  expect(serialized).not.toContain("alice.sponsor")
  expect(serialized).not.toContain("sponsor@example.com")
  expect(serialized).not.toContain("@example.com")
  expect(serialized).not.toContain("password-recovery-email")
  expect(browserState.url).not.toContain("?")
  for (const cookie of await page.context().cookies()) {
    expect(`${cookie.name}=${cookie.value}`.toLowerCase()).not.toContain("@")
  }
}

async function openRequestPage(page: Page) {
  await page.goto("/forgot-password")
  const email = page.getByLabel("Email Address")
  await expect(email).toBeEnabled()
  return email
}

test("keeps exact issuance inline with a canonical prefilled email", async ({
  page,
}) => {
  let requestBody: unknown = null
  await page.route("**/api/auth/reset-password", async (route) => {
    requestBody = route.request().postDataJSON()
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: ACCEPTED_ISSUANCE_BODY,
    })
  })

  const email = await openRequestPage(page)
  await seedPrivacySentinels(page)
  await email.fill("  Ａlice.Sponsor+Launch@Ｅxample.COM  ")
  await page.getByRole("button", { name: "Send verification code" }).click()

  await expect(page).toHaveURL(/\/forgot-password$/)
  await expect(page.getByLabel("Verification code")).toBeEnabled()
  await expect(page.getByLabel("Email Address")).toHaveValue(
    "alice.sponsor+launch@example.com",
  )
  expect(requestBody).toEqual({
    email: "alice.sponsor+launch@example.com",
  })
  await expectContactFreeBrowserState(page)
})

test("carries a fresh-tab recovery session through password change and signout", async ({
  browserName,
  page,
}) => {
  // The route suite separately proves that the real response uses the exact
  // host-only Supabase auth cookie. This transport sentinel deliberately does
  // not share that provider namespace, so middleware cannot try to decode the
  // synthetic value before the browser presents it to the next request.
  const recoveryCookieName = "cs_recovery_browser_session_transport"
  const recoveryCookieValue = "base64-browser-recovery-session"
  let issuanceDispatched = false
  await page.route("**/api/auth/reset-password", async (route) => {
    issuanceDispatched = true
    await route.abort()
  })
  let verificationBody: unknown = null
  await page.route("**/api/auth/verify-otp", async (route) => {
    verificationBody = route.request().postDataJSON()
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: {
        "Set-Cookie": `${recoveryCookieName}=${recoveryCookieValue}; Path=/; HttpOnly; SameSite=Lax`,
      },
      body: ACCEPTED_VERIFICATION_BODY,
    })
  })
  let passwordChangeCookieHeader = ""
  let passwordChangeRequests = 0
  await page.route("**/api/auth/change-password", async (route) => {
    passwordChangeRequests += 1
    passwordChangeCookieHeader =
      (await route.request().allHeaders()).cookie ?? ""
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: {
        "Set-Cookie": `${recoveryCookieName}=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax`,
      },
      body: ACCEPTED_PASSWORD_CHANGE_BODY,
    })
  })

  await openRequestPage(page)
  await page.getByRole("button", { name: "Already have a code" }).click()
  await expect(page.getByLabel("Verification code")).toBeEnabled()
  expect(issuanceDispatched).toBe(false)

  await page.goto("/forgot-password/verify")
  const email = page.getByLabel("Email Address")
  const code = page.getByLabel("Verification code")
  await expect(email).toBeEnabled()
  await seedPrivacySentinels(page)
  await email.fill(" Sponsor@Example.com ")
  await code.fill("123456")
  await page.getByRole("button", { name: "Verify code" }).click()

  await expect(page).toHaveURL(/\/forgot-password\/reset$/)
  expect(verificationBody).toEqual({
    email: "sponsor@example.com",
    token: "123456",
    type: "recovery",
  })
  await expectContactFreeBrowserState(page)

  expect(await page.context().cookies()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: recoveryCookieName,
        value: recoveryCookieValue,
      }),
    ]),
  )

  await page.getByLabel("Password", { exact: true }).fill("StrongPassword1!")
  await page
    .getByLabel("Confirm Password", { exact: true })
    .fill("StrongPassword1!")
  await page.getByRole("button", { name: "Continue", exact: true }).click()

  await expect.poll(() => passwordChangeRequests).toBe(1)
  // Playwright's WebKit interception layer omits HttpOnly Cookie headers even
  // though the browser cookie jar presents and clears the cookie correctly.
  // Chromium exposes the transport header, so retain the direct assertion there.
  if (browserName === "chromium") {
    expect(passwordChangeCookieHeader).toContain(
      `${recoveryCookieName}=${recoveryCookieValue}`,
    )
  }
  await expect(page.getByRole("status").first()).toContainText(
    "Password reset successful",
  )
  await expect(page).toHaveURL(/\/login$/, { timeout: 5000 })
  expect(
    (await page.context().cookies()).some(
      (cookie) => cookie.name === recoveryCookieName,
    ),
  ).toBe(false)
})

test("keeps request uncertainty in memory and offers received-code entry", async ({
  page,
}) => {
  let requests = 0
  await page.route("**/api/auth/reset-password", async (route) => {
    requests += 1
    if (requests === 1) {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: "invalid-request" }),
      })
      return
    }
    await route.abort("failed")
  })

  const email = await openRequestPage(page)
  await seedPrivacySentinels(page)
  await email.fill("sponsor@example.com")
  await page.getByRole("button", { name: "Send verification code" }).click()
  await expect(page.getByRole("status")).toContainText(
    "We couldn't send a code",
  )

  await page.getByRole("button", { name: "Send verification code" }).click()
  await expect(page.getByRole("status")).toContainText("may have been received")
  await page.getByRole("button", { name: "Enter a received code" }).click()
  await expect(page.getByLabel("Verification code")).toBeEnabled()
  await expect(page.getByLabel("Email Address")).toHaveValue(
    "sponsor@example.com",
  )
  await expectContactFreeBrowserState(page)
})

test("ignores stale issuance completion after the page unmounts", async ({
  page,
}) => {
  let releaseResponse: (() => void) | undefined
  let markDispatched: (() => void) | undefined
  const dispatched = new Promise<void>((resolve) => {
    markDispatched = resolve
  })
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve
  })
  await page.route("**/api/auth/reset-password", async (route) => {
    markDispatched?.()
    await responseGate
    await route
      .fulfill({
        status: 202,
        contentType: "application/json",
        body: ACCEPTED_ISSUANCE_BODY,
      })
      .catch(() => undefined)
  })

  const email = await openRequestPage(page)
  await email.fill("sponsor@example.com")
  await page.getByRole("button", { name: "Send verification code" }).click()
  await dispatched
  await page.goto("/login")
  releaseResponse?.()

  await page.waitForTimeout(100)
  await expect(page).toHaveURL(/\/login$/)
  await expectContactFreeBrowserState(page)
})

test("treats malformed verification success as ambiguous without clearing input", async ({
  page,
}) => {
  await page.route("**/api/auth/verify-otp", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        message: "OTP verified successfully.",
        extra: true,
      }),
    })
  })

  await page.goto("/forgot-password/verify")
  const email = page.getByLabel("Email Address")
  const code = page.getByLabel("Verification code")
  await expect(email).toBeEnabled()
  await seedPrivacySentinels(page)
  await email.fill("sponsor@example.com")
  await code.fill("123456")
  await page.getByRole("button", { name: "Verify code" }).click()

  await expect(page.getByRole("status")).toContainText("couldn't confirm")
  await expect(email).toHaveValue("sponsor@example.com")
  await expect(code).toHaveValue("123456")
  await expect(
    page.getByRole("button", { name: "Continue to password reset" }),
  ).toBeVisible()
  await expect(page).toHaveURL(/\/forgot-password\/verify$/)
  await expectContactFreeBrowserState(page)
})

test("exactly parses password change and exposes accessible password controls", async ({
  page,
}) => {
  let changes = 0
  await page.route("**/api/auth/change-password", async (route) => {
    changes += 1
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body:
        changes === 1
          ? JSON.stringify({
              message: "Password reset successful! User has been logged out.",
              providerDetail: "do not display me",
            })
          : ACCEPTED_PASSWORD_CHANGE_BODY,
    })
  })

  await page.goto("/forgot-password/reset")
  const password = page.getByLabel("Password", { exact: true })
  const confirmation = page.getByLabel("Confirm Password", { exact: true })
  await expect(password).toBeEnabled()
  await expect(
    page.getByRole("button", { name: "Show password", exact: true }),
  ).toBeVisible()
  await password.fill("StrongPassword1!")
  await confirmation.fill("DifferentPassword1!")
  await confirmation.press("Enter")
  await expect(page.getByRole("status").last()).toContainText(
    "Passwords do not match",
  )
  expect(changes).toBe(0)
  await expect(password).toHaveValue("")
  await expect(confirmation).toHaveValue("")

  await password.fill("StrongPassword1!")
  await confirmation.fill("StrongPassword1!")
  await page.getByRole("button", { name: "Continue", exact: true }).click()

  await expect(page.getByRole("status").last()).toContainText(
    "couldn't confirm whether your password changed",
  )
  await expect(page.getByText("do not display me")).toHaveCount(0)
  await expect(password).toHaveValue("")
  await expect(confirmation).toHaveValue("")

  await password.fill("StrongPassword2!")
  await confirmation.fill("StrongPassword2!")
  await page.getByRole("button", { name: "Continue", exact: true }).click()
  await expect(page.getByRole("status").first()).toContainText(
    "Password reset successful",
  )
  await expect(page).toHaveURL(/\/login$/, { timeout: 5000 })
})

test("guards password change completion after unmount", async ({ page }) => {
  let releaseResponse: (() => void) | undefined
  let markDispatched: (() => void) | undefined
  const dispatched = new Promise<void>((resolve) => {
    markDispatched = resolve
  })
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve
  })
  await page.route("**/api/auth/change-password", async (route) => {
    markDispatched?.()
    await responseGate
    await route
      .fulfill({
        status: 200,
        contentType: "application/json",
        body: ACCEPTED_PASSWORD_CHANGE_BODY,
      })
      .catch(() => undefined)
  })

  await page.goto("/forgot-password/reset")
  const password = page.getByLabel("Password", { exact: true })
  const confirmation = page.getByLabel("Confirm Password", { exact: true })
  await expect(password).toBeEnabled()
  await password.fill("StrongPassword1!")
  await confirmation.fill("StrongPassword1!")
  await page.getByRole("button", { name: "Continue", exact: true }).click()
  await dispatched
  await page.goto("/forgot-password")
  releaseResponse?.()

  await page.waitForTimeout(2200)
  await expect(page).toHaveURL(/\/forgot-password$/)
})
