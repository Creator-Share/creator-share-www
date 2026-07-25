import { readFile } from "node:fs/promises"
import Module, { createRequire } from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

type ExposureModule = typeof import("../../src/lib/sponsorships/exposure")
type StripeCheckoutModule =
  typeof import("../../src/lib/sponsorships/checkout/stripeCheckout")
type VisitorCookieModule =
  typeof import("../../src/lib/sponsorships/visitorCookie")
type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown

const nodeModule = Module as unknown as { _load: NodeModuleLoader }
const originalModuleLoad = nodeModule._load
nodeModule._load = function mockedModuleLoad(
  this: unknown,
  request: string,
  parent: unknown,
  isMain: boolean,
) {
  if (request === "server-only") return {}
  return originalModuleLoad.call(this, request, parent, isMain)
}
const testRequire = createRequire(
  resolve(process.cwd(), "tests/sponsorships/exposure.spec.ts"),
)
const exposure = testRequire(
  "../../src/lib/sponsorships/exposure",
) as ExposureModule
const stripeCheckout = testRequire(
  "../../src/lib/sponsorships/checkout/stripeCheckout",
) as StripeCheckoutModule
const visitorCookie = testRequire(
  "../../src/lib/sponsorships/visitorCookie",
) as VisitorCookieModule
nodeModule._load = originalModuleLoad

const { createQualifiedExposureEventKey, digestSponsorshipVisitorToken } =
  exposure
const { sponsorshipVisitorDigest } = stripeCheckout
const { createSponsorshipVisitorToken } = visitorCookie

let TOKEN: NonNullable<
  Awaited<ReturnType<typeof createSponsorshipVisitorToken>>
>

test.beforeAll(async () => {
  const token = await createSponsorshipVisitorToken(
    { rawHost: "hope.creatorshare.com" },
    { NODE_ENV: "test" },
  )
  if (token === null) throw new Error("Visitor test token was not created")
  TOKEN = token
})

test("hashes the opaque visitor token before database transport", () => {
  const result = digestSponsorshipVisitorToken(TOKEN)

  expect(result.digest).toHaveLength(32)
  expect(result.digestRpcBytea).toMatch(/^\\x[0-9a-f]{64}$/)
  expect(result.digestRpcBytea).not.toContain(TOKEN)
  expect(() =>
    digestSponsorshipVisitorToken("bad-token" as typeof TOKEN),
  ).toThrow("Invalid sponsorship visitor token")
})

test("uses one visitor digest for exposure and checkout attribution", () => {
  const exposureDigest = digestSponsorshipVisitorToken(TOKEN)

  expect(sponsorshipVisitorDigest(TOKEN)).toBe(exposureDigest.digestRpcBytea)
})

test("deduplicates identical page views inside one five minute window", () => {
  const visitorDigest = digestSponsorshipVisitorToken(TOKEN).digest
  const common = {
    visitorDigest,
    advocateHostname: "hope.creatorshare.com",
    pagePath: "/sponsorships/amina",
    authUserId: null,
  }
  const first = createQualifiedExposureEventKey({
    ...common,
    observedAt: new Date("2026-07-17T12:01:00.000Z"),
  })
  const replay = createQualifiedExposureEventKey({
    ...common,
    observedAt: new Date("2026-07-17T12:04:59.000Z"),
  })
  const nextWindow = createQualifiedExposureEventKey({
    ...common,
    observedAt: new Date("2026-07-17T12:05:00.000Z"),
  })

  expect(first).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  )
  expect(replay).toBe(first)
  expect(nextWindow).not.toBe(first)
})

test("binds exposure identity to advocate, path, and signed-in user", () => {
  const visitorDigest = digestSponsorshipVisitorToken(TOKEN).digest
  const observedAt = new Date("2026-07-17T12:01:00.000Z")
  const base = createQualifiedExposureEventKey({
    visitorDigest,
    advocateHostname: "hope.creatorshare.com",
    pagePath: "/sponsorships/amina",
    authUserId: null,
    observedAt,
  })
  const changedPath = createQualifiedExposureEventKey({
    visitorDigest,
    advocateHostname: "hope.creatorshare.com",
    pagePath: "/sponsorships/juma",
    authUserId: null,
    observedAt,
  })
  const changedUser = createQualifiedExposureEventKey({
    visitorDigest,
    advocateHostname: "hope.creatorshare.com",
    pagePath: "/sponsorships/amina",
    authUserId: "00000000-0000-4000-8000-000000000001",
    observedAt,
  })

  // This test was named for the advocate but never varied it, which is why a
  // mutation dropping the hostname from the digest survived. One visitor
  // viewing the same page path on two tenants inside one five-minute window
  // would then produce the identical event key, so the second tenant's
  // exposure is silently discarded as a replay and that advocate loses the
  // attribution the sponsorship should have credited.
  const changedAdvocate = createQualifiedExposureEventKey({
    visitorDigest,
    advocateHostname: "second.creatorshare.com",
    pagePath: "/sponsorships/amina",
    authUserId: null,
    observedAt,
  })

  // The visitor is the remaining input, and a key that ignored it would
  // collapse every visitor on a tenant into one exposure.
  const changedVisitor = createQualifiedExposureEventKey({
    visitorDigest: Uint8Array.from(visitorDigest, (byte, index) =>
      index === 0 ? byte ^ 1 : byte,
    ),
    advocateHostname: "hope.creatorshare.com",
    pagePath: "/sponsorships/amina",
    authUserId: null,
    observedAt,
  })

  expect(changedPath).not.toBe(base)
  expect(changedUser).not.toBe(base)
  expect(changedAdvocate).not.toBe(base)
  expect(changedVisitor).not.toBe(base)
})

test("module is explicitly poisoned against browser imports", async () => {
  const source = await readFile(
    resolve(process.cwd(), "src/lib/sponsorships/exposure.ts"),
    "utf8",
  )
  expect(source.startsWith('import "server-only"')).toBe(true)
})
