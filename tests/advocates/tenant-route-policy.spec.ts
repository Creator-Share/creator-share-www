import { readdirSync } from "node:fs"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

import {
  isAllowedTenantImageOptimizerRequest,
  isRestrictedAdvocateHost,
  resolveCanonicalPrimaryOrigin,
  resolveTenantRoutePolicy,
  type TenantRoutePolicyEnvironment,
} from "@/lib/advocates/tenantRoutePolicy"
import { isQualifyingAdvocateExposurePagePath } from "@/lib/advocates/publicBrowsePaths"

const PRODUCTION_ENVIRONMENT: TenantRoutePolicyEnvironment = Object.freeze({
  NODE_ENV: "production",
  NEXT_PUBLIC_BASE_URL: "https://creatorshare.com",
  NEXT_PUBLIC_SITE_URL: "https://www.creatorshare.com",
  NEXT_PUBLIC_SUPABASE_URL: "https://project-ref.supabase.co",
  VERCEL_URL: "creator-share-www-git-dev.example.vercel.app",
})

const TENANT_HOST = "hope.creatorshare.com"
const BENEFICIARY_ID = "123e4567-e89b-42d3-a456-426614174000"

function decide(
  pathname: string,
  method = "GET",
  rawHost: string | null | undefined = TENANT_HOST,
  environment = PRODUCTION_ENVIRONMENT,
) {
  return resolveTenantRoutePolicy({
    rawHost,
    pathname,
    method,
    environment,
  })
}

