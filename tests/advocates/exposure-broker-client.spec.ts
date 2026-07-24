import { expect, test } from "@playwright/test"

import {
  recordAdvocateExposureThroughBroker,
  resolveAdvocateExposureBrokerUrl,
} from "@/lib/advocates/exposureBrokerClient"
import {
  ADVOCATE_EXPOSURE_BROKER_PATH,
  ADVOCATE_EXPOSURE_BROKER_VERSION,
  ADVOCATE_EXPOSURE_BROKER_VERSION_HEADER,
} from "@/lib/advocates/exposureBrokerProtocol"

test("uses one fixed production broker and derives only a safe local port", () => {
  expect(
    resolveAdvocateExposureBrokerUrl("hope.creatorshare.com", "production"),
  ).toBe(`https://creatorshare.com${ADVOCATE_EXPOSURE_BROKER_PATH}`)
  expect(
    resolveAdvocateExposureBrokerUrl("hope.localhost:4317", "development"),
  ).toBe(`http://localhost:4317${ADVOCATE_EXPOSURE_BROKER_PATH}`)
  expect(
    resolveAdvocateExposureBrokerUrl(
      "canary.advocate-staging.creatorshare.com",
      "production",
      true,
    ),
  ).toBe(
    `https://advocate-staging.creatorshare.com${ADVOCATE_EXPOSURE_BROKER_PATH}`,
  )
  expect(
    resolveAdvocateExposureBrokerUrl(
      "canary.advocate-staging.creatorshare.com",
      "production",
    ),
  ).toBeNull()
  expect(
    resolveAdvocateExposureBrokerUrl(
      "hope.advocate-staging.creatorshare.com",
      "production",
      true,
    ),
  ).toBeNull()

  for (const [host, environment] of [
    ["creatorshare.com", "production"],
    ["admin.creatorshare.com", "production"],
    ["nested.hope.creatorshare.com", "production"],
    ["hope.localhost:4317", "production"],
    ["hope.creatorshare.com", "development"],
    ["hope.localhost:70000", "development"],
    ["hope.localhost.evil.test:4317", "development"],
  ] as const) {
    expect(resolveAdvocateExposureBrokerUrl(host, environment), host).toBeNull()
  }
})

test("sends one bounded credentialed request with the exact protocol", async () => {
  const calls: Array<{ input: string | URL | Request; init?: RequestInit }> = []
  const accepted = await recordAdvocateExposureThroughBroker(
    {
      pageHost: "hope.creatorshare.com",
      pagePath: "/sponsorships/amina",
    },
    {
      nodeEnvironment: "production",
      retryDelaysMilliseconds: [0],
      fetchImplementation: async (input, init) => {
        calls.push({ input, init })
        return new Response(null, { status: 204 })
      },
      wait: async () => undefined,
    },
  )

  expect(accepted).toBe(true)
  expect(calls).toHaveLength(1)
  expect(calls[0].input).toBe(
    `https://creatorshare.com${ADVOCATE_EXPOSURE_BROKER_PATH}`,
  )
  expect(calls[0].init).toMatchObject({
    body: JSON.stringify({ pagePath: "/sponsorships/amina" }),
    cache: "no-store",
    credentials: "include",
    keepalive: true,
    method: "POST",
    mode: "cors",
    redirect: "error",
    referrerPolicy: "no-referrer",
  })
  expect(new Headers(calls[0].init?.headers)).toEqual(
    new Headers({
      "content-type": "application/json",
      [ADVOCATE_EXPOSURE_BROKER_VERSION_HEADER]:
        ADVOCATE_EXPOSURE_BROKER_VERSION,
    }),
  )
})

test("sends staging exposure only to the exact configured staging broker", async () => {
  const calls: Array<string | URL | Request> = []
  await expect(
    recordAdvocateExposureThroughBroker(
      {
        pageHost: "canary.advocate-staging.creatorshare.com",
        pagePath: "/",
      },
      {
        allowStagingEnvironment: true,
        nodeEnvironment: "production",
        retryDelaysMilliseconds: [0],
        fetchImplementation: async (input) => {
          calls.push(input)
          return new Response(null, { status: 204 })
        },
        wait: async () => undefined,
      },
    ),
  ).resolves.toBe(true)
  expect(calls).toEqual([
    `https://advocate-staging.creatorshare.com${ADVOCATE_EXPOSURE_BROKER_PATH}`,
  ])
})

test("retries only bounded transient outcomes and succeeds only on 204", async () => {
  const outcomes: Array<Response | Error> = [
    new Response(null, { status: 503 }),
    new TypeError("network failure"),
    new Response(null, { status: 204 }),
  ]
  const waits: number[] = []
  let calls = 0

  const accepted = await recordAdvocateExposureThroughBroker(
    { pageHost: "hope.creatorshare.com", pagePath: "/" },
    {
      nodeEnvironment: "production",
      retryDelaysMilliseconds: [0, 17, 43],
      fetchImplementation: async () => {
        const outcome = outcomes[calls]
        calls += 1
        if (outcome instanceof Error) throw outcome
        return outcome
      },
      wait: async (milliseconds) => {
        waits.push(milliseconds)
      },
    },
  )

  expect(accepted).toBe(true)
  expect(calls).toBe(3)
  expect(waits).toEqual([17, 43])

  for (const status of [200, 201, 400, 401, 403, 404, 409, 422]) {
    calls = 0
    const rejected = await recordAdvocateExposureThroughBroker(
      { pageHost: "hope.creatorshare.com", pagePath: "/" },
      {
        nodeEnvironment: "production",
        retryDelaysMilliseconds: [0, 1, 2],
        fetchImplementation: async () => {
          calls += 1
          return new Response(null, { status })
        },
        wait: async () => undefined,
      },
    )
    expect(rejected, String(status)).toBe(false)
    expect(calls, String(status)).toBe(1)
  }
})

test("does not mark a path complete after exhausting network failures", async () => {
  let calls = 0
  const accepted = await recordAdvocateExposureThroughBroker(
    { pageHost: "hope.creatorshare.com", pagePath: "/about" },
    {
      nodeEnvironment: "production",
      retryDelaysMilliseconds: [0, 1, 2],
      fetchImplementation: async () => {
        calls += 1
        throw new TypeError("blocked")
      },
      wait: async () => undefined,
    },
  )

  expect(accepted).toBe(false)
  expect(calls).toBe(3)
})

test("never sends a nonqualifying path or accepts an unsafe retry policy", async () => {
  let calls = 0
  const fetchImplementation = async () => {
    calls += 1
    return new Response(null, { status: 204 })
  }

  for (const pagePath of [
    "/payments/success",
    "/api/stripe",
    "/?source=forged",
    `/${"a".repeat(501)}`,
  ]) {
    await expect(
      recordAdvocateExposureThroughBroker(
        { pageHost: "hope.creatorshare.com", pagePath },
        {
          nodeEnvironment: "production",
          fetchImplementation,
          retryDelaysMilliseconds: [0],
          wait: async () => undefined,
        },
      ),
    ).resolves.toBe(false)
  }
  await expect(
    recordAdvocateExposureThroughBroker(
      { pageHost: "hope.creatorshare.com", pagePath: "/" },
      {
        nodeEnvironment: "production",
        fetchImplementation,
        retryDelaysMilliseconds: [0, 20_000],
        wait: async () => undefined,
      },
    ),
  ).resolves.toBe(false)
  expect(calls).toBe(0)
})
