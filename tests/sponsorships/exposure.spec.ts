import { readFile } from "node:fs/promises"
import Module, { createRequire } from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

type ExposureModule = typeof import("../../src/lib/sponsorships/exposure")
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
nodeModule._load = originalModuleLoad

const {
  createQualifiedExposureEventKey,
  digestSponsorshipVisitorToken,
  getQualifiedExposureContext,
  shouldRejectExposureRequest,
} = exposure

const TOKEN = "A".repeat(43)

test("accepts a same-origin browser request and rejects automation hints", () => {
  expect(
    shouldRejectExposureRequest(
      new Headers({
        "sec-fetch-site": "same-origin",
        "user-agent": "Mozilla/5.0 Mobile Safari/605.1.15",
      }),
    ),
  ).toBe(false)
  expect(
    shouldRejectExposureRequest(
      new Headers({ purpose: "prefetch", "user-agent": "Mozilla/5.0" }),
    ),
  ).toBe(true)
  expect(
    shouldRejectExposureRequest(
      new Headers({ "user-agent": "Googlebot/2.1" }),
    ),
  ).toBe(true)
  expect(
    shouldRejectExposureRequest(
      new Headers({
        "sec-fetch-site": "cross-site",
        "user-agent": "Mozilla/5.0",
      }),
    ),
  ).toBe(true)
})

test("derives page context only from the exact same host referrer", () => {
  expect(
    getQualifiedExposureContext(
      "https://hope.creatorshare.com/sponsorships/amina?utm_source=social",
      "hope.creatorshare.com",
      null,
    ),
  ).toEqual({ pagePath: "/sponsorships/amina", referrerHost: null })
  expect(
    getQualifiedExposureContext(
      "https://hope.creatorshare.com.evil.example/sponsorships/amina",
      "hope.creatorshare.com",
      null,
    ),
  ).toBeNull()
  expect(
    getQualifiedExposureContext(
      "http://hope.localhost:3000/sponsorships/amina",
      "hope.localhost",
      3000,
    ),
  ).toEqual({ pagePath: "/sponsorships/amina", referrerHost: null })
})

test("hashes the opaque visitor token before database transport", () => {
  const result = digestSponsorshipVisitorToken(TOKEN)

  expect(result.digest).toHaveLength(32)
  expect(result.digestRpcBytea).toMatch(/^\\x[0-9a-f]{64}$/)
  expect(result.digestRpcBytea).not.toContain(TOKEN)
  expect(() => digestSponsorshipVisitorToken("bad-token")).toThrow(
    "Invalid sponsorship visitor token",
  )
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

  expect(changedPath).not.toBe(base)
  expect(changedUser).not.toBe(base)
})

test("module is explicitly poisoned against browser imports", async () => {
  const source = await readFile(
    resolve(process.cwd(), "src/lib/sponsorships/exposure.ts"),
    "utf8",
  )
  expect(source.startsWith('import "server-only"')).toBe(true)
})
