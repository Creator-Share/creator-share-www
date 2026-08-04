import { createServer } from "node:http"
import type { AddressInfo } from "node:net"

import { chromium, expect, test } from "@playwright/test"

const COOKIE_NAME = "cs_sponsorship_visitor_v1"
const PARENT_DOMAIN = ".creatorshare.test"

test("preserves the shared visitor cookie while deleting a host scoped duplicate", async () => {
  const server = createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html; charset=utf-8")
    response.setHeader("Set-Cookie", [
      `${COOKIE_NAME}=replacement; Path=/; Domain=${PARENT_DOMAIN}; HttpOnly; SameSite=Lax`,
      `${COOKIE_NAME}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; HttpOnly; SameSite=Lax`,
    ])
    response.end("<!doctype html><title>normalized</title>")
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })

  const port = (server.address() as AddressInfo).port
  const browser = await chromium.launch({
    args: [
      "--host-resolver-rules=MAP hope.creatorshare.test 127.0.0.1, MAP creatorshare.test 127.0.0.1",
    ],
  })

  try {
    for (const hostname of ["hope.creatorshare.test", "creatorshare.test"]) {
      const origin = `http://${hostname}:${port}`
      const context = await browser.newContext()
      await context.addCookies([
        {
          name: COOKIE_NAME,
          value: "parent",
          domain: PARENT_DOMAIN,
          path: "/",
          httpOnly: true,
          sameSite: "Lax",
        },
        {
          name: COOKIE_NAME,
          value: "host",
          url: origin,
          httpOnly: true,
          sameSite: "Lax",
        },
      ])
      expect(
        (await context.cookies(origin)).filter(
          (cookie) => cookie.name === COOKIE_NAME,
        ),
      ).toHaveLength(2)

      const page = await context.newPage()
      const response = await page.goto(`${origin}/normalize`)
      expect(response?.status()).toBe(200)

      const normalized = (await context.cookies(origin)).filter(
        (cookie) => cookie.name === COOKIE_NAME,
      )
      expect(normalized).toHaveLength(1)
      expect(normalized[0]).toMatchObject({
        value: "replacement",
        domain: PARENT_DOMAIN,
        path: "/",
      })
      await context.close()
    }
  } finally {
    await browser.close()
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
})
