import { expect, test } from "@playwright/test"

import {
  createSponsorshipVisitorToken,
  getSponsorshipVisitorCookieOptions,
  isValidSponsorshipVisitorToken,
  SPONSORSHIP_VISITOR_COOKIE_MAX_AGE_SECONDS,
} from "../../src/lib/sponsorships/visitorCookie"

test("creates independent 256 bit base64url visitor tokens", () => {
  const first = createSponsorshipVisitorToken()
  const second = createSponsorshipVisitorToken()

  expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(second).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(second).not.toBe(first)
})

test("accepts only the exact version one token encoding", () => {
  const token = createSponsorshipVisitorToken()

  expect(isValidSponsorshipVisitorToken(token)).toBe(true)
  expect(isValidSponsorshipVisitorToken(`${token}a`)).toBe(false)
  expect(isValidSponsorshipVisitorToken(token.slice(1))).toBe(false)
  expect(isValidSponsorshipVisitorToken("a".repeat(43))).toBe(true)
  expect(isValidSponsorshipVisitorToken("+".repeat(43))).toBe(false)
  expect(isValidSponsorshipVisitorToken(null)).toBe(false)
})

test("shares the cookie across the Creator Share domain family", () => {
  const root = getSponsorshipVisitorCookieOptions("creatorshare.com", true)
  const advocate = getSponsorshipVisitorCookieOptions(
    "hope.creatorshare.com",
    true,
  )
  const reserved = getSponsorshipVisitorCookieOptions(
    "www.creatorshare.com",
    true,
  )

  for (const options of [root, advocate, reserved]) {
    expect(options.domain).toBe(".creatorshare.com")
    expect(options.httpOnly).toBe(true)
    expect(options.sameSite).toBe("lax")
    expect(options.secure).toBe(true)
    expect(options.maxAge).toBe(
      SPONSORSHIP_VISITOR_COOKIE_MAX_AGE_SECONDS,
    )
  }
})

test("keeps preview and local cookies host only", () => {
  const preview = getSponsorshipVisitorCookieOptions(
    "creator-share-preview.vercel.app",
    true,
  )
  const local = getSponsorshipVisitorCookieOptions("hope.localhost:3000", false)

  expect(preview.domain).toBeUndefined()
  expect(preview.secure).toBe(true)
  expect(local.domain).toBeUndefined()
  expect(local.secure).toBe(false)
})

test("fails closed to a host only cookie for malformed host input", () => {
  const options = getSponsorshipVisitorCookieOptions(
    "hope.creatorshare.com.evil.example",
    true,
  )

  expect(options.domain).toBeUndefined()
  expect(options.secure).toBe(true)
})
