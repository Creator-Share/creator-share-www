import { expect, test } from "@playwright/test"
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server"

import { config } from "../../src/middleware"

function matches(pathname: string, host: string): boolean {
  return unstable_doesMiddlewareMatch({
    config,
    url: `https://${host}${pathname}`,
    headers: { host },
  })
}

test.describe("advocate middleware build matcher", () => {
  test("keeps dynamic and optimizer requests inside Host policy", () => {
    for (const host of [
      "creatorshare.com",
      "hope.creatorshare.com",
      "admin.creatorshare.com",
      "nested.hope.creatorshare.com",
      "unapproved.example",
    ]) {
      expect(matches("/", host)).toBe(true)
      expect(
        matches("/_next/image?url=%2Flogo_text.png&w=640&q=75", host),
      ).toBe(true)
    }
  })

  test("preserves primary asset exclusions while enforcing sibling Hosts", () => {
    for (const pathname of ["/favicon.ico", "/logo_text.png", "/brand.svg"]) {
      expect(matches(pathname, "creatorshare.com")).toBe(false)
      expect(matches(pathname, "unapproved.example")).toBe(false)
      expect(matches(pathname, "hope.creatorshare.com")).toBe(true)
      expect(matches(pathname, "admin.creatorshare.com")).toBe(true)
      expect(matches(pathname, "nested.hope.creatorshare.com")).toBe(true)
      expect(matches(pathname, "hope.localhost:3000")).toBe(true)
    }
  })

  test("never invokes middleware for immutable Next chunks", () => {
    for (const host of [
      "creatorshare.com",
      "hope.creatorshare.com",
      "unapproved.example",
    ]) {
      expect(matches("/_next/static/chunks/app.js", host)).toBe(false)
    }
  })
})
