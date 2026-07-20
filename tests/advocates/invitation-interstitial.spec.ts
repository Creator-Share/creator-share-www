import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

import {
  ADVOCATE_INVITATION_AUTHENTICATE_PATH,
  ADVOCATE_INVITATION_PATH,
  ADVOCATE_INVITATION_RECOVER_PATH,
  ADVOCATE_INVITATION_REDEEM_PATH,
  buildAdvocateInvitationFragment,
  buildAdvocateInvitationLink,
  parseAdvocateInvitationAuthenticateBody,
  parseAdvocateInvitationFragment,
  parseAdvocateInvitationRecoveryBody,
  parseAdvocateInvitationRedeemBody,
} from "../../src/lib/advocates/invitations/material"

type InterstitialModule =
  typeof import("../../src/lib/advocates/invitations/interstitial")
type RouteModule = typeof import("../../src/app/advocate-invitation/route")
type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown

process.env.VERCEL_URL = "preview.example.test"

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
  resolve(process.cwd(), "tests/advocates/invitation-interstitial.spec.ts"),
)
const interstitial = testRequire(
  "../../src/lib/advocates/invitations/interstitial",
) as InterstitialModule
const invitationRoute = testRequire(
  "../../src/app/advocate-invitation/route",
) as RouteModule
nodeModule._load = originalModuleLoad

const MATERIAL = Object.freeze({
  capability: "a".repeat(64),
  authTokenHash: "Auth_hash.value~with-safe-characters_".repeat(2),
  authType: "magiclink" as const,
  version: 1 as const,
})
const SIGNUP_MATERIAL = Object.freeze({
  ...MATERIAL,
  authType: "signup" as const,
})
const OPERATION_ID = "11111111-1111-4111-8111-111111111111"
const AUTHENTICATION_REQUEST = Object.freeze({
  authTokenHash: MATERIAL.authTokenHash,
  authType: MATERIAL.authType,
  version: 1 as const,
})
const REDEMPTION_REQUEST = Object.freeze({
  capability: MATERIAL.capability,
  operationId: OPERATION_ID,
  version: 1 as const,
})
const RECOVERY_REQUEST = Object.freeze({
  operationId: OPERATION_ID,
  version: 1 as const,
})
const RECOVERY_STORAGE_KEY = "creator_share_advocate_invitation_redemption_v1"

