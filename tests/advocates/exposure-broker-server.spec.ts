import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"
import { NextRequest } from "next/server"

type ServerModule =
  typeof import("../../src/lib/advocates/exposureBrokerServer")
type ProtocolModule =
  typeof import("../../src/lib/advocates/exposureBrokerProtocol")
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
  resolve(process.cwd(), "tests/advocates/exposure-broker-server.spec.ts"),
)
const server = testRequire(
  resolve(process.cwd(), "src/lib/advocates/exposureBrokerServer.ts"),
) as ServerModule
const protocol = testRequire(
  resolve(process.cwd(), "src/lib/advocates/exposureBrokerProtocol.ts"),
) as ProtocolModule
nodeModule._load = originalModuleLoad

function request(
  method: string,
  headers: Record<string, string>,
  body?: string,
) {
  return new NextRequest(
    `http://${headers.host}${protocol.ADVOCATE_EXPOSURE_BROKER_PATH}`,
    {
      method,
      headers,
      ...(body === undefined ? {} : { body }),
    },
  )
}

const COMMON_HEADERS = {
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-site",
  "user-agent": "Mozilla/5.0 Mobile Safari/605.1.15",
} as const

test("accepts a local broker only for a same-port one-label tenant in development", () => {
  const environment = { NODE_ENV: "development" }
  const valid = request("POST", {
    ...COMMON_HEADERS,
    host: "localhost:4317",
    origin: "http://hope.localhost:4317",
    "content-type": "application/json",
    "sec-fetch-site": "cross-site",
    [protocol.ADVOCATE_EXPOSURE_BROKER_VERSION_HEADER]: "1",
  })
  expect(
    server.resolveAdvocateExposureBrokerRequest(valid, environment),
  ).toEqual({
    advocateHostname: "hope.creatorshare.com",
    allowedOrigin: "http://hope.localhost:4317",
  })

  for (const origin of [
    "http://hope.localhost:4318",
    "https://hope.localhost:4317",
    "http://admin.localhost:4317",
    "http://nested.hope.localhost:4317",
    "http://hope.localhost:4317/",
  ]) {
    const candidate = request("POST", {
      ...COMMON_HEADERS,
      host: "localhost:4317",
      origin,
      "content-type": "application/json",
      "sec-fetch-site": "cross-site",
      [protocol.ADVOCATE_EXPOSURE_BROKER_VERSION_HEADER]: "1",
    })
    expect(
      server.resolveAdvocateExposureBrokerRequest(candidate, environment),
      origin,
    ).toBeNull()
  }
})

test("requires exact request methods and protocol headers", () => {
  const environment = { NODE_ENV: "production" }
  const base = {
    ...COMMON_HEADERS,
    host: "creatorshare.com",
    origin: "https://hope.creatorshare.com",
    "content-type": "application/json",
    [protocol.ADVOCATE_EXPOSURE_BROKER_VERSION_HEADER]: "1",
  }

  expect(
    server.resolveAdvocateExposureBrokerRequest(
      request("POST", base),
      environment,
    ),
  ).toMatchObject({ advocateHostname: "hope.creatorshare.com" })
  for (const method of ["GET", "HEAD", "PUT", "PATCH", "DELETE"]) {
    expect(
      server.resolveAdvocateExposureBrokerRequest(
        request(method, base),
        environment,
      ),
      method,
    ).toBeNull()
  }
})

test("parses only one bounded qualifying pagePath property", async () => {
  const headers = {
    ...COMMON_HEADERS,
    host: "creatorshare.com",
    origin: "https://hope.creatorshare.com",
    "content-type": "application/json",
    [protocol.ADVOCATE_EXPOSURE_BROKER_VERSION_HEADER]: "1",
  }
  await expect(
    server.readAdvocateExposureBrokerBody(
      request("POST", headers, JSON.stringify({ pagePath: "/dogs" })),
    ),
  ).resolves.toEqual({ pagePath: "/dogs" })
  await expect(
    server.readAdvocateExposureBrokerBody(
      request(
        "POST",
        headers,
        JSON.stringify({ pagePath: "/dogs", authUserId: "forged" }),
      ),
    ),
  ).resolves.toBeNull()
})

test("accepts only an exact active presentation snapshot", () => {
  expect(
    server.isExactActiveAdvocatePresentationSnapshot(
      {
        domain: {
          hostname: "hope.creatorshare.com",
          status: "active",
        },
      },
      "hope.creatorshare.com",
    ),
  ).toBe(true)
  for (const value of [
    null,
    {},
    { domain: null },
    { domain: { hostname: "other.creatorshare.com", status: "active" } },
    { domain: { hostname: "hope.creatorshare.com", status: "pending" } },
  ]) {
    expect(
      server.isExactActiveAdvocatePresentationSnapshot(
        value,
        "hope.creatorshare.com",
      ),
    ).toBe(false)
  }
})