test.describe("advocate tenant route policy", () => {
  test("allows only the exact public browse pages", () => {
    for (const pathname of [
      "/",
      "/child_laborers",
      "/special_needs",
      "/in_our_care",
      "/dogs",
      "/about",
      "/centers",
      "/contact",
      "/faq",
    ]) {
      expect(decide(pathname)).toMatchObject({
        kind: "allow",
        neutralPaymentShell: false,
        visitorSession: true,
      })
      expect(decide(pathname, "HEAD")).toMatchObject({ kind: "allow" })
    }

    expect(decide("/sponsorships")).toMatchObject({
      kind: "allow",
      routeId: "catalog-redirect",
      visitorSession: false,
    })
    expect(decide("/sponsorships/child_42.png")).toMatchObject({
      kind: "allow",
      routeId: "beneficiary-profile-page",
      visitorSession: true,
    })
  })

  test("keeps only current hosted payment result pages on the tenant origin", () => {
    for (const pathname of ["/payments/success", "/payments/failed"]) {
      expect(decide(pathname)).toMatchObject({
        kind: "allow",
        neutralPaymentShell: true,
        visitorSession: false,
      })
    }

    for (const legacyPath of [
      "/payments/return",
      "/sponsorships/checkout",
      "/api/stripe/session",
      "/api/stripe/success",
      "/api/paypal/session",
      "/api/paypal/verify",
      "/api/paypal/plan",
    ]) {
      expect(decide(legacyPath)).toEqual({
        kind: "deny",
        status: 404,
        allow: null,
      })
    }
  })

  test("allows the exact catalog and checkout APIs with exact methods", () => {
    for (const pathname of [
      "/api/beneficiaries/get",
      `/api/beneficiaries/get/username/child_42`,
      `/api/beneficiaries/images/${BENEFICIARY_ID}`,
      `/api/beneficiaries/${BENEFICIARY_ID}/activities`,
      "/api/payments/currency",
    ]) {
      expect(decide(pathname)).toMatchObject({ kind: "allow" })
    }

    for (const pathname of [
      "/api/advocates/exposure",
      "/api/stripe",
      "/api/paypal",
      "/api/sponsorships/checkout-status",
    ]) {
      expect(decide(pathname, "POST")).toMatchObject({ kind: "allow" })
    }
    expect(decide("/api/advocates/exposure", "POST")).toMatchObject({
      visitorSession: false,
    })

    expect(decide("/api/stripe", "GET")).toEqual({
      kind: "deny",
      status: 405,
      allow: "POST",
    })
    expect(decide("/api/beneficiaries/get", "POST")).toEqual({
      kind: "deny",
      status: 405,
      allow: "GET",
    })
    expect(decide("/", "DELETE")).toEqual({
      kind: "deny",
      status: 405,
      allow: "GET, HEAD",
    })
  })

  test("allows only the exact protected publication canary POST without a visitor session", () => {
    const path = "/.well-known/creator-share/advocate-publication-canary"

    expect(decide(path, "POST")).toEqual({
      kind: "allow",
      routeId: "advocate-publication-canary",
      neutralPaymentShell: false,
      visitorSession: false,
    })
    expect(decide(path, "GET")).toEqual({
      kind: "deny",
      status: 404,
      allow: null,
    })
    for (const lookalike of [
      `${path}/`,
      `${path}/extra`,
      `${path}-evil`,
      "/.well-known/creator-share",
    ]) {
      expect(decide(lookalike, "POST")).toEqual({
        kind: "deny",
        status: 404,
        allow: null,
      })
    }
  })

  test("denies every administrative, identity, and unrelated primary surface", () => {
    for (const pathname of [
      "/admin",
      "/admin/beneficiary/anything.png",
      "/app",
      "/portal",
      "/portal/hope",
      "/login",
      "/register",
      "/forgot-password",
      "/set-password",
      "/sponsor/claim",
      "/embed",
      "/test-telegram",
      "/api/admin/users",
      "/api/portal/hope",
      "/api/internal/payments/gateway-events",
      "/api/test/create-child",
      "/api/ai/config",
      "/api/proxy/nominatim",
      "/api/auth/attribution-identity",
      "/api/auth/login",
      "/api/sponsor-account/history",
      "/api/sponsorships/subscriptions/cancel",
      "/api/stats",
      "/api/subscribe",
      "/api/animals/get",
      "/anything.png",
    ]) {
      expect(decide(pathname)).toEqual({
        kind: "deny",
        status: 404,
        allow: null,
      })
    }
  })

  test("rejects path lookalikes, malformed segments, and traversal shapes", () => {
    for (const pathname of [
      "/api/stripeevil",
      "/api/stripe.png",
      "/api/webhooks-evil",
      "/api/webhooks/stripe/extra",
      "/api/beneficiaries/getevil",
      "/api/beneficiaries/get/username/checkout",
      "/api/beneficiaries/get/username/alice%2Fadmin",
      "/api/beneficiaries/images/not-a-uuid",
      `/api/beneficiaries/${BENEFICIARY_ID.toUpperCase()}/activities`,
      "/sponsorships/checkout",
      "/sponsorships/../admin",
      "/sponsorships/alice/extra",
      "/sponsorships/alice%2Fextra",
      "/sponsorships//alice",
      "/sponsorships/alice/",
      "/sponsorships\\alice",
      "/_next/static",
      "/_next/staticity/chunk.js",
      "/_next/webpack-hmr-evil",
    ]) {
      expect(decide(pathname)).toEqual({
        kind: "deny",
        status: 404,
        allow: null,
      })
    }
  })

  test("permits only exact framework and shared public assets", () => {
    expect(decide("/_next/static/chunks/app.js")).toMatchObject({
      kind: "bypass",
      reason: "framework-asset",
    })
    expect(decide("/_next/image")).toMatchObject({
      kind: "allow-image-optimizer",
    })

    for (const pathname of [
      "/icon.ico",
      "/favicon.ico",
      "/logo_text.svg",
      "/placeholder-person.svg",
      "/fulfilled.png",
      "/pending.png",
      "/CreatorSharePin.svg",
    ]) {
      expect(decide(pathname)).toMatchObject({
        kind: "bypass",
        reason: "public-asset",
      })
      expect(decide(pathname, "POST")).toEqual({
        kind: "deny",
        status: 405,
        allow: "GET, HEAD",
      })
    }

    expect(decide("/_next/webpack-hmr")).toEqual({
      kind: "deny",
      status: 404,
      allow: null,
    })
    expect(
      decide("/_next/webpack-hmr", "GET", "hope.localhost:3000", {
        ...PRODUCTION_ENVIRONMENT,
        NODE_ENV: "development",
      }),
    ).toMatchObject({ kind: "bypass", reason: "framework-asset" })
  })

  test("bypasses every exact primary public asset without exposing it to tenants", () => {
    for (const pathname of [
      "/bg.png",
      "/celebration-preview.html",
      "/creator-text.svg",
      "/creator.svg",
      "/hero-child-tanzania.png",
      "/john.png",
      "/logo_icon.svg",
      "/logo_text.png",
      "/mockServiceWorker.js",
    ]) {
      expect(decide(pathname, "GET", "creatorshare.com")).toMatchObject({
        kind: "bypass",
        reason: "public-asset",
      })
      expect(decide(pathname)).toEqual({
        kind: "deny",
        status: 404,
        allow: null,
      })
    }
  })

  test("classifies every root public file before session middleware", () => {
    const filenames = readdirSync(resolve(process.cwd(), "public"), {
      withFileTypes: true,
    })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)

    for (const filename of filenames) {
      expect(
        decide(`/${filename}`, "GET", "creatorshare.com"),
        `missing exact route policy for public/${filename}`,
      ).toMatchObject({ kind: "bypass", reason: "public-asset" })
    }
  })

  test("keeps webhook bypass exact and off every tenant hostname", () => {
    for (const pathname of ["/api/webhooks/stripe", "/api/paypal/webhook"]) {
      expect(decide(pathname, "POST")).toEqual({
        kind: "deny",
        status: 404,
        allow: null,
      })
      expect(decide(pathname, "POST", "creatorshare.com")).toMatchObject({
        kind: "bypass",
        reason: "webhook",
      })
    }

    expect(
      decide("/api/webhooks/stripe/extra", "POST", "creatorshare.com"),
    ).toEqual({ kind: "pass-through" })
    expect(decide("/api/paypal/webhook", "GET", "creatorshare.com")).toEqual({
      kind: "pass-through",
    })
  })

  test("canonicalizes only the exact tenant auth callback", () => {
    expect(decide("/auth/callback")).toMatchObject({
      kind: "canonical-auth-callback",
    })
    expect(decide("/auth/callback/extra")).toEqual({
      kind: "deny",
      status: 404,
      allow: null,
    })
    expect(decide("/auth/callback", "POST")).toEqual({
      kind: "deny",
      status: 405,
      allow: "GET",
    })
    expect(decide("/auth/callback", "GET", "creatorshare.com")).toEqual({
      kind: "pass-through",
    })
  })

  test("allows tenant candidates, rejects reserved and nested hosts, and passes approved primary hosts", () => {
    for (const rawHost of [TENANT_HOST]) {
      expect(
        isRestrictedAdvocateHost({
          rawHost,
          environment: PRODUCTION_ENVIRONMENT,
        }),
      ).toBe(true)
      expect(decide("/admin", "GET", rawHost)).toMatchObject({ kind: "deny" })
    }

    for (const rawHost of [
      "admin.creatorshare.com",
      "nested.hope.creatorshare.com",
    ]) {
      expect(
        isRestrictedAdvocateHost({
          rawHost,
          environment: PRODUCTION_ENVIRONMENT,
        }),
      ).toBe(false)
      for (const [pathname, method] of [
        ["/", "GET"],
        ["/payments/success", "GET"],
        ["/_next/image", "GET"],
        ["/api/beneficiaries/get", "GET"],
        ["/api/stripe", "POST"],
        ["/auth/callback", "GET"],
        ["/api/webhooks/stripe", "POST"],
      ] as const) {
        expect(decide(pathname, method, rawHost)).toEqual({
          kind: "deny",
          status: 404,
          allow: null,
        })
      }
    }

    for (const rawHost of [
      "creatorshare.com",
      "creatorshare.com:443",
      "www.creatorshare.com",
      "www.creatorshare.com:80",
      "creator-share-www-git-dev.example.vercel.app",
    ]) {
      expect(
        isRestrictedAdvocateHost({
          rawHost,
          environment: PRODUCTION_ENVIRONMENT,
        }),
      ).toBe(false)
      expect(decide("/admin", "GET", rawHost)).toEqual({
        kind: "pass-through",
      })
    }

    for (const rawHost of [
      "unrelated.example",
      "other-preview.vercel.app",
      "bad host",
      null,
    ]) {
      expect(
        isRestrictedAdvocateHost({
          rawHost,
          environment: PRODUCTION_ENVIRONMENT,
        }),
      ).toBe(false)
      expect(decide("/admin", "GET", rawHost)).toEqual({
        kind: "deny",
        status: 404,
        allow: null,
      })
      expect(decide("/api/webhooks/stripe", "POST", rawHost)).toEqual({
        kind: "deny",
        status: 404,
        allow: null,
      })
    }
  })

  test("opens only the fixed negative sentinel root to the application 404", () => {
    const sentinel = "publication-sentinel.creatorshare.com"
    expect(
      isRestrictedAdvocateHost({
        rawHost: sentinel,
        environment: PRODUCTION_ENVIRONMENT,
      }),
    ).toBe(false)

    for (const method of ["GET", "HEAD"] as const) {
      expect(decide("/", method, sentinel)).toEqual({
        kind: "allow",
        routeId: "publication-negative-sentinel",
        neutralPaymentShell: false,
        visitorSession: false,
      })
    }
    for (const [pathname, method] of [
      ["/", "POST"],
      ["/about", "GET"],
      ["/payments/success", "GET"],
      ["/api/beneficiaries/get", "GET"],
      ["/_next/static/chunks/app.js", "GET"],
      ["/favicon.ico", "GET"],
      ["/logo.png", "GET"],
      ["/.well-known/creator-share/advocate-publication-canary", "POST"],
    ] as const) {
      expect(decide(pathname, method, sentinel)).toEqual({
        kind: "deny",
        status: 404,
        allow: null,
      })
    }
  })

  test("keeps the negative sentinel isolated under hostile primary URL configuration", () => {
    const sentinel = "publication-sentinel.creatorshare.com"

    for (const [variable, configured] of [
      ["NEXT_PUBLIC_BASE_URL", `https://${sentinel}`],
      [
        "NEXT_PUBLIC_SITE_URL",
        "https://PUBLICATION-SENTINEL.CREATORSHARE.COM.",
      ],
      ["VERCEL_URL", sentinel],
    ] as const) {
      const environment = {
        ...PRODUCTION_ENVIRONMENT,
        [variable]: configured,
      }
      expect(decide("/", "GET", sentinel, environment)).toEqual({
        kind: "allow",
        routeId: "publication-negative-sentinel",
        neutralPaymentShell: false,
        visitorSession: false,
      })
      expect(
        decide("/api/webhooks/stripe", "POST", sentinel, environment),
      ).toEqual({ kind: "deny", status: 404, allow: null })
    }
  })

  test("does not let configured URLs promote a tenant or reserved host to primary", () => {
    for (const variable of [
      "NEXT_PUBLIC_BASE_URL",
      "NEXT_PUBLIC_SITE_URL",
      "VERCEL_URL",
    ] as const) {
      for (const configured of [
        "https://hope.creatorshare.com",
        "https://admin.creatorshare.com",
        "https://nested.hope.creatorshare.com",
      ]) {
        const environment = {
          ...PRODUCTION_ENVIRONMENT,
          [variable]: configured,
        }
        expect(
          isRestrictedAdvocateHost({
            rawHost: new URL(configured).hostname,
            environment,
          }),
        ).toBe(new URL(configured).hostname === "hope.creatorshare.com")
        expect(
          decide(
            "/api/webhooks/stripe",
            "POST",
            new URL(configured).hostname,
            environment,
          ),
        ).toEqual({ kind: "deny", status: 404, allow: null })
      }
    }
  })
})

