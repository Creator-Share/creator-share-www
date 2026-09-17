import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

import {
  getPayPalApiUrl,
  paypalFetch,
  PAYPAL_LIVE_API_URL,
  PAYPAL_SANDBOX_API_URL,
} from "../../src/lib/paypal/client"

test.describe.configure({ mode: "serial" })

test("PayPal API configuration accepts only the exact trusted origins", () => {
  const original = process.env.PAYPAL_API_URL
  const originalBaseUrl = process.env.NEXT_PUBLIC_BASE_URL
  try {
    process.env.NEXT_PUBLIC_BASE_URL = "https://creatorshare.com"
    delete process.env.PAYPAL_API_URL
    expect(getPayPalApiUrl()).toBe(PAYPAL_LIVE_API_URL)

    for (const url of [PAYPAL_LIVE_API_URL, PAYPAL_SANDBOX_API_URL]) {
      process.env.PAYPAL_API_URL = url
      expect(getPayPalApiUrl()).toBe(url)
    }

    for (const url of [
      `${PAYPAL_LIVE_API_URL}/`,
      `${PAYPAL_LIVE_API_URL}/v1/oauth2/token`,
      `${PAYPAL_SANDBOX_API_URL}?redirect=example.test`,
      "https://example.test",
      "http://api-m.paypal.com",
    ]) {
      process.env.PAYPAL_API_URL = url
      expect(() => getPayPalApiUrl()).toThrow("PayPal API URL is invalid")
    }
  } finally {
    if (original === undefined) delete process.env.PAYPAL_API_URL
    else process.env.PAYPAL_API_URL = original
    if (originalBaseUrl === undefined) delete process.env.NEXT_PUBLIC_BASE_URL
    else process.env.NEXT_PUBLIC_BASE_URL = originalBaseUrl
  }
})

test("the shared PayPal client has no legacy raw provider lookup or cancellation path", async () => {
  const source = await readFile(
    resolve(process.cwd(), "src/lib/paypal/client.ts"),
    "utf8",
  )

  expect(source).not.toContain("getPayPalOrder")
  expect(source).not.toContain("PayPalOrderResponse")
  expect(source).not.toContain("cancelPayPalSubscription")
  expect(source).not.toContain("errorText")
  expect(source).not.toContain("response.text()")
})


test("PayPal OAuth and provider requests share cancellation and reject redirects", async () => {
  const keys = ["NEXT_PUBLIC_BASE_URL", "PAYPAL_API_URL", "PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "NEXT_PUBLIC_PAYPAL_CLIENT_ID"]
  const saved = keys.map((key) => process.env[key])
  const originalFetch = globalThis.fetch
  const requests: RequestInit[] = []
  try {
    process.env.NEXT_PUBLIC_BASE_URL = "https://creatorshare.com"
    process.env.PAYPAL_API_URL = PAYPAL_LIVE_API_URL
    process.env.PAYPAL_CLIENT_ID = "fixture-client"
    process.env.PAYPAL_CLIENT_SECRET = "fixture-secret"
    delete process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID
    globalThis.fetch = async (_url, init) => {
      requests.push(init!)
      return requests.length === 1
        ? Response.json({ access_token: "fixture-token" })
        : Response.json({ id: "fixture-id" })
    }
    const controller = new AbortController()
    await paypalFetch("/v1/fixture", { signal: controller.signal })
    expect(requests).toHaveLength(2)
    for (const request of requests) {
      expect(request.redirect).toBe("error")
      expect(request.cache).toBe("no-store")
    }
    expect(requests[0].signal).toBe(requests[1].signal)
    controller.abort()
    expect(requests[1].signal?.aborted).toBe(true)
    expect(new Headers(requests[1].headers).get("Authorization")).toBe("Bearer fixture-token")
    for (const token of [null, 7, true, "", "has space", "x".repeat(4097)]) {
      let attempts = 0
      globalThis.fetch = async () => {
        attempts += 1
        return Response.json({ access_token: token })
      }
      await expect(paypalFetch("/v1/fixture")).rejects.toThrow("Invalid PayPal token response")
      expect(attempts).toBe(1)
    }

  } finally {
    globalThis.fetch = originalFetch
    keys.forEach((key, index) => {
      if (saved[index] === undefined) delete process.env[key]
      else process.env[key] = saved[index]
    })
  }
})
