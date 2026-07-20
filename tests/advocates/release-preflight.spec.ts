import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

import {
  COOKIE_TRUST_POLICY_DIGEST_ENVIRONMENT_VARIABLE,
  CROSS_SUBDOMAIN_COOKIE_MODE_ENVIRONMENT_VARIABLE,
} from "../../src/lib/advocates/crossSubdomainAttributionGate"
import { COMMITTED_COOKIE_TRUST_POLICY_DIGEST } from "../../src/lib/advocates/cookieTrustInventory"

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
  resolve(process.cwd(), "tests/advocates/release-preflight.spec.ts"),
)
const preflight = testRequire(
  "../../src/lib/advocates/releasePreflight",
) as typeof import("../../src/lib/advocates/releasePreflight")
const preflightRoute = testRequire(
  "../../src/lib/advocates/releasePreflightRoute",
) as typeof import("../../src/lib/advocates/releasePreflightRoute")
nodeModule._load = originalModuleLoad

const CRON_SECRET = "cron_secret_" + "c".repeat(48)

function base64Secret(byte: number): string {
  return Buffer.alloc(32, byte).toString("base64")
}

function legacySupabaseKey(role: "anon" | "service_role"): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value), "utf8").toString("base64url")
  return [
    encode({ alg: "HS256", typ: "JWT" }),
    encode({ iss: "supabase", role, iat: 1, exp: 4_102_444_800 }),
    Buffer.alloc(32, role === "anon" ? 1 : 2).toString("base64url"),
  ].join(".")
}

function validEnvironment(): Record<string, string> {
  return {
    NODE_ENV: "production",
    VERCEL: "1",
    VERCEL_ENV: "production",
    ADVOCATE_PROVIDER_AUTOMATION_MODE: "active",
    VERCEL_DEPLOYMENT_ID: "dpl_releasepreflight123",
    VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
    NEXT_PUBLIC_SUPABASE_URL: "https://release-preflight.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_" + "a".repeat(48),
    NEXT_SERVICE_ROLE_KEY: "sb_secret_" + "s".repeat(48),
    NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET: "advocate-media",
    NEXT_PUBLIC_BASE_URL: "https://creatorshare.com",
    CRON_SECRET,
    EMAIL_HOST: "smtp.creatorshare.com",
    EMAIL_USER: "release@creatorshare.com",
    EMAIL_PASSWORD: "smtp_password_" + "m".repeat(48),
    EMAIL_PORT: "587",
    EMAIL_SECURE: "false",
    EMAIL_FROM: '"Creator Share" <noreply@creatorshare.com>',
    ADVOCATE_CLOUDFLARE_API_TOKEN: "cloudflare_token_" + "f".repeat(48),
    ADVOCATE_CLOUDFLARE_ZONE_ID: "0123456789abcdef0123456789abcdef",
    ADVOCATE_CLOUDFLARE_CNAME_TARGET: "d1d4fc829fe7bc7c.vercel-dns-017.com",
    ADVOCATE_VERCEL_API_TOKEN: "vercel_token_" + "v".repeat(48),
    ADVOCATE_VERCEL_PROJECT_ID: "prj_releasepreflight123",
    ADVOCATE_VERCEL_TEAM_ID: "team_releasepreflight123",
    STRIPE_DEFAULT_REGION: "us",
    STRIPE_SECRET_KEY_US: "sk_live_us_" + "u".repeat(40),
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_US: "pk_live_us_" + "p".repeat(40),
    STRIPE_WEBHOOK_SECRET_US: "whsec_us_" + "w".repeat(40),
    NEXT_PUBLIC_STRIPE_PORTAL_URL_US:
      "https://billing.stripe.com/p/login/releasepreflightus",
    STRIPE_BILLING_PORTAL_CONFIGURATION_ID_US: "bpc_usreleasepreflight123",
    ADVOCATE_STRIPE_CANARY_RECURRING_PRICE_ID_US: "price_usreleasepreflight123",
    STRIPE_SECRET_KEY_UK: "sk_live_uk_" + "k".repeat(40),
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_UK: "pk_live_uk_" + "q".repeat(40),
    STRIPE_WEBHOOK_SECRET_UK: "whsec_uk_" + "x".repeat(40),
    NEXT_PUBLIC_STRIPE_PORTAL_URL_UK:
      "https://billing.stripe.com/p/login/releasepreflightuk",
    STRIPE_BILLING_PORTAL_CONFIGURATION_ID_UK: "bpc_ukreleasepreflight123",
    ADVOCATE_STRIPE_CANARY_RECURRING_PRICE_ID_UK: "price_ukreleasepreflight123",
    NEXT_PUBLIC_PAYPAL_CLIENT_ID: "paypal_client_" + "i".repeat(40),
    PAYPAL_CLIENT_SECRET: "paypal_secret_" + "e".repeat(40),
    PAYPAL_WEBHOOK_ID: "paypal_webhook_release_preflight",
    PAYPAL_API_URL: "https://api-m.paypal.com",
    ADVOCATE_PAYPAL_CANARY_RECURRING_PLAN_ID: "P-" + "A".repeat(24),
    ADVOCATE_PUBLICATION_CANARY_SECRET_V1: base64Secret(1),
    SPONSORSHIP_CRYPTO_SECRET_V1: base64Secret(2),
    SPONSOR_PASSWORDLESS_RATE_LIMIT_SECRET_V1: base64Secret(3),
    ADVOCATE_INVITATION_AUTHENTICATION_RATE_LIMIT_SECRET_V1: base64Secret(4),
    SPONSORSHIP_VISITOR_COOKIE_SECRET_V1: base64Secret(5),
    ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_SECRET_V1: base64Secret(6),
  }
}

