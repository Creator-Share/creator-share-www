import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"
import { inspect } from "node:util"
import { expect, test } from "@playwright/test"

const marker = "PRIVATE_PROVIDER_RESPONSE"
const testRequire = createRequire(resolve(process.cwd(), "tests/auth/legacy-email-error-privacy.spec.ts"))
const loader = Module as unknown as { _load: (name: string, ...args: unknown[]) => unknown }

async function exercise(deliveryFails: boolean, loggingFails = false, configured = true, renderTemplates = false) {
  const originalLoad = loader._load
  const originalConsole = console.error
  const cachedBefore = new Set(Object.keys(testRequire.cache))
  const emailModule = testRequire.resolve("../../src/utils/email")
  const previousEmailModule = testRequire.cache[emailModule]
  delete testRequire.cache[emailModule]
  const originalUser = process.env.EMAIL_USER
  const originalPassword = process.env.EMAIL_PASSWORD
  const records: Array<Record<string, unknown>> = []
  const logs: unknown[][] = []
  const messages: Array<{ html?: string; subject?: string }> = []
  let transportCalls = 0
  const failure = Object.assign(new Error(marker), {
    response: marker,
    rejected: ["recipient@example.test"],
  })
  try {
    process.env.EMAIL_USER = "fixture@example.test"
    if (configured) process.env.EMAIL_PASSWORD = "fixture-only"
    else delete process.env.EMAIL_PASSWORD
    console.error = (...args: unknown[]) => { logs.push(args) }
    loader._load = (name, ...args) => {
      if (name === "server-only") return {}
      if (name === "nodemailer") return { createTransport: () => ({
        sendMail: async (message: { html?: string; subject?: string }) => {
          messages.push(message)
          transportCalls += 1
          if (deliveryFails) throw failure
          return { messageId: "fixture-message" }
        },
      }) }
      if (name === "@/lib/stagingOutboundEmail") return {
        assertAdvocateStagingLegacyEmailAllowed: () => {},
        advocateStagingLegacyEmailTransportSecurityOptions: () => ({}),
      }
      if (name === "@/utils/supabase/server") return {
        createServiceRoleClient: () => ({ from: () => ({
          insert: async (record: Record<string, unknown>) => {
            records.push(record)
            if (loggingFails) throw failure
            return { error: null }
          },
        }) }),
      }
      return originalLoad.call(Module, name, ...args)
    }
    const email = testRequire("../../src/utils/email") as typeof import("../../src/utils/email")
    const { sendEmail } = email
    if (renderTemplates) {
      const name = '<a href="https://untrusted.example">Pay here</a> & Friends'
      await email.sendBlindSponsorshipConfirmationEmail("recipient@example.test", 2500, "month", "children", name, { provider: "PAYPAL" })
      await email.sendManagerSponsorshipNotificationEmail("Child", 2500, "month", "recipient@example.test", name)
      await email.sendSponsorshipCancellationNotificationEmail("Child", "recipient@example.test", name, 2500)
      await email.sendActivityNotificationEmail("recipient@example.test", { name }, {
        title: name, description: name,
        documentUrls: [`https://media.example.test/${encodeURIComponent('<b>Document</b>')}`],
        imageUrls: ['https://media.example.test/photo" data-forged="yes'],
      })
      await email.sendPartnershipConfirmationEmail("recipient@example.test", name, 2500, "month")
      await email.sendBlindSponsorshipMatchedEmail("recipient@example.test", name, 2500, "month", null, 'child" data-forged="yes')
    }
    const result = await sendEmail({ to: "recipient@example.test", subject: "Fixture", text: "Fixture" })
    return { result, records, messages, transportCalls, logs: inspect(logs) }
  } finally {
    if (previousEmailModule) testRequire.cache[emailModule] = previousEmailModule
    else delete testRequire.cache[emailModule]
    loader._load = originalLoad
    console.error = originalConsole
    if (originalUser === undefined) delete process.env.EMAIL_USER
    else process.env.EMAIL_USER = originalUser
    if (originalPassword === undefined) delete process.env.EMAIL_PASSWORD
    else process.env.EMAIL_PASSWORD = originalPassword
    for (const key of Object.keys(testRequire.cache)) {
      if (!cachedBefore.has(key)) delete testRequire.cache[key]
    }
  }
}

test("email transport errors do not escape into logs, stored errors, or callers", async () => {
  const { result, records, logs } = await exercise(true)
  expect(result).toEqual({ success: false, error: "Email delivery failed" })
  expect(records).toHaveLength(1)
  expect(records[0].error).toBe("Email delivery failed")
  expect(logs).not.toContain(marker)
  expect(logs).not.toContain("recipient@example.test")
})

test("email-log failures preserve accepted delivery without exposing raw errors", async () => {
  const { result, logs } = await exercise(false, true)
  expect(result).toEqual({ success: true, messageId: "fixture-message" })
  expect(logs).not.toContain(marker)
})

test("missing credentials record a failure without attempting delivery", async () => {
  const { result, records, transportCalls } = await exercise(false, false, false)
  expect(result).toEqual({ success: false, error: "Email service not configured" })
  expect(transportCalls).toBe(0)
  expect(records).toHaveLength(1)
  expect(records[0]).toMatchObject({ status: "failed", error: "Email service not configured" })
})


test("sponsor names remain text in sponsor and administrator email templates", async () => {
  const { messages } = await exercise(false, false, true, true)
  for (const message of messages.slice(0, 3)) {
    expect(message.html).not.toContain('<a href="https://untrusted.example">')
    expect(message.html).toContain('&lt;a href=&quot;https://untrusted.example&quot;&gt;Pay here&lt;/a&gt; &amp; Friends')
  }
  expect(messages).toHaveLength(7)
})


test("legacy content and media labels cannot alter email markup", async () => {
  const { messages } = await exercise(false, false, true, true)
  for (const message of messages.slice(3, 6)) {
    expect(message.html).not.toContain('<a href="https://untrusted.example">')
    expect(message.html).toContain('&lt;a href=&quot;https://untrusted.example&quot;&gt;Pay here&lt;/a&gt; &amp; Friends')
    expect(message.html).not.toContain('" data-forged="yes')
  }
  expect(messages[3].html).toContain('&lt;b&gt;Document&lt;/b&gt;')
  expect(messages[3].html).not.toContain('<b>Document</b>')
  expect(messages[3].subject).toBe('New update on <a href="https://untrusted.example">Pay here</a> & Friends')
  expect(messages[3].html).toContain('<h2 style=')
})
