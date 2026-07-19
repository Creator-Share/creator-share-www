import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

import {
  ADVOCATE_INVITATION_PATH,
  ADVOCATE_INVITATION_REDEEM_PATH,
  buildAdvocateInvitationFragment,
  buildAdvocateInvitationLink,
  parseAdvocateInvitationFragment,
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

  test("accepts only the exact bounded redeem body", () => {
    const rawBody = JSON.stringify(MATERIAL)
    expect(parseAdvocateInvitationRedeemBody(rawBody)).toEqual(MATERIAL)
    expect(Object.isFrozen(parseAdvocateInvitationRedeemBody(rawBody))).toBe(
      true,
    )

    for (const invalid of [
      "{}",
      JSON.stringify({ ...MATERIAL, email: "person@example.com" }),
      JSON.stringify({ ...MATERIAL, version: 2 }),
      JSON.stringify({ ...MATERIAL, capability: "a".repeat(63) }),
      JSON.stringify({ ...MATERIAL, authTokenHash: "short" }),
      JSON.stringify({ ...MATERIAL, authType: "invite" }),
      `{"value":"${"a".repeat(2_100)}"}`,
      "not-json",
      `{"capability":"${MATERIAL.capability}","capability":"${MATERIAL.capability}","authTokenHash":"${MATERIAL.authTokenHash}","authType":"magiclink","version":1}`,
      `{"capability":"${MATERIAL.capability}","authTokenHash":"short","authTokenHash":"${MATERIAL.authTokenHash}","authType":"magiclink","version":1}`,
      `{"capability":"${MATERIAL.capability}","authTokenHash":"${MATERIAL.authTokenHash}","authType":"invite","authType":"magiclink","version":1}`,
      `{"capability":"${MATERIAL.capability}","authTokenHash":"${MATERIAL.authTokenHash}","authType":"magiclink","version":2,"version":1}`,
      JSON.stringify({
        version: 1,
        authType: "magiclink",
        authTokenHash: MATERIAL.authTokenHash,
        capability: MATERIAL.capability,
      }),
    ]) {
      expect(parseAdvocateInvitationRedeemBody(invalid)).toBeNull()
    }
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
      "const rawFragment = window.location.hash",
    )
    const stripIndex = rendered.html.indexOf("window.history.replaceState")
    const parseIndex = rendered.html.indexOf("new URLSearchParams")
    const submitIndex = rendered.html.indexOf('form.addEventListener("submit"')
    const fetchIndex = rendered.html.indexOf("await fetch")

    expect(captureIndex).toBeGreaterThan(0)
    expect(stripIndex).toBeGreaterThan(captureIndex)
    expect(parseIndex).toBeGreaterThan(stripIndex)
    expect(submitIndex).toBeGreaterThan(parseIndex)
    expect(fetchIndex).toBeGreaterThan(submitIndex)
    expect(rendered.html).toContain(
      `fetch(${JSON.stringify(ADVOCATE_INVITATION_REDEEM_PATH)}`,
    )
    expect(rendered.html).toContain('redirect: "error"')
    expect(rendered.html).toContain('credentials: "same-origin"')
    expect(rendered.html).toContain('payload.redirect !== "/portal"')
    expect(rendered.html).not.toContain("sessionStorage")
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
    const redeemBodies: unknown[] = []
    const redeemRequests: Array<{ url: string; referer: string | undefined }> =
      []
    await page.route(`**${ADVOCATE_INVITATION_REDEEM_PATH}`, async (route) => {
      const request = route.request()
      redeemBodies.push(request.postDataJSON())
      redeemRequests.push({
        url: request.url(),
        referer: request.headers().referer,
      })
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ redirect: "/portal" }),
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

    await expect(page).toHaveURL(new RegExp(`${ADVOCATE_INVITATION_PATH}$`))
    expect(page.url()).not.toContain(MATERIAL.capability)
    expect(page.url()).not.toContain(MATERIAL.authTokenHash)
    expect(redeemBodies).toHaveLength(0)
    await expect(
      page.getByRole("button", { name: "Continue securely" }),
    ).toBeEnabled()

    await page.getByRole("button", { name: "Continue securely" }).click()
    await expect.poll(() => redeemBodies.length).toBe(1)
    expect(redeemBodies).toEqual([MATERIAL])
    expect(redeemRequests).toEqual([
      {
        url: `${new URL(ADVOCATE_INVITATION_REDEEM_PATH, page.url()).origin}${ADVOCATE_INVITATION_REDEEM_PATH}`,
        referer: undefined,
      },
    ])
    await expect(page).toHaveURL(/\/portal$/)
  })
})
