import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"

import { expect, test } from "@playwright/test"

import {
  ADVOCATE_STAGING_SUPABASE_ORIGIN,
  ADVOCATE_STAGING_SUPABASE_PROJECT_REF,
  assertAdvocateStagingExternalProviderBoundary,
  assertAdvocateStagingSupabaseBoundary,
} from "../../src/lib/advocates/stagingDeploymentBoundary"
import { getLLMConfig, isLLMConfigured } from "../../src/utils/ai/config"

function legacySupabaseKey(
  role: "anon" | "service_role",
  ref: string = ADVOCATE_STAGING_SUPABASE_PROJECT_REF,
): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value), "utf8").toString("base64url")
  return [
    encode({ alg: "HS256", typ: "JWT" }),
    encode({ iss: "supabase", ref, role, iat: 1, exp: 4_102_444_800 }),
    Buffer.alloc(32, role === "anon" ? 1 : 2).toString("base64url"),
  ].join(".")
}

function stagingEnvironment(): Record<string, string> {
  return {
    NEXT_PUBLIC_BASE_URL: "https://advocate-staging.creatorshare.com",
    NEXT_PUBLIC_SUPABASE_URL: ADVOCATE_STAGING_SUPABASE_ORIGIN,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: legacySupabaseKey("anon"),
    NEXT_SERVICE_ROLE_KEY: legacySupabaseKey("service_role"),
  }
}

function sourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((entry) => {
    const path = join(root, entry)
    return statSync(path).isDirectory()
      ? sourceFiles(path)
      : /\.(?:ts|tsx)$/.test(entry)
        ? [path]
        : []
  })
}

function directlyConstructsSupabaseClient(source: string): boolean {
  const importsSupabaseJavaScriptClient =
    /import\s*\{[^}]*\bcreateClient(?:\s+as\s+\w+)?[^}]*\}\s*from\s*["']@supabase\/supabase-js["']/s.test(
      source,
    )
  return (
    source.includes("createServerClient(") ||
    source.includes("createBrowserClient(") ||
    source.includes("createRouteHandlerClient(") ||
    source.includes("createSupabaseClient(") ||
    (importsSupabaseJavaScriptClient && source.includes("createClient("))
  )
}

