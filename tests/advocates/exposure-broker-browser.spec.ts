import { once } from "node:events"
import { createServer } from "node:http"

import { expect, test } from "@playwright/test"

const brokerPath = "/api/advocates/exposure"
const versionHeader = "x-creator-share-exposure-version"

test("a browser performs the exact credentialed broker preflight", async ({
  page,
}) => {
  const observed: Array<{
    method: string
    headers: Record<string, string>
    postData: string | null
  }> = []

  const server = createServer((request, response) => {
    if (request.url === "/broker-test-document") {
      response.writeHead(200, { "content-type": "text/html" })
      response.end("<!doctype html><title>Broker protocol test</title>")
      return
    }
    if (request.url !== brokerPath) {
      response.writeHead(404)
      response.end()
      return
    }

    const chunks: Buffer[] = []
    request.on("data", (chunk: Buffer) => chunks.push(chunk))
    request.on("end", () => {
      observed.push({
        method: request.method ?? "",
        headers: Object.fromEntries(
          Object.entries(request.headers).flatMap(([name, value]) =>
            typeof value === "string" ? [[name, value]] : [],
          ),
        ),
        postData:
          chunks.length === 0 ? null : Buffer.concat(chunks).toString("utf8"),
      })
      const origin = request.headers.origin
      response.writeHead(204, {
        "access-control-allow-credentials": "true",
        "access-control-allow-headers": `content-type, ${versionHeader}`,
        "access-control-allow-methods": "POST",
        "access-control-allow-origin": origin ?? "",
        "cache-control": "private, no-store, max-age=0",
        vary: "Origin",
      })
      response.end()
    })
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (address === null || typeof address === "string") {
    server.close()
    throw new Error("Browser protocol test server did not bind")
  }
  const tenantOrigin = `http://broker-e2e.localhost:${address.port}`
  const apexOrigin = `http://localhost:${address.port}`

  let status: number
  try {
    await page.goto(`${tenantOrigin}/broker-test-document`)
    status = await page.evaluate(
      async ({ endpoint, versionHeaderName }) => {
        const response = await fetch(endpoint, {
          body: JSON.stringify({ pagePath: "/sponsorships/amina" }),
          cache: "no-store",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            [versionHeaderName]: "1",
          },
          keepalive: true,
          method: "POST",
          mode: "cors",
          redirect: "error",
          referrerPolicy: "no-referrer",
          signal: AbortSignal.timeout(8_000),
        })
        return response.status
      },
      {
        endpoint: `${apexOrigin}${brokerPath}`,
        versionHeaderName: versionHeader,
      },
    )
  } finally {
    server.close()
    await once(server, "close")
  }

  expect(status).toBe(204)
  expect(observed.map(({ method }) => method)).toEqual(["OPTIONS", "POST"])
  expect(observed[0].headers).toMatchObject({
    "access-control-request-headers": `content-type,${versionHeader}`,
    "access-control-request-method": "POST",
    origin: tenantOrigin,
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "cross-site",
  })
  expect(observed[1].headers).toMatchObject({
    "content-type": "application/json",
    origin: tenantOrigin,
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "cross-site",
    [versionHeader]: "1",
  })
  expect(observed[1].postData).toBe(
    JSON.stringify({ pagePath: "/sponsorships/amina" }),
  )
})
