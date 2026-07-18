import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

import type {
  CheckoutStatusRecord,
  CheckoutStatusRepository,
} from "../../src/lib/sponsorships/checkout/status"

type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown
type StatusModule = typeof import("../../src/lib/sponsorships/checkout/status")
type CryptoModule = typeof import("../../src/lib/sponsorships/crypto")
type RequestSecurityModule =
  typeof import("../../src/lib/sponsorships/checkout/requestSecurity")

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
  resolve(process.cwd(), "tests/sponsorships/checkout-status.spec.ts"),
)
const { parseCheckoutStatusBody, readPublicCheckoutStatus } = testRequire(
  "../../src/lib/sponsorships/checkout/status",
) as StatusModule
const {
  isTrustedCheckoutJsonRequest,
  resolveTrustedCheckoutRequestOrigin,
  resolveTrustedPrimaryRequestOrigin,
} = testRequire(
  "../../src/lib/sponsorships/checkout/requestSecurity",
) as RequestSecurityModule
const { createSponsorshipCrypto } = testRequire(
  "../../src/lib/sponsorships/crypto",
) as CryptoModule
nodeModule._load = originalModuleLoad

const APP_SECRET = Buffer.from(
  "creator-share-checkout-status-test-secret-0000000000000",
  "utf8",
).toString("base64")
const OPERATION_ID = "11111111-1111-4111-8111-111111111111"
const sponsorshipCrypto = createSponsorshipCrypto({
  appSecretBase64: APP_SECRET,
})
const receipt = sponsorshipCrypto.deriveCheckoutReceipt(OPERATION_ID)

function repositoryFor(
  value: CheckoutStatusRecord | null,
): CheckoutStatusRepository & { digests: string[] } {
  const digests: string[] = []
  return {
    digests,
    async readByReceiptDigest(digest) {
      digests.push(digest)
      return value
    },
  }
}

test.describe("checkout request security", () => {
  test("accepts exact primary and advocate origins", () => {
    expect(
      resolveTrustedCheckoutRequestOrigin({
        rawHost: "creatorshare.com",
        environment: { NODE_ENV: "production" },
      }),
    ).toBe("https://creatorshare.com")
    expect(
      resolveTrustedCheckoutRequestOrigin({
        rawHost: "alice.creatorshare.com",
        environment: { NODE_ENV: "production" },
      }),
    ).toBe("https://alice.creatorshare.com")
    expect(
      resolveTrustedCheckoutRequestOrigin({
        rawHost: "alice.creatorshare.com:443",
        environment: { NODE_ENV: "production" },
      }),
    ).toBe("https://alice.creatorshare.com")
    expect(
      resolveTrustedCheckoutRequestOrigin({
        rawHost: "alice.localhost:3000",
        environment: { NODE_ENV: "development" },
      }),
    ).toBe("http://alice.localhost:3000")
  })

  test("rejects foreign, malformed, reserved, or production localhost hosts", () => {
    for (const rawHost of [
      "attacker.example",
      "creatorshare.com.attacker.example",
      "alice.creatorshare.com:444",
      "api.creatorshare.com",
      "localhost:3000",
    ]) {
      expect(
        resolveTrustedCheckoutRequestOrigin({
          rawHost,
          environment: { NODE_ENV: "production" },
        }),
      ).toBeNull()
    }
  })

  test("keeps account payment administration on approved primary origins", () => {
    expect(
      resolveTrustedPrimaryRequestOrigin({
        rawHost: "creatorshare.com",
        environment: { NODE_ENV: "production" },
      }),
    ).toBe("https://creatorshare.com")
    expect(
      resolveTrustedPrimaryRequestOrigin({
        rawHost: "localhost:3000",
        environment: { NODE_ENV: "development" },
      }),
    ).toBe("http://localhost:3000")

    for (const rawHost of [
      "alice.creatorshare.com",
      "admin.creatorshare.com",
      "nested.alice.creatorshare.com",
      "attacker.example",
    ]) {
      expect(
        resolveTrustedPrimaryRequestOrigin({
          rawHost,
          environment: { NODE_ENV: "production" },
        }),
      ).toBeNull()
    }
  })

  test("requires exact same origin JSON before body parsing", () => {
    const expectedOrigin = "https://alice.creatorshare.com"
    expect(
      isTrustedCheckoutJsonRequest(
        new Headers({
          origin: expectedOrigin,
          "sec-fetch-site": "same-origin",
          "content-type": "application/json; charset=utf-8",
        }),
        expectedOrigin,
      ),
    ).toBe(true)

    for (const headers of [
      new Headers({
        origin: "https://attacker.example",
        "sec-fetch-site": "cross-site",
        "content-type": "application/json",
      }),
      new Headers({
        origin: expectedOrigin,
        "sec-fetch-site": "cross-site",
        "content-type": "application/json",
      }),
      new Headers({
        origin: expectedOrigin,
        "content-type": "text/plain",
      }),
      new Headers({ "content-type": "application/json" }),
    ]) {
      expect(isTrustedCheckoutJsonRequest(headers, expectedOrigin)).toBe(false)
    }
  })
})