test.describe("advocate staging deployment boundary", () => {
  test("is inert outside the exact advocate staging deployment", () => {
    expect(() =>
      assertAdvocateStagingSupabaseBoundary({
        NEXT_PUBLIC_BASE_URL: "https://creatorshare.com",
      }),
    ).not.toThrow()
  })

  test("accepts only the designated staging project and matching legacy roles", () => {
    expect(() =>
      assertAdvocateStagingSupabaseBoundary(stagingEnvironment()),
    ).not.toThrow()
  })

  test("rejects a missing, malformed, or different Supabase project origin", () => {
    for (const value of [
      undefined,
      "",
      `${ADVOCATE_STAGING_SUPABASE_ORIGIN}/`,
      "https://production.supabase.co",
    ]) {
      const environment: Record<string, string | undefined> =
        stagingEnvironment()
      environment.NEXT_PUBLIC_SUPABASE_URL = value
      expect(() => assertAdvocateStagingSupabaseBoundary(environment)).toThrow(
        "advocate_staging_supabase_configuration_invalid",
      )
    }
  })

  test("rejects swapped roles, another project ref, and missing credentials", () => {
    const mutations: Array<
      (environment: Record<string, string | undefined>) => void
    > = [
      (environment) => {
        environment.NEXT_PUBLIC_SUPABASE_ANON_KEY =
          legacySupabaseKey("service_role")
      },
      (environment) => {
        environment.NEXT_SERVICE_ROLE_KEY = legacySupabaseKey("anon")
      },
      (environment) => {
        environment.NEXT_PUBLIC_SUPABASE_ANON_KEY = legacySupabaseKey(
          "anon",
          "anotherprojectref12",
        )
      },
      (environment) => {
        delete environment.NEXT_SERVICE_ROLE_KEY
      },
    ]

    for (const mutate of mutations) {
      const environment: Record<string, string | undefined> =
        stagingEnvironment()
      mutate(environment)
      expect(() => assertAdvocateStagingSupabaseBoundary(environment)).toThrow(
        "advocate_staging_supabase_configuration_invalid",
      )
    }
  })

  test("supports browser and edge call sites without exposing the service role", () => {
    const environment: Record<string, string | undefined> = stagingEnvironment()
    delete environment.NEXT_SERVICE_ROLE_KEY

    expect(() =>
      assertAdvocateStagingSupabaseBoundary(environment, {
        requireServiceRole: false,
      }),
    ).not.toThrow()
  })

  test("accepts current publishable and secret key families with the exact origin", () => {
    const environment = stagingEnvironment()
    environment.NEXT_PUBLIC_SUPABASE_ANON_KEY =
      "sb_publishable_" + "a".repeat(32)
    environment.NEXT_SERVICE_ROLE_KEY = "sb_secret_" + "s".repeat(32)

    expect(() =>
      assertAdvocateStagingSupabaseBoundary(environment),
    ).not.toThrow()
  })

  test("rejects copied LLM and Telegram provider credentials from exact staging", () => {
    expect(() =>
      assertAdvocateStagingExternalProviderBoundary(stagingEnvironment()),
    ).not.toThrow()

    for (const variable of [
      "LLM_API_KEY",
      "LLM_API_HOST",
      "NEXT_PUBLIC_MAPTILER_KEY",
      "TELEGRAM_BOT_TOKEN",
      "TELEGRAM_CHAT_ID",
      "TELEGRAM_MANAGER_CHAT_ID",
    ]) {
      expect(() =>
        assertAdvocateStagingExternalProviderBoundary({
          ...stagingEnvironment(),
          [variable]: "copied-production-value",
        }),
      ).toThrow("advocate_staging_external_provider_configuration_invalid")
    }

    expect(() =>
      assertAdvocateStagingExternalProviderBoundary({
        NEXT_PUBLIC_BASE_URL: "https://creatorshare.com",
        LLM_API_KEY: "production-key",
        LLM_API_HOST: "https://llm.example.test",
        TELEGRAM_BOT_TOKEN: "production-token",
      }),
    ).not.toThrow()
  })

  test("keeps runtime LLM and Telegram calls behind the staging boundary", () => {
    const stagingWithCopiedLlm = {
      ...stagingEnvironment(),
      LLM_API_KEY: "copied-production-key",
      LLM_API_HOST: "https://llm.example.test",
    }
    expect(isLLMConfigured(stagingWithCopiedLlm)).toBe(false)
    expect(() => getLLMConfig(stagingWithCopiedLlm)).toThrow(
      "LLM API is not configured",
    )
    expect(
      isLLMConfigured({
        NEXT_PUBLIC_BASE_URL: "https://creatorshare.com",
        LLM_API_KEY: "production-key",
        LLM_API_HOST: "https://llm.example.test",
      }),
    ).toBe(true)

    const proofreadRoute = readFileSync(
      resolve(process.cwd(), "src/app/api/ai/proofread/route.ts"),
      "utf8",
    )
    const proofreadProviderCall = proofreadRoute.indexOf("proofreadText(")
    expect(proofreadRoute.indexOf("if (!isLLMConfigured())")).toBeLessThan(
      proofreadProviderCall,
    )
    expect(proofreadRoute.indexOf("requireSuperAdmin(")).toBeLessThan(
      proofreadProviderCall,
    )

    const telegramService = readFileSync(
      resolve(process.cwd(), "src/services/telegram.ts"),
      "utf8",
    )
    const telegramFactory = telegramService.indexOf(
      "export function createTelegramService",
    )
    const stagingGuard = telegramService.indexOf(
      "isAdvocateStagingEnvironmentEnabled(process.env)",
      telegramFactory,
    )
    const providerCredential = telegramService.indexOf(
      "process.env.TELEGRAM_BOT_TOKEN",
      telegramFactory,
    )
    expect(stagingGuard).toBeGreaterThan(telegramFactory)
    expect(stagingGuard).toBeLessThan(providerCredential)

    const rootLayout = readFileSync(
      resolve(process.cwd(), "src/app/layout.tsx"),
      "utf8",
    )
    expect(rootLayout).toContain(
      "!isAdvocateStagingEnvironmentEnabled(process.env)",
    )
    expect(rootLayout).toContain(
      'site.kind === "primary" && ENABLE_VERCEL_ANALYTICS',
    )
  })

  test("keeps legacy outbound email navigation on the configured origin", () => {
    const legacyEmail = readFileSync(
      resolve(process.cwd(), "src/utils/email.ts"),
      "utf8",
    )
    const budgetFulfilledEmail = legacyEmail.slice(
      legacyEmail.indexOf("export const sendBudgetFulfilledRejectionEmail"),
      legacyEmail.indexOf("/**\n * Send monthly payment confirmation email"),
    )

    expect(budgetFulfilledEmail).toContain("getSponsorClaimCanonicalOrigin()")
    expect(budgetFulfilledEmail).toContain('href="${browseUrl}"')
    expect(budgetFulfilledEmail).not.toContain(
      'href="https://creatorshare.com"',
    )
  })

  test("keeps every direct Supabase client constructor behind the staging boundary", () => {
    const root = resolve(process.cwd(), "src")
    const directConstructorFiles = sourceFiles(root)
      .filter((path) =>
        directlyConstructsSupabaseClient(readFileSync(path, "utf8")),
      )
      .map((path) => relative(root, path))
      .sort()

    expect(directConstructorFiles).toEqual(
      [
        "app/api/auth/change-password/route.ts",
        "app/api/auth/verify-otp/route.ts",
        "app/auth/callback/route.ts",
        "app/auth/confirm/route.ts",
        "lib/advocates/invitations/routeClient.ts",
        "lib/advocates/logoReconciliation/serviceClient.ts",
        "lib/sponsorships/management/statelessAuth.ts",
        "utils/supabase/client.ts",
        "utils/supabase/middleware.ts",
        "utils/supabase/server.ts",
      ].sort(),
    )
    for (const path of directConstructorFiles) {
      expect(readFileSync(join(root, path), "utf8")).toContain(
        "assertAdvocateStagingSupabaseBoundary(",
      )
    }
  })
})
