import { expect, test } from "@playwright/test"

import { validatePassword } from "@/utils/passwordValidation"

/**
 * The platform-wide password rules.
 *
 * A mutation sweep found this module had no test at all, so lowering the
 * minimum length from eight characters to four passed the entire suite.
 * `validatePassword` is the single gate in front of the registration route,
 * the password change route, and the reset page, so every rule it drops is
 * dropped everywhere at once.
 *
 * Each rule is asserted from both sides: a password that fails only that rule
 * is rejected, and the same password with only that rule satisfied is
 * accepted. That prevents the suite from being satisfied by a validator that
 * rejects everything.
 */

/** Satisfies every rule, and is the base each case degrades in one way. */
const COMPLIANT = "Sponsor1!"

test.describe("password validation", () => {
  test("requires a password at all", async () => {
    expect(validatePassword("")).toMatchObject({ isValid: false })
  })

  test("holds the eight character floor exactly", async () => {
    // Seven compliant characters differ from eight only in length, so this
    // pins the boundary rather than the other rules.
    expect(validatePassword("Spons1!")).toMatchObject({
      isValid: false,
      error: "Password must be at least 8 characters long",
    })
    expect(validatePassword("Spons1!a")).toMatchObject({ isValid: true })
  })

  test("requires an uppercase letter", async () => {
    expect(validatePassword("sponsor1!")).toMatchObject({
      isValid: false,
      error: "Password must contain at least one uppercase letter",
    })
    expect(validatePassword(COMPLIANT)).toMatchObject({ isValid: true })
  })

  test("requires a lowercase letter", async () => {
    expect(validatePassword("SPONSOR1!")).toMatchObject({
      isValid: false,
      error: "Password must contain at least one lowercase letter",
    })
  })

  test("requires a digit", async () => {
    expect(validatePassword("Sponsors!")).toMatchObject({
      isValid: false,
      error: "Password must contain at least one number",
    })
  })

  test("requires a special character", async () => {
    expect(validatePassword("Sponsor12")).toMatchObject({ isValid: false })
    expect(validatePassword("Sponsor12!")).toMatchObject({ isValid: true })
  })

  test("accepts a long passphrase that satisfies every rule", async () => {
    // Guards against a length ceiling being introduced by accident.
    expect(
      validatePassword("Correct1! horse battery staple correct horse battery"),
    ).toMatchObject({ isValid: true, error: "" })
  })
})