test.describe("advocate invitation secret transport", () => {
  test("places both capabilities in the fragment and never in the request target", () => {
    const link = buildAdvocateInvitationLink({
      canonicalOrigin: "https://creatorshare.com",
      material: MATERIAL,
    })
    const url = new URL(link)

    expect(url.origin).toBe("https://creatorshare.com")
    expect(url.pathname).toBe(ADVOCATE_INVITATION_PATH)
    expect(url.search).toBe("")
    expect(url.hash).toBe(buildAdvocateInvitationFragment(MATERIAL))
    expect(parseAdvocateInvitationFragment(url.hash)).toEqual(MATERIAL)
    expect(link.slice(0, link.indexOf("#"))).not.toContain(MATERIAL.capability)
    expect(link.slice(0, link.indexOf("#"))).not.toContain(
      MATERIAL.authTokenHash,
    )

    const signupFragment = buildAdvocateInvitationFragment(SIGNUP_MATERIAL)
    expect(parseAdvocateInvitationFragment(signupFragment)).toEqual(
      SIGNUP_MATERIAL,
    )
  })

  test("rejects malformed, duplicate, extra, and noncanonical material", () => {
    const validFragment = buildAdvocateInvitationFragment(MATERIAL)
    const invalidFragments = [
      "",
      validFragment.slice(1),
      `${validFragment}&capability=${MATERIAL.capability}`,
      `${validFragment}&email=person%40example.com`,
      validFragment.replace("v=1", "v=2"),
      validFragment.replace(MATERIAL.capability, "A".repeat(64)),
      validFragment.replace(/auth=[^&]+/, "auth=short"),
      validFragment.replace("magiclink", "invite"),
      `#${"a".repeat(1_600)}`,
    ]
    for (const fragment of invalidFragments) {
      expect(parseAdvocateInvitationFragment(fragment)).toBeNull()
    }

    for (const canonicalOrigin of [
      "not-a-url",
      "https://user@example.com",
      "http://creatorshare.com",
      "ftp://creatorshare.com",
      "ws://creatorshare.com",
      "https://evil.example",
      "https://www.creatorshare.com",
      "https://creatorshare.com:444",
      "https://creatorshare.com/path",
      "https://creatorshare.com?source=mail",
      "https://creatorshare.com#fragment",
    ]) {
      expect(() =>
        buildAdvocateInvitationLink({ canonicalOrigin, material: MATERIAL }),
      ).toThrow("advocate_invitation_material_invalid")
    }

    expect(
      buildAdvocateInvitationLink({
        canonicalOrigin: "http://localhost:3000",
        material: MATERIAL,
        allowDevelopmentLoopback: true,
      }),
    ).toMatch(/^http:\/\/localhost:3000\/advocate-invitation#/)
    expect(() =>
      buildAdvocateInvitationLink({
        canonicalOrigin: "http://localhost:3000",
        material: MATERIAL,
      }),
    ).toThrow("advocate_invitation_material_invalid")
  })

  test("keeps builder and parser bounds identical after URL encoding", () => {
    const maximum = { ...MATERIAL, authTokenHash: "~".repeat(384) }
    const fragment = buildAdvocateInvitationFragment(maximum)
    expect(fragment.length).toBeLessThanOrEqual(1_536)
    expect(parseAdvocateInvitationFragment(fragment)).toEqual(maximum)

    expect(() =>
      buildAdvocateInvitationFragment({
        ...MATERIAL,
        authTokenHash: "~".repeat(385),
      }),
    ).toThrow("advocate_invitation_material_invalid")
    expect(
      parseAdvocateInvitationFragment(
        `#v=1&capability=${MATERIAL.capability}&auth=${"a".repeat(1_400)}&type=magiclink`,
      ),
    ).toBeNull()
  })

  test("accepts only the three exact bounded two-response bodies", () => {
    expect(
      parseAdvocateInvitationAuthenticateBody(
        JSON.stringify(AUTHENTICATION_REQUEST),
      ),
    ).toEqual(AUTHENTICATION_REQUEST)
    expect(
      parseAdvocateInvitationRedeemBody(JSON.stringify(REDEMPTION_REQUEST)),
    ).toEqual(REDEMPTION_REQUEST)
    expect(
      parseAdvocateInvitationRecoveryBody(JSON.stringify(RECOVERY_REQUEST)),
    ).toEqual(RECOVERY_REQUEST)
    expect(
      Object.isFrozen(
        parseAdvocateInvitationRecoveryBody(JSON.stringify(RECOVERY_REQUEST)),
      ),
    ).toBe(true)

    for (const invalid of [
      "{}",
      JSON.stringify({ ...REDEMPTION_REQUEST, email: "person@example.com" }),
      JSON.stringify({ ...REDEMPTION_REQUEST, version: 2 }),
      JSON.stringify({ ...REDEMPTION_REQUEST, capability: "a".repeat(63) }),
      JSON.stringify({ ...REDEMPTION_REQUEST, operationId: "not-v4" }),
      `{"value":"${"a".repeat(2_100)}"}`,
      "not-json",
      `{"capability":"${MATERIAL.capability}","capability":"${MATERIAL.capability}","operationId":"${OPERATION_ID}","version":1}`,
      JSON.stringify({
        version: 1,
        capability: MATERIAL.capability,
        operationId: OPERATION_ID,
      }),
    ]) {
      expect(parseAdvocateInvitationRedeemBody(invalid)).toBeNull()
    }

    expect(
      parseAdvocateInvitationAuthenticateBody(
        JSON.stringify({ ...AUTHENTICATION_REQUEST, authTokenHash: "short" }),
      ),
    ).toBeNull()
    expect(
      parseAdvocateInvitationAuthenticateBody(
        JSON.stringify({
          ...AUTHENTICATION_REQUEST,
          authType: "signup",
        }),
      ),
    ).toEqual({
      ...AUTHENTICATION_REQUEST,
      authType: "signup",
    })
    expect(
      parseAdvocateInvitationAuthenticateBody(
        JSON.stringify({ ...AUTHENTICATION_REQUEST, authType: "email" }),
      ),
    ).toBeNull()
    expect(
      parseAdvocateInvitationRecoveryBody(
        JSON.stringify({ version: 1, operationId: OPERATION_ID }),
      ),
    ).toBeNull()
  })
})

test.describe("advocate invitation interstitial", () => {
  test("serves only approved primary hosts and implements an empty HEAD", async () => {
    const response = await invitationRoute.GET(
      new Request("https://internal.example/advocate-invitation", {
        headers: { host: "creatorshare.com" },
      }),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get("content-security-policy")).toContain(
      "default-src 'none'",
    )
    expect(response.headers.get("cache-control")).toContain("no-store")
    expect(await response.text()).not.toContain("_next/static")

    const head = await invitationRoute.HEAD(
      new Request("https://internal.example/advocate-invitation", {
        method: "HEAD",
        headers: { host: "creatorshare.com" },
      }),
    )
    expect(head.status).toBe(200)
    expect(await head.text()).toBe("")
    expect(head.headers.get("content-security-policy")).toContain(
      "default-src 'none'",
    )

    for (const host of [
      "www.creatorshare.com",
      "creator-share-www.vercel.app",
      "preview.example.test",
      "hope.creatorshare.com",
      "nested.hope.creatorshare.com",
      "evil.example",
      "",
    ]) {
      const denied = await invitationRoute.GET(
        new Request("https://internal.example/advocate-invitation", {
          headers: host ? { host } : {},
        }),
      )
      expect(denied.status).toBe(404)
      expect(await denied.text()).toBe("")
      expect(denied.headers.get("referrer-policy")).toBe("no-referrer")
    }

    for (const target of [
      "https://internal.example/advocate-invitation?source=email",
      `https://internal.example/advocate-invitation?capability=${MATERIAL.capability}`,
      "https://internal.example/advocate-invitation/extra",
      "https://internal.example/wrong-path",
    ]) {
      const denied = await invitationRoute.GET(
        new Request(target, { headers: { host: "creatorshare.com" } }),
      )
      expect(denied.status).toBe(404)
      expect(await denied.text()).toBe("")
    }
  })

  test("is a no-store isolated document with nonce-bound local code only", () => {
    const nonce = "A".repeat(24)
    const rendered = interstitial.createAdvocateInvitationInterstitial(nonce)

    expect(rendered.headers).toMatchObject({
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Type": "text/html; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Resource-Policy": "same-origin",
    })
    expect(rendered.headers["Content-Security-Policy"]).toBe(
      "default-src 'none'; base-uri 'none'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'none'; script-src 'nonce-AAAAAAAAAAAAAAAAAAAAAAAA'; style-src 'nonce-AAAAAAAAAAAAAAAAAAAAAAAA'",
    )
    expect(rendered.html).toContain(`<script nonce="${nonce}">`)
    expect(rendered.html).toContain(`<style nonce="${nonce}">`)
    expect(rendered.html).not.toMatch(
      /<script[^>]+src=|analytics|gtag|segment|facebook|pixel/i,
    )
    expect(rendered.html).not.toContain("@")
  })

  test("strips the fragment before validation and waits for explicit continuation", () => {
    const rendered = interstitial.createAdvocateInvitationInterstitial(
      "B".repeat(24),
    )
    const captureIndex = rendered.html.indexOf(
      "let rawFragment = window.location.hash",
    )
    const stripIndex = rendered.html.indexOf("window.history.replaceState")
    const parseIndex = rendered.html.indexOf("new URLSearchParams")
    const submitIndex = rendered.html.indexOf('form.addEventListener("submit"')
    const fetchIndex = rendered.html.indexOf("await fetch")

    expect(captureIndex).toBeGreaterThan(0)
    expect(stripIndex).toBeGreaterThan(captureIndex)
    expect(parseIndex).toBeGreaterThan(stripIndex)
    expect(submitIndex).toBeGreaterThan(parseIndex)
    expect(fetchIndex).toBeGreaterThan(parseIndex)
    expect(rendered.html).toContain(
      `fetch(${JSON.stringify(ADVOCATE_INVITATION_AUTHENTICATE_PATH)}`,
    )
    expect(rendered.html).toContain(
      `fetch(${JSON.stringify(ADVOCATE_INVITATION_REDEEM_PATH)}`,
    )
    expect(rendered.html).toContain(
      `fetch(${JSON.stringify(ADVOCATE_INVITATION_RECOVER_PATH)}`,
    )
    expect(rendered.html).toContain('redirect: "error"')
    expect(rendered.html).toContain('credentials: "same-origin"')
    expect(rendered.html).toContain("window.sessionStorage.setItem")
    expect(rendered.html).toContain("window.sessionStorage.removeItem")
    expect(rendered.html).toContain("window.crypto.randomUUID")
    expect(rendered.html).not.toContain("localStorage")
  })

  test("fails closed when the CSP nonce cannot be proven safe", () => {
    for (const nonce of [
      "short",
      "A".repeat(23),
      "A".repeat(25),
      "A".repeat(23) + "+",
    ]) {
      expect(() =>
        interstitial.createAdvocateInvitationInterstitial(nonce),
      ).toThrow("advocate_invitation_interstitial_unavailable")
    }
  })

  test("removes secrets from browser history before explicit redemption", async ({
    page,
  }) => {
    const authenticationBodies: unknown[] = []
    const redeemBodies: unknown[] = []
    const requests: Array<{ url: string; referer: string | undefined }> = []
    const recoveryBodies: unknown[] = []
    await page.route(
      `**${ADVOCATE_INVITATION_AUTHENTICATE_PATH}`,
      async (route) => {
        const request = route.request()
        authenticationBodies.push(request.postDataJSON())
        requests.push({
          url: request.url(),
          referer: request.headers().referer,
        })
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        })
      },
    )
    await page.route(`**${ADVOCATE_INVITATION_REDEEM_PATH}`, async (route) => {
      const request = route.request()
      const redemption = request.postDataJSON() as Record<string, unknown>
      redeemBodies.push(redemption)
      requests.push({
        url: request.url(),
        referer: request.headers().referer,
      })
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          operationId: redemption.operationId,
          redirect: "/portal",
        }),
      })
    })
    await page.route(`**${ADVOCATE_INVITATION_RECOVER_PATH}`, async (route) => {
      recoveryBodies.push(route.request().postDataJSON())
      await route.fulfill({ status: 500, body: "unexpected recovery" })
    })
    await page.route("**/portal", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><title>Portal</title>",
      }),
    )

    await page.goto(
      `${ADVOCATE_INVITATION_PATH}${buildAdvocateInvitationFragment(MATERIAL)}`,
    )
    const browserOrigin = new URL(page.url()).origin

    await expect(page).toHaveURL(new RegExp(`${ADVOCATE_INVITATION_PATH}$`))
    expect(page.url()).not.toContain(MATERIAL.capability)
    expect(page.url()).not.toContain(MATERIAL.authTokenHash)
    expect(authenticationBodies).toHaveLength(0)
    expect(redeemBodies).toHaveLength(0)
    await expect(
      page.getByRole("button", { name: "Continue securely" }),
    ).toBeEnabled()

    await page.getByRole("button", { name: "Continue securely" }).click()
    await expect.poll(() => authenticationBodies.length).toBe(1)
    await expect.poll(() => redeemBodies.length).toBe(1)
    expect(authenticationBodies).toEqual([AUTHENTICATION_REQUEST])
    expect(redeemBodies).toEqual([
      {
        capability: MATERIAL.capability,
        operationId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
        version: 1,
      },
    ])
    expect(recoveryBodies).toEqual([])
    expect(requests).toEqual([
      {
        url: `${browserOrigin}${ADVOCATE_INVITATION_AUTHENTICATE_PATH}`,
        referer: undefined,
      },
      {
        url: `${browserOrigin}${ADVOCATE_INVITATION_REDEEM_PATH}`,
        referer: undefined,
      },
    ])
    await expect(page).toHaveURL(/\/portal$/)
    expect(
      await page.evaluate(() =>
        sessionStorage.getItem(
          "creator_share_advocate_invitation_redemption_v1",
        ),
      ),
    ).toBeNull()
  })

  test("carries a signup proof from the fragment into authentication", async ({
    page,
  }) => {
    const authenticationBodies: unknown[] = []
    await page.route(
      `**${ADVOCATE_INVITATION_AUTHENTICATE_PATH}`,
      async (route) => {
        authenticationBodies.push(route.request().postDataJSON())
        await route.fulfill({
          status: 410,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, code: "invalid_or_expired" }),
        })
      },
    )

    await page.goto(
      `${ADVOCATE_INVITATION_PATH}${buildAdvocateInvitationFragment(SIGNUP_MATERIAL)}`,
    )
    await page.getByRole("button", { name: "Continue securely" }).click()

    await expect.poll(() => authenticationBodies.length).toBe(1)
    expect(authenticationBodies).toEqual([
      {
        authTokenHash: SIGNUP_MATERIAL.authTokenHash,
        authType: "signup",
        version: 1,
      },
    ])
    await expect(page.getByRole("status")).toContainText("invalid or expired")
  })

  test("recovers a committed acceptance after the redemption response is lost", async ({
    page,
  }) => {
    const redemptionBodies: Array<Record<string, unknown>> = []
    const recoveryBodies: unknown[] = []
    let releaseRecovery: () => void = () => {
      throw new Error("recovery request did not wait for confirmation")
    }

    await page.route(`**${ADVOCATE_INVITATION_AUTHENTICATE_PATH}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      }),
    )
    await page.route(`**${ADVOCATE_INVITATION_REDEEM_PATH}`, async (route) => {
      redemptionBodies.push(
        route.request().postDataJSON() as Record<string, unknown>,
      )
      await route.abort("failed")
    })
    await page.route(`**${ADVOCATE_INVITATION_RECOVER_PATH}`, async (route) => {
      const recovery = route.request().postDataJSON() as Record<string, unknown>
      recoveryBodies.push(recovery)
      await new Promise<void>((resolveRecovery) => {
        releaseRecovery = resolveRecovery
      })
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          operationId: recovery.operationId,
          redirect: "/portal",
        }),
      })
    })
    await page.route("**/portal", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><title>Portal</title>",
      }),
    )

    await page.goto(
      `${ADVOCATE_INVITATION_PATH}${buildAdvocateInvitationFragment(MATERIAL)}`,
    )
    await page.getByRole("button", { name: "Continue securely" }).click()
    await expect.poll(() => redemptionBodies.length).toBe(1)
    await expect.poll(() => recoveryBodies.length).toBe(1)

    const redemption = redemptionBodies[0]
    const operationId = redemption.operationId
    expect(recoveryBodies).toEqual([{ operationId, version: 1 }])
    expect(Object.keys(recoveryBodies[0] as object).sort()).toEqual([
      "operationId",
      "version",
    ])
    expect(
      await page.evaluate((storageKey) => {
        const stored = sessionStorage.getItem(storageKey)
        return { length: sessionStorage.length, stored }
      }, RECOVERY_STORAGE_KEY),
    ).toEqual({
      length: 1,
      stored: JSON.stringify({ operationId, version: 1 }),
    })

    releaseRecovery()

    await expect(page).toHaveURL(/\/portal$/)
    expect(
      await page.evaluate(
        (storageKey) => sessionStorage.getItem(storageKey),
        RECOVERY_STORAGE_KEY,
      ),
    ).toBeNull()
  })

  test("retries the same email proof when its successful response is lost", async ({
    page,
  }) => {
    const authenticationBodies: unknown[] = []
    const redemptionBodies: Array<Record<string, unknown>> = []
    await page.route(
      `**${ADVOCATE_INVITATION_AUTHENTICATE_PATH}`,
      async (route) => {
        authenticationBodies.push(route.request().postDataJSON())
        if (authenticationBodies.length === 1) {
          await route.abort("failed")
          return
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        })
      },
    )
    await page.route(`**${ADVOCATE_INVITATION_REDEEM_PATH}`, async (route) => {
      const redemption = route.request().postDataJSON() as Record<
        string,
        unknown
      >
      redemptionBodies.push(redemption)
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          operationId: redemption.operationId,
          redirect: "/portal",
        }),
      })
    })
    await page.route("**/portal", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><title>Portal</title>",
      }),
    )

    await page.goto(
      `${ADVOCATE_INVITATION_PATH}${buildAdvocateInvitationFragment(MATERIAL)}`,
    )
    await page.getByRole("button", { name: "Continue securely" }).click()

    await expect(
      page.getByRole("button", { name: "Try email verification again" }),
    ).toBeEnabled()
    expect(authenticationBodies).toEqual([AUTHENTICATION_REQUEST])
    expect(redemptionBodies).toEqual([])

    await page
      .getByRole("button", { name: "Try email verification again" })
      .click()

    await expect(page).toHaveURL(/\/portal$/)
    expect(authenticationBodies).toEqual([
      AUTHENTICATION_REQUEST,
      AUTHENTICATION_REQUEST,
    ])
    expect(redemptionBodies).toHaveLength(1)
  })

  test("retains invitation material when authentication capacity is unavailable", async ({
    page,
  }) => {
    const authenticationBodies: unknown[] = []
    const redemptionBodies: Array<Record<string, unknown>> = []
    await page.route(
      `**${ADVOCATE_INVITATION_AUTHENTICATE_PATH}`,
      async (route) => {
        authenticationBodies.push(route.request().postDataJSON())
        await route.fulfill(
          authenticationBodies.length === 1
            ? {
                status: 503,
                contentType: "application/json",
                body: JSON.stringify({
                  ok: false,
                  code: "authentication_unavailable",
                }),
              }
            : {
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({ ok: true }),
              },
        )
      },
    )
    await page.route(`**${ADVOCATE_INVITATION_REDEEM_PATH}`, async (route) => {
      const redemption = route.request().postDataJSON() as Record<
        string,
        unknown
      >
      redemptionBodies.push(redemption)
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          operationId: redemption.operationId,
          redirect: "/portal",
        }),
      })
    })
    await page.route("**/portal", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><title>Portal</title>",
      }),
    )

    await page.goto(
      `${ADVOCATE_INVITATION_PATH}${buildAdvocateInvitationFragment(MATERIAL)}`,
    )
    await page.getByRole("button", { name: "Continue securely" }).click()

    await expect(
      page.getByRole("button", { name: "Try email verification again" }),
    ).toBeEnabled()
    expect(authenticationBodies).toEqual([AUTHENTICATION_REQUEST])
    expect(redemptionBodies).toEqual([])

    await page
      .getByRole("button", { name: "Try email verification again" })
      .click()

    await expect(page).toHaveURL(/\/portal$/)
    expect(authenticationBodies).toEqual([
      AUTHENTICATION_REQUEST,
      AUTHENTICATION_REQUEST,
    ])
    expect(redemptionBodies).toHaveLength(1)
  })

  test("treats a malformed success response as ambiguous and recovers", async ({
    page,
  }) => {
    const redemptionBodies: Array<Record<string, unknown>> = []
    const recoveryBodies: unknown[] = []
    await page.route(`**${ADVOCATE_INVITATION_AUTHENTICATE_PATH}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      }),
    )
    await page.route(`**${ADVOCATE_INVITATION_REDEEM_PATH}`, async (route) => {
      redemptionBodies.push(
        route.request().postDataJSON() as Record<string, unknown>,
      )
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      })
    })
    await page.route(`**${ADVOCATE_INVITATION_RECOVER_PATH}`, async (route) => {
      const recovery = route.request().postDataJSON() as Record<string, unknown>
      recoveryBodies.push(recovery)
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          operationId: recovery.operationId,
          redirect: "/portal",
        }),
      })
    })
    await page.route("**/portal", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><title>Portal</title>",
      }),
    )

    await page.goto(
      `${ADVOCATE_INVITATION_PATH}${buildAdvocateInvitationFragment(MATERIAL)}`,
    )
    await page.getByRole("button", { name: "Continue securely" }).click()

    await expect(page).toHaveURL(/\/portal$/)
    expect(redemptionBodies).toHaveLength(1)
    expect(recoveryBodies).toEqual([
      {
        operationId: redemptionBodies[0].operationId,
        version: 1,
      },
    ])
  })

  test("preserves the operation when the redemption session needs reauthentication", async ({
    page,
  }) => {
    const redemptionBodies: Array<Record<string, unknown>> = []
    const recoveryBodies: unknown[] = []
    await page.route(`**${ADVOCATE_INVITATION_AUTHENTICATE_PATH}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      }),
    )
    await page.route(`**${ADVOCATE_INVITATION_REDEEM_PATH}`, async (route) => {
      const redemption = route.request().postDataJSON() as Record<
        string,
        unknown
      >
      redemptionBodies.push(redemption)
      if (redemptionBodies.length === 1) {
        await route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({
            ok: false,
            code: "authentication_required",
          }),
        })
        return
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          operationId: redemption.operationId,
          redirect: "/portal",
        }),
      })
    })
    await page.route(`**${ADVOCATE_INVITATION_RECOVER_PATH}`, async (route) => {
      recoveryBodies.push(route.request().postDataJSON())
      await route.fulfill({
        status: 410,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, code: "invalid_or_expired" }),
      })
    })
    await page.route("**/portal", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><title>Portal</title>",
      }),
    )

    await page.goto(
      `${ADVOCATE_INVITATION_PATH}${buildAdvocateInvitationFragment(MATERIAL)}`,
    )
    await page.getByRole("button", { name: "Continue securely" }).click()

    await expect(
      page.getByRole("link", { name: "Sign in in another tab" }),
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Recover access" }),
    ).toBeEnabled()
    expect(redemptionBodies).toHaveLength(1)
    const operationId = redemptionBodies[0].operationId
    expect(
      await page.evaluate(
        (storageKey) => sessionStorage.getItem(storageKey),
        RECOVERY_STORAGE_KEY,
      ),
    ).toBe(JSON.stringify({ operationId, version: 1 }))

    await page.getByRole("button", { name: "Recover access" }).click()

    await expect(page).toHaveURL(/\/portal$/)
    expect(recoveryBodies).toEqual([{ operationId, version: 1 }])
    expect(redemptionBodies).toEqual([
      {
        capability: MATERIAL.capability,
        operationId,
        version: 1,
      },
      {
        capability: MATERIAL.capability,
        operationId,
        version: 1,
      },
    ])
  })

  test("recovers from an exact stored operation after the interstitial reloads", async ({
    page,
  }) => {
    const authenticationBodies: unknown[] = []
    const redemptionBodies: unknown[] = []
    const recoveryBodies: unknown[] = []
    await page.addInitScript(
      ({ storageKey, operation, invitationPath }) => {
        if (window.location.pathname === invitationPath) {
          sessionStorage.setItem(storageKey, JSON.stringify(operation))
        }
      },
      {
        storageKey: RECOVERY_STORAGE_KEY,
        operation: RECOVERY_REQUEST,
        invitationPath: ADVOCATE_INVITATION_PATH,
      },
    )
    await page.route(
      `**${ADVOCATE_INVITATION_AUTHENTICATE_PATH}`,
      async (route) => {
        authenticationBodies.push(route.request().postDataJSON())
        await route.fulfill({ status: 500, body: "unexpected authentication" })
      },
    )
    await page.route(`**${ADVOCATE_INVITATION_REDEEM_PATH}`, async (route) => {
      redemptionBodies.push(route.request().postDataJSON())
      await route.fulfill({ status: 500, body: "unexpected redemption" })
    })
    await page.route(`**${ADVOCATE_INVITATION_RECOVER_PATH}`, async (route) => {
      const recovery = route.request().postDataJSON() as Record<string, unknown>
      recoveryBodies.push(recovery)
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          operationId: recovery.operationId,
          redirect: "/portal",
        }),
      })
    })
    await page.route("**/portal", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><title>Portal</title>",
      }),
    )

    await page.goto(ADVOCATE_INVITATION_PATH)

    await expect(page).toHaveURL(/\/portal$/)
    expect(authenticationBodies).toEqual([])
    expect(redemptionBodies).toEqual([])
    expect(recoveryBodies).toEqual([RECOVERY_REQUEST])
    expect(
      await page.evaluate(
        (storageKey) => sessionStorage.getItem(storageKey),
        RECOVERY_STORAGE_KEY,
      ),
    ).toBeNull()
  })

  test("allows the same stored operation to be checked again after recovery races redemption", async ({
    page,
  }) => {
    const recoveryBodies: unknown[] = []
    await page.addInitScript(
      ({ storageKey, operation, invitationPath }) => {
        if (window.location.pathname === invitationPath) {
          sessionStorage.setItem(storageKey, JSON.stringify(operation))
        }
      },
      {
        storageKey: RECOVERY_STORAGE_KEY,
        operation: RECOVERY_REQUEST,
        invitationPath: ADVOCATE_INVITATION_PATH,
      },
    )
    await page.route(`**${ADVOCATE_INVITATION_RECOVER_PATH}`, async (route) => {
      const recovery = route.request().postDataJSON() as Record<string, unknown>
      recoveryBodies.push(recovery)
      if (recoveryBodies.length === 1) {
        await route.fulfill({
          status: 410,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, code: "invalid_or_expired" }),
        })
        return
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          operationId: recovery.operationId,
          redirect: "/portal",
        }),
      })
    })
    await page.route("**/portal", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><title>Portal</title>",
      }),
    )

    await page.goto(ADVOCATE_INVITATION_PATH)

    await expect(
      page.getByRole("button", { name: "Check again" }),
    ).toBeEnabled()
    await expect(page.getByRole("status")).toContainText(
      "The original request may still be finishing.",
    )
    expect(recoveryBodies).toEqual([RECOVERY_REQUEST])

    await page.getByRole("button", { name: "Check again" }).click()

    await expect(page).toHaveURL(/\/portal$/)
    expect(recoveryBodies).toEqual([RECOVERY_REQUEST, RECOVERY_REQUEST])
  })

  test("resolves an outstanding operation before processing a reopened invitation link", async ({
    page,
  }) => {
    const authenticationBodies: unknown[] = []
    const redemptionBodies: unknown[] = []
    const recoveryBodies: unknown[] = []
    await page.addInitScript(
      ({ storageKey, operation, invitationPath }) => {
        if (window.location.pathname === invitationPath) {
          sessionStorage.setItem(storageKey, JSON.stringify(operation))
        }
      },
      {
        storageKey: RECOVERY_STORAGE_KEY,
        operation: RECOVERY_REQUEST,
        invitationPath: ADVOCATE_INVITATION_PATH,
      },
    )
    await page.route(
      `**${ADVOCATE_INVITATION_AUTHENTICATE_PATH}`,
      async (route) => {
        authenticationBodies.push(route.request().postDataJSON())
        await route.fulfill({ status: 500, body: "unexpected authentication" })
      },
    )
    await page.route(`**${ADVOCATE_INVITATION_REDEEM_PATH}`, async (route) => {
      redemptionBodies.push(route.request().postDataJSON())
      await route.fulfill({ status: 500, body: "unexpected redemption" })
    })
    await page.route(`**${ADVOCATE_INVITATION_RECOVER_PATH}`, async (route) => {
      const recovery = route.request().postDataJSON() as Record<string, unknown>
      recoveryBodies.push(recovery)
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          operationId: recovery.operationId,
          redirect: "/portal",
        }),
      })
    })
    await page.route("**/portal", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><title>Portal</title>",
      }),
    )

    await page.goto(
      `${ADVOCATE_INVITATION_PATH}${buildAdvocateInvitationFragment(MATERIAL)}`,
    )

    await expect(page).toHaveURL(/\/portal$/)
    expect(authenticationBodies).toEqual([])
    expect(redemptionBodies).toEqual([])
    expect(recoveryBodies).toEqual([RECOVERY_REQUEST])
    expect(page.url()).not.toContain(MATERIAL.capability)
    expect(page.url()).not.toContain(MATERIAL.authTokenHash)
  })

  test("rejects malformed recovery storage without making a request", async ({
    page,
  }) => {
    const endpointRequests: string[] = []
    await page.addInitScript(
      ({ storageKey, operation }) => {
        sessionStorage.setItem(
          storageKey,
          JSON.stringify({ ...operation, capability: "must-not-survive" }),
        )
      },
      { storageKey: RECOVERY_STORAGE_KEY, operation: RECOVERY_REQUEST },
    )
    for (const path of [
      ADVOCATE_INVITATION_AUTHENTICATE_PATH,
      ADVOCATE_INVITATION_REDEEM_PATH,
      ADVOCATE_INVITATION_RECOVER_PATH,
    ]) {
      await page.route(`**${path}`, async (route) => {
        endpointRequests.push(route.request().url())
        await route.fulfill({ status: 500, body: "unexpected request" })
      })
    }

    await page.goto(ADVOCATE_INVITATION_PATH)

    await expect(page.getByRole("status")).toContainText(
      "This invitation link is invalid or incomplete.",
    )
    await expect(page.getByRole("button")).toBeDisabled()
    expect(endpointRequests).toEqual([])
    expect(
      await page.evaluate(
        (storageKey) => sessionStorage.getItem(storageKey),
        RECOVERY_STORAGE_KEY,
      ),
    ).toBeNull()
  })

  test("retains only the operation receipt key when recovery requires sign in", async ({
    page,
  }) => {
    const authenticationBodies: unknown[] = []
    const redemptionBodies: unknown[] = []
    const recoveryBodies: unknown[] = []
    await page.addInitScript(
      ({ storageKey, operation }) => {
        sessionStorage.setItem(storageKey, JSON.stringify(operation))
      },
      { storageKey: RECOVERY_STORAGE_KEY, operation: RECOVERY_REQUEST },
    )
    await page.route(
      `**${ADVOCATE_INVITATION_AUTHENTICATE_PATH}`,
      async (route) => {
        authenticationBodies.push(route.request().postDataJSON())
        await route.fulfill({ status: 500, body: "unexpected authentication" })
      },
    )
    await page.route(`**${ADVOCATE_INVITATION_REDEEM_PATH}`, async (route) => {
      redemptionBodies.push(route.request().postDataJSON())
      await route.fulfill({ status: 500, body: "unexpected redemption" })
    })
    await page.route(`**${ADVOCATE_INVITATION_RECOVER_PATH}`, async (route) => {
      recoveryBodies.push(route.request().postDataJSON())
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, code: "authentication_required" }),
      })
    })

    await page.goto(ADVOCATE_INVITATION_PATH)

    await expect(
      page.getByRole("link", { name: "Sign in in another tab" }),
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Recover access" }),
    ).toBeEnabled()
    await expect(page.getByRole("status")).toContainText(
      "this tab is no longer signed in",
    )
    expect(authenticationBodies).toEqual([])
    expect(redemptionBodies).toEqual([])
    expect(recoveryBodies).toEqual([RECOVERY_REQUEST])
    expect(
      await page.evaluate(
        (storageKey) => ({
          length: sessionStorage.length,
          stored: sessionStorage.getItem(storageKey),
        }),
        RECOVERY_STORAGE_KEY,
      ),
    ).toEqual({
      length: 1,
      stored: JSON.stringify(RECOVERY_REQUEST),
    })
  })
})