test.describe("tenant image optimizer boundary", () => {
  function imageQuery(source: string, extras: Record<string, string> = {}) {
    return new URLSearchParams({ url: source, w: "640", q: "75", ...extras })
  }

  test("allows only local public assets and exact configured public storage paths", () => {
    for (const source of [
      "/logo_text.svg",
      "/placeholder-person.svg",
      "https://project-ref.supabase.co/storage/v1/object/public/media/parent/IMAGE/image.jpg",
      "https://project-ref.supabase.co/storage/v1/object/public/advocate-assets/hope/logo.webp",
    ]) {
      expect(
        isAllowedTenantImageOptimizerRequest({
          searchParams: imageQuery(source),
          environment: PRODUCTION_ENVIRONMENT,
        }),
      ).toBe(true)
    }
  })

  test("rejects arbitrary projects, private paths, network targets, and malformed queries", () => {
    for (const source of [
      "https://other-project.supabase.co/storage/v1/object/public/media/a.jpg",
      "https://project-ref.supabase.co/storage/v1/object/private/media/a.jpg",
      "https://project-ref.supabase.co/storage/v1/object/public/private/a.jpg",
      "https://project-ref.supabase.co/storage/v1/object/public/media/a.jpg?download=1",
      "http://169.254.169.254/latest/meta-data",
      "http://127.0.0.1:54321/storage/v1/object/public/media/a.jpg",
      "https://example.com/image.jpg",
      "/unapproved.png",
    ]) {
      expect(
        isAllowedTenantImageOptimizerRequest({
          searchParams: imageQuery(source),
          environment: PRODUCTION_ENVIRONMENT,
        }),
      ).toBe(false)
    }

    for (const query of [
      new URLSearchParams("url=/logo_text.svg&q=75"),
      new URLSearchParams("url=/logo_text.svg&w=0&q=75"),
      new URLSearchParams("url=/logo_text.svg&w=99999&q=75"),
      new URLSearchParams("url=/logo_text.svg&w=640&q=101"),
      new URLSearchParams("url=/logo_text.svg&w=640&q=75&x=1"),
      new URLSearchParams("url=/logo_text.svg&url=/fulfilled.png&w=640&q=75"),
    ]) {
      expect(
        isAllowedTenantImageOptimizerRequest({
          searchParams: query,
          environment: PRODUCTION_ENVIRONMENT,
        }),
      ).toBe(false)
    }
  })
})

