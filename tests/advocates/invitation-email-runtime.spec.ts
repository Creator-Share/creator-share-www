import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

/**
 * Whether the advocate staging recipient fence is actually wired.
 *
 * A reachability probe that appended a throwing statement to this module and
 * ran the complete offline lane passed unchanged, so no test loaded it.
 *
 * The fence itself is well covered as a pure predicate, and the transport
 * config is covered as a loader. What was unasserted is the wiring between
 * them: this factory only attaches `assertRecipientAllowed` when the transport
 * config carries a staging recipient policy. A mutation adding an
 * always-true disjunct to that condition leaves the property off the
 * dependencies entirely, and the worker then sends invitation email to any
 * address on advocate staging, which is the one environment where recipients
 * are supposed to be fenced to canary addresses.
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
  if (request === "./emailAuth") {
    return { createSharedAdvocateInvitationAuthProvider: () => ({}) }
  }
  if (request === "./emailRepository") {
    return { createSupabaseAdvocateInvitationEmailRepository: () => ({}) }
  }
  if (request === "./emailTransport") {
    return { createNodemailerAdvocateInvitationEmailTransport: () => ({}) }
  }
  return originalModuleLoad.call(this, request, parent, isMain)
}

const testRequire = createRequire(
  resolve(process.cwd(), "tests/advocates/invitation-email-runtime.spec.ts"),
)
const moduleCache = testRequire.cache as Record<string, unknown>
const specifier = "../../src/lib/advocates/invitations/emailRuntime"
const cachedBeforeLoad = new Set(Object.keys(moduleCache))
delete moduleCache[testRequire.resolve(specifier)]
const { createAdvocateInvitationEmailWorkerDependencies } = testRequire(
  specifier,
) as typeof import("../../src/lib/advocates/invitations/emailRuntime")
nodeModule._load = originalModuleLoad
// The require cache is shared across specs in one worker process.
for (const key of Object.keys(moduleCache)) {
  if (!cachedBeforeLoad.has(key)) delete moduleCache[key]
}

const WORKER_CONFIG = {
  serviceRequestTimeoutMilliseconds: 15_000,
} as unknown as Parameters<
  typeof createAdvocateInvitationEmailWorkerDependencies
>[0]["config"]

function stagingEnvironment(
  overrides: Record<string, string | undefined> = {},
) {
  return {
    NODE_ENV: "production",
    NEXT_PUBLIC_BASE_URL: STAGING_ORIGIN,
    EMAIL_HOST: "smtp.ethereal.email",
    EMAIL_PORT: "587",
    EMAIL_SECURE: "false",
    EMAIL_USER: MAILBOX_IDENTITY,
    EMAIL_PASSWORD: "sandbox-password",
    EMAIL_FROM: '"Creator Share" <noreply@creatorshare.com>',
    ADVOCATE_INVITATION_CANONICAL_ORIGIN: STAGING_ORIGIN,
    ADVOCATE_INVITATION_EMAIL_WORKER_SECRET: "w".repeat(48),
    CRON_SECRET: "c".repeat(48),
    ...overrides,
  }
}

function productionEnvironment() {
  return stagingEnvironment({
    NEXT_PUBLIC_BASE_URL: "https://creatorshare.com",
    ADVOCATE_INVITATION_CANONICAL_ORIGIN: "https://creatorshare.com",
  })
}

test.describe("advocate invitation email worker wiring", () => {
  test("wires the recipient fence on advocate staging", async () => {
    const dependencies = createAdvocateInvitationEmailWorkerDependencies({
      config: WORKER_CONFIG,
      environment: stagingEnvironment(),
    })

    // The decisive assertion: the fence must be present, and it must actually
    // refuse. An attached function that never throws would be no fence at all.
    expect(typeof dependencies.assertRecipientAllowed).toBe("function")
    expect(() =>
      dependencies.assertRecipientAllowed?.("someone@example.com"),
    ).toThrow()
    expect(() =>
      dependencies.assertRecipientAllowed?.("operations@creatorshare.com"),
    ).toThrow()

    // A genuine canary recipient still passes, so this is a fence rather than
    // a blanket refusal.
    expect(() =>
      dependencies.assertRecipientAllowed?.(CANARY_RECIPIENT),
    ).not.toThrow()
  })

  test("attaches no fence outside advocate staging", async () => {
    const dependencies = createAdvocateInvitationEmailWorkerDependencies({
      config: WORKER_CONFIG,
      environment: productionEnvironment(),
    })

    // Production has no canary contract, so a fence here would refuse real
    // invitations. Its absence is the correct wiring, not an oversight.
    expect(dependencies.assertRecipientAllowed).toBeUndefined()
  })

  test("carries the canonical origin the invitation links are built from", async () => {
    expect(
      createAdvocateInvitationEmailWorkerDependencies({
        config: WORKER_CONFIG,
        environment: stagingEnvironment(),
      }).canonicalOrigin,
    ).toBe(STAGING_ORIGIN)
    expect(
      createAdvocateInvitationEmailWorkerDependencies({
        config: WORKER_CONFIG,
        environment: productionEnvironment(),
      }).canonicalOrigin,
    ).toBe("https://creatorshare.com")
  })
})