test.describe("opaque checkout status", () => {
  test("parses only one canonical receipt field", () => {
    expect(
      parseCheckoutStatusBody(JSON.stringify({ receipt: receipt.token })),
    ).toBe(receipt.token)
    for (const body of [
      "not-json",
      JSON.stringify({}),
      JSON.stringify({ receipt: "cs_test_provider_id" }),
      JSON.stringify({ receipt: receipt.token, sessionId: "cs_test_leak" }),
      JSON.stringify({ receipt: receipt.token, email: "sponsor@example.com" }),
      JSON.stringify({ receipt: "a".repeat(43) + "!" }),
    ]) {
      expect(parseCheckoutStatusBody(body)).toBeNull()
    }
  })

  test("returns only status for a valid bearer receipt", async () => {
    const repository = repositoryFor({
      checkout_status: "succeeded",
      is_terminal: true,
      status_updated_at: "2026-07-18T10:05:00.000Z",
    })

    await expect(
      readPublicCheckoutStatus({
        receipt: receipt.token,
        crypto: sponsorshipCrypto,
        repository,
      }),
    ).resolves.toEqual({
      status: "succeeded",
      terminal: true,
      updatedAt: "2026-07-18T10:05:00.000Z",
    })
    expect(repository.digests).toEqual([receipt.digestRpcBytea])
  })

  test("does not query storage for malformed receipts and hides misses", async () => {
    const repository = repositoryFor(null)
    await expect(
      readPublicCheckoutStatus({
        receipt: "not-a-receipt",
        crypto: sponsorshipCrypto,
        repository,
      }),
    ).resolves.toEqual({
      status: "unknown",
      terminal: false,
      updatedAt: null,
    })
    expect(repository.digests).toHaveLength(0)

    await expect(
      readPublicCheckoutStatus({
        receipt: receipt.token,
        crypto: sponsorshipCrypto,
        repository,
      }),
    ).resolves.toEqual({
      status: "unknown",
      terminal: false,
      updatedAt: null,
    })
  })

  test("rejects contradictory or unexpected repository state", async () => {
    for (const record of [
      {
        checkout_status: "succeeded",
        is_terminal: false,
        status_updated_at: "2026-07-18T10:05:00.000Z",
      },
      {
        checkout_status: "invented",
        is_terminal: true,
        status_updated_at: "2026-07-18T10:05:00.000Z",
      },
      {
        checkout_status: "pending",
        is_terminal: false,
        status_updated_at: "not-a-time",
      },
    ]) {
      await expect(
        readPublicCheckoutStatus({
          receipt: receipt.token,
          crypto: sponsorshipCrypto,
          repository: repositoryFor(record),
        }),
      ).rejects.toThrow("Invalid checkout status repository response")
    }
  })
})
