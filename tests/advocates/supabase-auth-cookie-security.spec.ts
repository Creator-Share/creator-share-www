import { expect, test } from "@playwright/test"

import {
  secureSupabaseAuthCookieOptions,
  supabaseAuthCookiesMustBeSecure,
} from "../../src/utils/supabase/authCookieSecurity"

test.describe("Supabase authentication cookie transport security", () => {
  test("forces Secure for production and every trusted HTTPS origin", () => {
    expect(
      supabaseAuthCookiesMustBeSecure({
        environment: {
          NODE_ENV: "production",
          NEXT_PUBLIC_BASE_URL: "http://localhost:3000",
        },
      }),
    ).toBe(true)
    expect(
      supabaseAuthCookiesMustBeSecure({
        environment: { NODE_ENV: "test" },
        trustedUrl: "https://advocate-staging.creatorshare.com/auth/callback",
      }),
    ).toBe(true)
    expect(
      secureSupabaseAuthCookieOptions(
        { httpOnly: true, sameSite: "lax", secure: false },
        {
          environment: { NODE_ENV: "test" },
          trustedUrl: "https://creatorshare.com",
        },
      ),
    ).toEqual({ httpOnly: true, sameSite: "lax", secure: true })
  })

  test("permits nonsecure cookies only for explicit loopback development", () => {
    for (const trustedUrl of [
      "http://localhost:3000",
      "http://hope.localhost:3000",
      "http://127.0.0.1:3000",
      "http://[::1]:3000",
    ]) {
      expect(
        supabaseAuthCookiesMustBeSecure({
          environment: { NODE_ENV: "development" },
          trustedUrl,
        }),
      ).toBe(false)
    }

    expect(
      supabaseAuthCookiesMustBeSecure({
        environment: { NODE_ENV: "development" },
        trustedUrl: "http://staging.example.com",
      }),
    ).toBe(true)
    expect(
      secureSupabaseAuthCookieOptions(
        { httpOnly: true },
        {
          environment: { NODE_ENV: "development" },
          trustedUrl: "http://localhost:3000",
        },
      ),
    ).toEqual({ httpOnly: true })
  })

  test("supports an already validated route transport decision", () => {
    expect(
      secureSupabaseAuthCookieOptions(
        { path: "/", secure: false },
        {
          environment: { NODE_ENV: "test" },
          forceSecure: true,
        },
      ),
    ).toEqual({ path: "/", secure: true })
  })
})