function request(
  options: {
    authorization?: string
    method?: string
  } = {},
): Request {
  return new Request(
    "https://creatorshare.com/api/internal/advocates/release-preflight",
    {
      method: options.method ?? "POST",
      headers:
        options.authorization === undefined
          ? undefined
          : { authorization: options.authorization },
    },
  )
}

test.describe("advocate release preflight", () => {
  test("reports only fixed configured states and never probes providers", () => {
    const environment = validEnvironment()
    const result = preflight.runAdvocateReleasePreflight(environment)

    expect(result).toEqual({
      schemaVersion: 1,
      configurationState: "unverified",
      providerReadiness: "not_probed",
      checks: preflight.ADVOCATE_RELEASE_PREFLIGHT_CHECK_NAMES.map((name) => ({
        name,
        state: [
          "cross_subdomain_cookie_trust",
          "cross_subdomain_cookie_trusted_collector",
          "cross_subdomain_cookie_fresh_provider_evidence",
        ].includes(name)
          ? "unverified"
          : "configured",
      })),
    })
    expect(Object.keys(result).sort()).toEqual([
      "checks",
      "configurationState",
      "providerReadiness",
      "schemaVersion",
    ])
    for (const check of result.checks) {
      expect(Object.keys(check).sort()).toEqual(["name", "state"])
      expect(["configured", "invalid", "unverified"]).toContain(check.state)
    }

    expect(result.checks).toEqual(
      expect.arrayContaining([
        {
          name: "cross_subdomain_cookie_trusted_collector",
          state: "unverified",
        },
        {
          name: "cross_subdomain_cookie_fresh_provider_evidence",
          state: "unverified",
        },
      ]),
    )

    const serialized = JSON.stringify(result)
    for (const value of Object.values(environment).filter(
      (candidate) => candidate.length >= 20,
    )) {
      expect(serialized).not.toContain(value)
    }
  })

  test("distinguishes absent configuration from invalid configuration", () => {
    const absent = validEnvironment()
    delete absent.ADVOCATE_CLOUDFLARE_API_TOKEN
    expect(preflight.runAdvocateReleasePreflight(absent)).toMatchObject({
      configurationState: "unverified",
      providerReadiness: "not_probed",
      checks: expect.arrayContaining([
        { name: "cloudflare_configuration", state: "unverified" },
      ]),
    })

    const invalid = validEnvironment()
    invalid.ADVOCATE_CLOUDFLARE_ZONE_ID = "not-a-zone-id"
    expect(preflight.runAdvocateReleasePreflight(invalid)).toMatchObject({
      configurationState: "invalid",
      providerReadiness: "not_probed",
      checks: expect.arrayContaining([
        { name: "cloudflare_configuration", state: "invalid" },
      ]),
    })

    const missingGate = validEnvironment()
    delete missingGate.ADVOCATE_PROVIDER_AUTOMATION_MODE
    expect(preflight.runAdvocateReleasePreflight(missingGate)).toMatchObject({
      configurationState: "unverified",
      checks: expect.arrayContaining([
        { name: "provider_automation_gate", state: "unverified" },
      ]),
    })

    const malformedGate = validEnvironment()
    malformedGate.ADVOCATE_PROVIDER_AUTOMATION_MODE = "enabled"
    expect(preflight.runAdvocateReleasePreflight(malformedGate)).toMatchObject({
      configurationState: "invalid",
      checks: expect.arrayContaining([
        { name: "provider_automation_gate", state: "invalid" },
      ]),
    })

    const disabledGate = validEnvironment()
    disabledGate.ADVOCATE_PROVIDER_AUTOMATION_MODE = "disabled"
    expect(preflight.runAdvocateReleasePreflight(disabledGate)).toMatchObject({
      configurationState: "invalid",
      checks: expect.arrayContaining([
        { name: "provider_automation_gate", state: "invalid" },
      ]),
    })

    const missingCookieTrustDigest = validEnvironment()
    missingCookieTrustDigest[CROSS_SUBDOMAIN_COOKIE_MODE_ENVIRONMENT_VARIABLE] =
      "active"
    expect(
      preflight.runAdvocateReleasePreflight(missingCookieTrustDigest),
    ).toMatchObject({
      configurationState: "unverified",
      checks: expect.arrayContaining([
        { name: "cross_subdomain_cookie_trust", state: "unverified" },
      ]),
    })

    const malformedCookieTrustMode = validEnvironment()
    malformedCookieTrustMode[CROSS_SUBDOMAIN_COOKIE_MODE_ENVIRONMENT_VARIABLE] =
      "enabled"
    malformedCookieTrustMode[COOKIE_TRUST_POLICY_DIGEST_ENVIRONMENT_VARIABLE] =
      COMMITTED_COOKIE_TRUST_POLICY_DIGEST as string
    expect(
      preflight.runAdvocateReleasePreflight(malformedCookieTrustMode),
    ).toMatchObject({
      configurationState: "invalid",
      checks: expect.arrayContaining([
        { name: "cross_subdomain_cookie_trust", state: "invalid" },
      ]),
    })

    const staleCookieTrustDigest = validEnvironment()
    staleCookieTrustDigest[CROSS_SUBDOMAIN_COOKIE_MODE_ENVIRONMENT_VARIABLE] =
      "active"
    staleCookieTrustDigest[COOKIE_TRUST_POLICY_DIGEST_ENVIRONMENT_VARIABLE] =
      "f".repeat(64)
    expect(
      preflight.runAdvocateReleasePreflight(staleCookieTrustDigest),
    ).toMatchObject({
      configurationState: "invalid",
      checks: expect.arrayContaining([
        { name: "cross_subdomain_cookie_trust", state: "invalid" },
      ]),
    })

    const pendingCookieTrustInventory = validEnvironment()
    pendingCookieTrustInventory[
      CROSS_SUBDOMAIN_COOKIE_MODE_ENVIRONMENT_VARIABLE
    ] = "active"
    pendingCookieTrustInventory[
      COOKIE_TRUST_POLICY_DIGEST_ENVIRONMENT_VARIABLE
    ] = COMMITTED_COOKIE_TRUST_POLICY_DIGEST as string
    expect(
      preflight.runAdvocateReleasePreflight(pendingCookieTrustInventory),
    ).toMatchObject({
      configurationState: "invalid",
      checks: expect.arrayContaining([
        { name: "cross_subdomain_cookie_trust", state: "invalid" },
      ]),
    })

    const wrongCanonicalOrigin = validEnvironment()
    wrongCanonicalOrigin.NEXT_PUBLIC_BASE_URL = "https://www.creatorshare.com"
    expect(
      preflight.runAdvocateReleasePreflight(wrongCanonicalOrigin),
    ).toMatchObject({
      configurationState: "invalid",
      checks: expect.arrayContaining([
        { name: "email_configuration", state: "invalid" },
      ]),
    })

    const pathBearingCanonicalOrigin = validEnvironment()
    pathBearingCanonicalOrigin.NEXT_PUBLIC_BASE_URL =
      "https://creatorshare.com/unsafe?source=preflight#fragment"
    expect(
      preflight.runAdvocateReleasePreflight(pathBearingCanonicalOrigin),
    ).toMatchObject({
      configurationState: "invalid",
      checks: expect.arrayContaining([
        { name: "email_configuration", state: "invalid" },
      ]),
    })

    const trailingSlashCanonicalOrigin = validEnvironment()
    trailingSlashCanonicalOrigin.NEXT_PUBLIC_BASE_URL =
      "https://creatorshare.com/"
    expect(
      preflight.runAdvocateReleasePreflight(trailingSlashCanonicalOrigin),
    ).toMatchObject({
      configurationState: "invalid",
      checks: expect.arrayContaining([
        { name: "email_configuration", state: "invalid" },
      ]),
    })

    for (const unapprovedSender of [
      "attacker@example.com",
      '"Creator Share" <attacker@example.com>',
      "noreply@creatorshare.com",
      '"Different Brand" <noreply@creatorshare.com>',
    ]) {
      const environment = validEnvironment()
      environment.EMAIL_FROM = unapprovedSender
      expect(preflight.runAdvocateReleasePreflight(environment)).toMatchObject({
        configurationState: "invalid",
        checks: expect.arrayContaining([
          { name: "email_configuration", state: "invalid" },
        ]),
      })
    }

    const expandedSiteOrigin = validEnvironment()
    expandedSiteOrigin.NEXT_PUBLIC_SITE_URL = "https://preview.example.com"
    expect(
      preflight.runAdvocateReleasePreflight(expandedSiteOrigin),
    ).toMatchObject({
      configurationState: "invalid",
      checks: expect.arrayContaining([
        { name: "email_configuration", state: "invalid" },
      ]),
    })

    const unsafePortalUrl = validEnvironment()
    unsafePortalUrl.NEXT_PUBLIC_STRIPE_PORTAL_URL_US =
      'https://billing.stripe.com/p/login/safe" onmouseover="unsafe'
    expect(
      preflight.runAdvocateReleasePreflight(unsafePortalUrl),
    ).toMatchObject({
      configurationState: "invalid",
      checks: expect.arrayContaining([
        { name: "stripe_us_configuration", state: "invalid" },
      ]),
    })

    const unapprovedPortalHost = validEnvironment()
    unapprovedPortalHost.NEXT_PUBLIC_STRIPE_PORTAL_URL_UK =
      "https://billing.example.com/p/login/releasepreflightuk"
    expect(
      preflight.runAdvocateReleasePreflight(unapprovedPortalHost),
    ).toMatchObject({
      configurationState: "invalid",
      checks: expect.arrayContaining([
        { name: "stripe_uk_configuration", state: "invalid" },
      ]),
    })

    const malformedPreviousStripeSecret = validEnvironment()
    malformedPreviousStripeSecret.STRIPE_WEBHOOK_SECRET_US_PREVIOUS =
      "not_a_stripe_webhook_secret_123456789"
    expect(
      preflight.runAdvocateReleasePreflight(malformedPreviousStripeSecret),
    ).toMatchObject({
      configurationState: "invalid",
      checks: expect.arrayContaining([
        { name: "stripe_us_configuration", state: "invalid" },
      ]),
    })

    for (const invalidDefaultRegion of [
      undefined,
      "uk",
      "US",
      " us",
    ] as const) {
      const invalidStripeDefault = validEnvironment()
      if (invalidDefaultRegion === undefined) {
        delete invalidStripeDefault.STRIPE_DEFAULT_REGION
      } else {
        invalidStripeDefault.STRIPE_DEFAULT_REGION = invalidDefaultRegion
      }
      const result = preflight.runAdvocateReleasePreflight(invalidStripeDefault)
      expect(result.configurationState).toBe(
        invalidDefaultRegion === undefined ? "unverified" : "invalid",
      )
      expect(result.checks).toContainEqual({
        name: "stripe_us_configuration",
        state: invalidDefaultRegion === undefined ? "unverified" : "invalid",
      })
    }

    const legacySupabaseKeys = validEnvironment()
    legacySupabaseKeys.NEXT_PUBLIC_SUPABASE_ANON_KEY = legacySupabaseKey("anon")
    legacySupabaseKeys.NEXT_SERVICE_ROLE_KEY = legacySupabaseKey("service_role")
    expect(
      preflight.runAdvocateReleasePreflight(legacySupabaseKeys),
    ).toMatchObject({
      configurationState: "unverified",
      checks: expect.arrayContaining([
        { name: "supabase_configuration", state: "configured" },
      ]),
    })

    const swappedSupabaseRoles = validEnvironment()
    swappedSupabaseRoles.NEXT_PUBLIC_SUPABASE_ANON_KEY =
      legacySupabaseKey("service_role")
    swappedSupabaseRoles.NEXT_SERVICE_ROLE_KEY = legacySupabaseKey("anon")
    expect(
      preflight.runAdvocateReleasePreflight(swappedSupabaseRoles),
    ).toMatchObject({
      configurationState: "invalid",
      checks: expect.arrayContaining([
        { name: "supabase_configuration", state: "invalid" },
      ]),
    })

    const malformedLegacySupabaseKey = validEnvironment()
    malformedLegacySupabaseKey.NEXT_PUBLIC_SUPABASE_ANON_KEY = `${Buffer.from("header").toString("base64url")}.not-json.${Buffer.alloc(32).toString("base64url")}`
    expect(
      preflight.runAdvocateReleasePreflight(malformedLegacySupabaseKey),
    ).toMatchObject({
      configurationState: "invalid",
      checks: expect.arrayContaining([
        { name: "supabase_configuration", state: "invalid" },
      ]),
    })
  })

  test("rejects server, browser credential, and cross-boundary collisions without identifying the pair", () => {
    for (const collide of [
      (environment: Record<string, string>) => {
        environment.SPONSORSHIP_VISITOR_COOKIE_SECRET_V1 =
          environment.SPONSORSHIP_CRYPTO_SECRET_V1
      },
      (environment: Record<string, string>) => {
        environment.NEXT_PUBLIC_SUPABASE_ANON_KEY =
          environment.NEXT_SERVICE_ROLE_KEY
      },
      (environment: Record<string, string>) => {
        environment.CRON_SECRET =
          environment.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_US
      },
      (environment: Record<string, string>) => {
        environment.NEXT_PUBLIC_MAPBOX_TOKEN = environment.CRON_SECRET
      },
      (environment: Record<string, string>) => {
        environment.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_UK =
          environment.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_US
      },
      (environment: Record<string, string>) => {
        environment.TELEGRAM_BOT_TOKEN = environment.CRON_SECRET
      },
      (environment: Record<string, string>) => {
        environment.LLM_API_KEY = environment.EMAIL_PASSWORD
      },
    ]) {
      const environment = validEnvironment()
      collide(environment)
      const result = preflight.runAdvocateReleasePreflight(environment)

      expect(result.configurationState).toBe("invalid")
      expect(result.checks).toContainEqual({
        name: "secret_separation",
        state: "invalid",
      })
      for (const value of Object.values(environment).filter(
        (candidate) => candidate.length >= 20,
      )) {
        expect(JSON.stringify(result)).not.toContain(value)
      }
    }

    const publicOnlyReuse = validEnvironment()
    publicOnlyReuse.NEXT_PUBLIC_OPTIONAL_A = "browser-visible-value"
    publicOnlyReuse.NEXT_PUBLIC_OPTIONAL_B = "browser-visible-value"
    expect(
      preflight.runAdvocateReleasePreflight(publicOnlyReuse),
    ).toMatchObject({
      configurationState: "unverified",
      checks: expect.arrayContaining([
        { name: "secret_separation", state: "configured" },
      ]),
    })
  })

  test("rejects worker-specific secrets in the Vercel Cron topology", () => {
    const overrideNames = [
      "PAYMENT_GATEWAY_EVENT_WORKER_SECRET",
      "SPONSOR_WELCOME_EMAIL_WORKER_SECRET",
      "SUBSCRIPTION_CANCELLATION_WORKER_SECRET",
      "ADVOCATE_INVITATION_EMAIL_WORKER_SECRET",
      "ADVOCATE_LOGO_RECONCILIATION_WORKER_SECRET",
      "ADVOCATE_PUBLIC_METRIC_RELEASE_WORKER_SECRET",
      "ARCHIVED_ADVOCATE_DOMAIN_CLEANUP_WORKER_SECRET",
      "DATA_RETENTION_WORKER_SECRET",
      "ADVOCATE_PROVISIONING_WORKER_SECRET",
    ] as const

    for (const [index, name] of overrideNames.entries()) {
      const environment = validEnvironment()
      environment[name] = `dedicated_${index}_${"d".repeat(48)}`
      const result = preflight.runAdvocateReleasePreflight(environment)
      expect(result.checks).toContainEqual({
        name: "worker_configuration",
        state: "invalid",
      })
    }
  })

  test("authenticates one exact POST and returns the fixed preflight body", async () => {
    const environment = validEnvironment()
    const unauthorized = preflightRoute.handleAdvocateReleasePreflightRequest(
      request(),
      { environment },
    )
    expect(unauthorized.status).toBe(401)
    expect(await unauthorized.json()).toEqual({ code: "unauthorized" })

    const authorized = preflightRoute.handleAdvocateReleasePreflightRequest(
      request({ authorization: `Bearer ${CRON_SECRET}` }),
      { environment },
    )
    expect(authorized.status).toBe(200)
    expect(authorized.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    )
    expect(await authorized.json()).toEqual(
      preflight.runAdvocateReleasePreflight(environment),
    )

    const wrongMethod = preflightRoute.handleAdvocateReleasePreflightRequest(
      request({ authorization: `Bearer ${CRON_SECRET}`, method: "GET" }),
      { environment },
    )
    expect(wrongMethod.status).toBe(405)
    expect(wrongMethod.headers.get("allow")).toBe("POST")
    expect(await wrongMethod.json()).toEqual({ code: "method_not_allowed" })
  })

  test("fails closed when the cron credential is unavailable", async () => {
    const response = preflightRoute.handleAdvocateReleasePreflightRequest(
      request({ authorization: `Bearer ${CRON_SECRET}` }),
      { environment: {} },
    )
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ code: "preflight_unavailable" })
  })

  test("contains no provider, database, fetch, or scheduling execution path", () => {
    const preflightSource = readFileSync(
      resolve(process.cwd(), "src/lib/advocates/releasePreflight.ts"),
      "utf8",
    )
    const routeSource = readFileSync(
      resolve(process.cwd(), "src/lib/advocates/releasePreflightRoute.ts"),
      "utf8",
    )
    const appRouteSource = readFileSync(
      resolve(
        process.cwd(),
        "src/app/api/internal/advocates/release-preflight/route.ts",
      ),
      "utf8",
    )
    const vercel = JSON.parse(
      readFileSync(resolve(process.cwd(), "vercel.json"), "utf8"),
    ) as { crons?: Array<{ path?: string }> }
    const executionSource = `${preflightSource}\n${routeSource}\n${appRouteSource}`

    for (const forbidden of [
      "fetch(",
      ".rpc(",
      "createClient(",
      "createServiceRoleClient",
      "createDomainProviderAdapterFactory",
      "publicationCanary/runtime",
      "provisioning/adapters",
      "provisioning/paymentCanaries",
      "runStripePublicationPaymentCanary",
      "runPayPalPublicationPaymentCanary",
      "@/utils/supabase",
    ]) {
      expect(executionSource).not.toContain(forbidden)
    }
    expect(appRouteSource).toContain("export function POST")
    expect(appRouteSource).not.toContain("export function GET")
    expect(
      (vercel.crons ?? []).some(
        (entry) => entry.path === "/api/internal/advocates/release-preflight",
      ),
    ).toBe(false)
  })

  test("keeps the optional Telegram credential environment-only", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/config/telegram.ts"),
      "utf8",
    )
    expect(source).toContain('import "server-only"')
    expect(source).toContain('botToken: process.env.TELEGRAM_BOT_TOKEN ?? ""')
    expect(source).not.toMatch(/\b\d{6,}:[A-Za-z0-9_-]{20,}\b/)
  })
})