test.describe("tenant canonical origin and exposure boundary", () => {
  test("accepts only a configured primary or local development origin", () => {
    expect(resolveCanonicalPrimaryOrigin(PRODUCTION_ENVIRONMENT)).toBe(
      "https://creatorshare.com",
    )
    expect(
      resolveCanonicalPrimaryOrigin({
        ...PRODUCTION_ENVIRONMENT,
        NEXT_PUBLIC_BASE_URL: "https://www.creatorshare.com",
      }),
    ).toBe("https://www.creatorshare.com")
    expect(
      resolveCanonicalPrimaryOrigin({
        ...PRODUCTION_ENVIRONMENT,
        NODE_ENV: "development",
        NEXT_PUBLIC_BASE_URL: "http://localhost:3000",
      }),
    ).toBe("http://localhost:3000")

    for (const value of [
      "http://creatorshare.com",
      "https://hope.creatorshare.com",
      "https://admin.creatorshare.com",
      "https://creatorshare.com/path",
      "https://creatorshare.com?query=1",
      "https://user:secret@creatorshare.com",
    ]) {
      expect(
        resolveCanonicalPrimaryOrigin({
          ...PRODUCTION_ENVIRONMENT,
          NEXT_PUBLIC_BASE_URL: value,
        }),
      ).toBeNull()
    }
  })

  test("qualifies browse pages while excluding payment and account surfaces", () => {
    for (const pathname of [
      "/",
      "/dogs",
      "/about",
      "/faq",
      "/sponsorships/child_42.png",
    ]) {
      expect(isQualifyingAdvocateExposurePagePath(pathname)).toBe(true)
    }

    for (const pathname of [
      "/sponsorships",
      "/sponsorships/checkout",
      "/payments/success",
      "/payments/failed",
      "/auth/callback",
      "/api/beneficiaries/get",
      "/admin",
    ]) {
      expect(isQualifyingAdvocateExposurePagePath(pathname)).toBe(false)
    }
  })
})
