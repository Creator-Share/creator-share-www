import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

/**
 * Regression lock for the phone authentication release gate.
 *
 * The gate requires the Twilio phone provider, phone MFA enrollment, and phone
 * MFA verification to be disabled before invitation delivery is enabled. All
 * three are currently disabled in supabase/config.toml, but nothing asserted
 * it, so a single edit could re-enable a phone path silently.
 *
 * This matters more than an ordinary configuration check. Supabase Auth
 * v2.188.1 uses the same `otp` authentication method reference for implicit
 * email verification and for phone verification. Advocate invitation
 * redemption treats a fresh `otp` reference as evidence of email control, so
 * enabling any phone path would let a phone-verified session satisfy a check
 * that is meant to prove control of the invited email address.
 *
 * This locks the local configuration only. Hosted Supabase state cannot be
 * proven from the repository and remains a manual release gate, recorded in
 * docs/advocate-staging-manual-audit.md.
 */

const CONFIG_PATH = resolve(process.cwd(), "supabase/config.toml")

function section(source: string, heading: string): string {
  const start = source.indexOf(`[${heading}]`)
  expect(start, `${heading} section is missing`).toBeGreaterThanOrEqual(0)
  const rest = source.slice(start + heading.length + 2)
  const nextHeading = rest.search(/^\[/m)
  return nextHeading === -1 ? rest : rest.slice(0, nextHeading)
}

function booleanSetting(body: string, key: string): string | null {
  const match = new RegExp(`^\\s*${key}\\s*=\\s*(\\S+)`, "m").exec(body)
  return match === null ? null : match[1]
}

test.describe("local phone authentication lock", () => {
  test("keeps the Twilio provider and both phone MFA operations disabled", async () => {
    const source = await readFile(CONFIG_PATH, "utf8")

    expect(
      booleanSetting(section(source, "auth.sms.twilio"), "enabled"),
      "auth.sms.twilio.enabled must stay false",
    ).toBe("false")

    const phoneMfa = section(source, "auth.mfa.phone")
    expect(
      booleanSetting(phoneMfa, "enroll_enabled"),
      "auth.mfa.phone.enroll_enabled must stay false",
    ).toBe("false")
    expect(
      booleanSetting(phoneMfa, "verify_enabled"),
      "auth.mfa.phone.verify_enabled must stay false",
    ).toBe("false")
  })

  test("keeps SMS signup and SMS confirmations disabled", async () => {
    const smsSection = section(await readFile(CONFIG_PATH, "utf8"), "auth.sms")

    expect(
      booleanSetting(smsSection, "enable_signup"),
      "auth.sms.enable_signup must stay false",
    ).toBe("false")
    expect(
      booleanSetting(smsSection, "enable_confirmations"),
      "auth.sms.enable_confirmations must stay false",
    ).toBe("false")
  })

  test("commits no Twilio auth token", async () => {
    const twilio = section(
      await readFile(CONFIG_PATH, "utf8"),
      "auth.sms.twilio",
    )
    const authToken = /^\s*auth_token\s*=\s*"(.*)"/m.exec(twilio)

    expect(authToken, "auth_token must remain declared").not.toBeNull()
    // Only environment substitution is acceptable. A literal value here would
    // be a committed provider credential.
    expect(authToken?.[1]).toMatch(/^env\([A-Z0-9_]+\)$/)
  })
})
