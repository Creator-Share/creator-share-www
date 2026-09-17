import { expect, test, type BrowserContext, type Page } from "@playwright/test"

const RUN_INTEGRATION = process.env.RUN_SPONSOR_EMAIL_AUTH_INTEGRATION === "1"
const MAILPIT_ORIGIN =
  process.env.SPONSOR_EMAIL_AUTH_MAILPIT_ORIGIN ?? "http://127.0.0.1:54324"
const PUBLIC_DELIVERY_SINGLE_FLIGHT_MILLISECONDS = 60_000
const DELIVERY_CLOCK_MARGIN_MILLISECONDS = 2_000

interface MailpitSummary {
  ID?: unknown
  To?: unknown
}

interface MailpitList {
  messages?: unknown
}

function recipientAddresses(message: MailpitSummary): string[] {
  if (!Array.isArray(message.To)) return []
  return message.To.flatMap((recipient) => {
    if (!recipient || typeof recipient !== "object") return []
    const address = (recipient as { Address?: unknown }).Address
    return typeof address === "string" ? [address.toLowerCase()] : []
  })
}

async function latestMessageId(email: string): Promise<string | null> {
  const response = await fetch(`${MAILPIT_ORIGIN}/api/v1/messages`)
  if (!response.ok) throw new Error("mailpit_list_unavailable")
  const body = (await response.json()) as MailpitList
  if (!Array.isArray(body.messages)) return null
  for (const candidate of body.messages as MailpitSummary[]) {
    if (
      typeof candidate.ID === "string" &&
      recipientAddresses(candidate).includes(email.toLowerCase())
    ) {
      return candidate.ID
    }
  }
  return null
}

async function confirmationLink(email: string): Promise<string> {
  let messageId: string | null = null
  await expect
    .poll(
      async () => {
        messageId = await latestMessageId(email)
        return messageId
      },
      { timeout: 15_000 },
    )
    .not.toBeNull()

  const response = await fetch(
    `${MAILPIT_ORIGIN}/api/v1/message/${encodeURIComponent(messageId!)}`,
  )
  if (!response.ok) throw new Error("mailpit_message_unavailable")
  const body = (await response.json()) as { HTML?: unknown }
  if (typeof body.HTML !== "string") {
    throw new Error("mailpit_message_html_unavailable")
  }
  const href = body.HTML.match(/href="([^"]+)"/)?.[1]
  if (!href) throw new Error("mailpit_confirmation_link_unavailable")
  return href.replaceAll("&amp;", "&")
}

async function sameOriginJson(
  page: Page,
  path: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  return page.evaluate(
    async ({ requestPath, requestBody }) => {
      const response = await fetch(requestPath, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      })
      return { status: response.status, body: await response.json() }
    },
    { requestPath: path, requestBody: body },
  )
}

async function confirmInFreshContext(
  context: BrowserContext,
  link: string,
  expectedPath: string,
): Promise<void> {
  expect(await context.cookies()).toEqual([])
  const page = await context.newPage()
  await page.goto(link, { waitUntil: "domcontentloaded" })
  expect(new URL(page.url()).hash).toBe("")
  await expect(
    page.getByRole("button", { name: "Continue securely" }),
  ).toBeEnabled()
  await page.getByRole("button", { name: "Continue securely" }).click()
  await expect(page).toHaveURL(
    new RegExp(`${expectedPath.replaceAll("/", "\\/")}(?:\\?|$)`),
  )
  const cookies = await context.cookies()
  expect(cookies.some((cookie) => cookie.name.startsWith("sb-"))).toBe(true)
  expect(cookies.some((cookie) => cookie.name.includes("code-verifier"))).toBe(
    false,
  )
}

test.describe("local Supabase and Mailpit sponsor email auth", () => {
  test.skip(
    !RUN_INTEGRATION,
    "Set RUN_SPONSOR_EMAIL_AUTH_INTEGRATION=1 and restart local Supabase after template changes.",
  )

  test("signup and existing-account links redeem in independent cookie jars", async ({
    baseURL,
    browser,
  }) => {
    test.setTimeout(120_000)
    expect(baseURL).toBeTruthy()
    const cleared = await fetch(`${MAILPIT_ORIGIN}/api/v1/messages`, {
      method: "DELETE",
    })
    expect(cleared.ok).toBe(true)

    const email = `creator.share.canary+${Date.now()}@gmail.com`
    const initiationContext = await browser.newContext()
    const initiationPage = await initiationContext.newPage()
    await initiationPage.goto(`${baseURL}/register`, {
      waitUntil: "domcontentloaded",
    })

    const registration = await sameOriginJson(
      initiationPage,
      "/api/auth/registration",
      {
        email,
        password: "Canary password 47! Secure",
        first_name: "Email",
        last_name: "Canary",
      },
    )
    expect(registration).toEqual({
      status: 202,
      body: { status: "check-email" },
    })

    const signupLink = await confirmationLink(email)
    const signupConfirmationContext = await browser.newContext()
    await confirmInFreshContext(
      signupConfirmationContext,
      signupLink,
      "/app/main/onboarding",
    )
    await signupConfirmationContext.close()

    const clearedAfterSignup = await fetch(
      `${MAILPIT_ORIGIN}/api/v1/messages`,
      { method: "DELETE" },
    )
    expect(clearedAfterSignup.ok).toBe(true)

    const suppressedSignIn = await sameOriginJson(
      initiationPage,
      "/api/auth/passwordless",
      { email },
    )
    const suppressedResend = await sameOriginJson(
      initiationPage,
      "/api/auth/passwordless",
      { email },
    )
    expect(suppressedSignIn).toEqual({
      status: 202,
      body: { status: "check-email" },
    })
    expect(suppressedResend).toEqual(suppressedSignIn)

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500))
    const suppressedMessageResponse = await fetch(
      `${MAILPIT_ORIGIN}/api/v1/messages`,
    )
    const suppressedMessageList =
      (await suppressedMessageResponse.json()) as MailpitList
    const suppressedRecipientMessages = Array.isArray(
      suppressedMessageList.messages,
    )
      ? (suppressedMessageList.messages as MailpitSummary[]).filter((message) =>
          recipientAddresses(message).includes(email.toLowerCase()),
        )
      : []
    expect(suppressedRecipientMessages).toHaveLength(0)

    await new Promise((resolveDelay) =>
      setTimeout(
        resolveDelay,
        PUBLIC_DELIVERY_SINGLE_FLIGHT_MILLISECONDS +
          DELIVERY_CLOCK_MARGIN_MILLISECONDS,
      ),
    )

    const firstSignIn = await sameOriginJson(
      initiationPage,
      "/api/auth/passwordless",
      { email },
    )
    const overlappingResend = await sameOriginJson(
      initiationPage,
      "/api/auth/passwordless",
      { email },
    )
    expect(firstSignIn).toEqual({
      status: 202,
      body: { status: "check-email" },
    })
    expect(overlappingResend).toEqual(firstSignIn)

    const signInLink = await confirmationLink(email)
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500))
    const messageResponse = await fetch(`${MAILPIT_ORIGIN}/api/v1/messages`)
    const messageList = (await messageResponse.json()) as MailpitList
    const recipientMessages = Array.isArray(messageList.messages)
      ? (messageList.messages as MailpitSummary[]).filter((message) =>
          recipientAddresses(message).includes(email.toLowerCase()),
        )
      : []
    expect(recipientMessages).toHaveLength(1)

    const signInConfirmationContext = await browser.newContext()
    await confirmInFreshContext(signInConfirmationContext, signInLink, "/app")

    await signInConfirmationContext.close()
    await initiationContext.close()
  })
})
