import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

/**
 * What the sponsor welcome worker is actually handed each invocation.
 *
 * A reachability probe that appended a throwing statement to this module and
 * ran the complete offline lane passed unchanged, so no test loaded it.
 *
 * Two things are assembled here and neither was asserted. The invocation
 * deadline is forwarded from the route, and `assertSendHeadroom` falls back to
 * `Infinity` when it is absent, so dropping it silently disables the deadline
 * half of the headroom check on a route that runs with a sixty second budget.
 * The staging recipient fence is attached the same way as the invitation
 * worker's, and is what keeps welcome email on advocate staging fenced to
 * canary addresses.
 */

type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown

const STAGING_ORIGIN = "https://advocate-staging.creatorshare.com"
const MAILBOX_IDENTITY = "creator-share-staging@ethereal.email"
const CANARY_RECIPIENT =
  "creator-share-ff029-0123456789abcdef0123456789abcdef@example.com"
const DEADLINE = 1_800_000_000_000

interface CapturedDependencies {
  invocationDeadlineAt?: number
  assertRecipientAllowed?: (recipientEmail: string) => void
  canonicalOrigin?: string
}

let captured: CapturedDependencies | null = null

const nodeModule = Module as unknown as { _load: NodeModuleLoader }
const originalModuleLoad = nodeModule._load
nodeModule._load = function mockedModuleLoad(
  this: unknown,
  request: string,
  parent: unknown,
  isMain: boolean,
) {
  if (request === "server-only") return {}
  if (request === "@/utils/supabase/server") {
    return { createServiceRoleClient: () => ({}) }
  }
  if (request === "@/lib/sponsorships/crypto") {
    return { createSponsorshipCryptoFromEnvironment: () => ({}) }
  }
  if (request === "@/lib/sponsorships/email/sponsorWelcomeEmailRepository") {
    return { createSupabaseSponsorWelcomeEmailRepository: () => ({}) }
  }
  if (request === "@/lib/sponsorships/email/sponsorWelcomeEmailTransport") {
    return { createNodemailerSponsorWelcomeEmailTransport: () => ({}) }
  }
  if (request === "@/lib/sponsorships/email/sponsorWelcomeEmailWorker") {
    return {
      async runSponsorWelcomeEmailBatch(input: {
        dependencies: CapturedDependencies
      }) {
        captured = input.dependencies
        return { claimed: 0, sent: 0, failed: 0, deferred: 0 }
      },
    }
  }
  return originalModuleLoad.call(this, request, parent, isMain)
}

const testRequire = createRequire(
  resolve(
    process.cwd(),
    "tests/sponsorships/sponsor-welcome-email-runtime.spec.ts",
  ),
)
const moduleCache = testRequire.cache as Record<string, unknown>
const specifier = "../../src/lib/sponsorships/email/sponsorWelcomeEmailRuntime"
const cachedBeforeLoad = new Set(Object.keys(moduleCache))
delete moduleCache[testRequire.resolve(specifier)]
const { runSponsorWelcomeEmailBatchFromEnvironment } = testRequire(
  specifier,
) as typeof import("../../src/lib/sponsorships/email/sponsorWelcomeEmailRuntime")
nodeModule._load = originalModuleLoad
// The require cache is shared across specs in one worker process.
for (const key of Object.keys(moduleCache)) {
  if (!cachedBeforeLoad.has(key)) delete moduleCache[key]
}

const ORIGINAL_ENVIRONMENT = { ...process.env }

function applyEnvironment(overrides: Record<string, string> = {}) {
  Object.assign(process.env, {
    NODE_ENV: "production",
    NEXT_PUBLIC_BASE_URL: STAGING_ORIGIN,
    SPONSOR_WELCOME_EMAIL_CANONICAL_ORIGIN: STAGING_ORIGIN,
    EMAIL_HOST: "smtp.ethereal.email",
    EMAIL_PORT: "587",
    EMAIL_SECURE: "false",
    EMAIL_USER: MAILBOX_IDENTITY,
    EMAIL_PASSWORD: "sandbox-password",
    EMAIL_FROM: '"Creator Share" <noreply@creatorshare.com>',
    CRON_SECRET: "c".repeat(48),
    ...overrides,
  })
}

async function runBatch(): Promise<CapturedDependencies> {
  captured = null
  await runSponsorWelcomeEmailBatchFromEnvironment({
    config: { batchSize: 1 },
    workerId: "sponsor-welcome-email:test",
    context: {},
    invocationDeadlineAt: DEADLINE,
  } as unknown as Parameters<
    typeof runSponsorWelcomeEmailBatchFromEnvironment
  >[0])
  // The assignment happens inside a module stub the compiler cannot see, so
  // read it back through a local rather than relying on narrowing.
  const observed: CapturedDependencies | null = captured
  if (observed === null) throw new Error("worker was never invoked")
  return observed
}

test.afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENVIRONMENT)) delete process.env[key]
  }
  Object.assign(process.env, ORIGINAL_ENVIRONMENT)
})

test.describe("sponsor welcome email worker wiring", () => {
  test("forwards the invocation deadline the route computed", async () => {
    applyEnvironment()

    // assertSendHeadroom falls back to Infinity when this is absent, so
    // dropping it disables the deadline half of the headroom check outright
    // and the worker keeps sending past its budget.
    expect((await runBatch()).invocationDeadlineAt).toBe(DEADLINE)
  })

  test("wires a staging recipient fence that actually refuses", async () => {
    applyEnvironment()
    const dependencies = await runBatch()

    expect(typeof dependencies.assertRecipientAllowed).toBe("function")
    expect(() =>
      dependencies.assertRecipientAllowed?.("someone@example.com"),
    ).toThrow()
    expect(() =>
      dependencies.assertRecipientAllowed?.(CANARY_RECIPIENT),
    ).not.toThrow()
  })

  test("attaches no fence outside advocate staging", async () => {
    applyEnvironment({
      NEXT_PUBLIC_BASE_URL: "https://creatorshare.com",
      SPONSOR_WELCOME_EMAIL_CANONICAL_ORIGIN: "https://creatorshare.com",
    })
    const dependencies = await runBatch()

    // A fence in production would refuse real sponsors.
    expect(dependencies.assertRecipientAllowed).toBeUndefined()
    expect(dependencies.invocationDeadlineAt).toBe(DEADLINE)
  })
})
