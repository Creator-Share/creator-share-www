import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown
type StatelessAuthModule =
  typeof import("../../src/lib/sponsorships/management/statelessAuth")
type ServerModule = typeof import("../../src/utils/supabase/server")

const clientCalls: Array<{
  url: string
  key: string
  options: Record<string, unknown>
}> = []
const statelessClient = { kind: "stateless-email-auth-client" }
let createAbortingServiceRoleFetch:
  ServerModule["createAbortingServiceRoleFetch"] | undefined

const nodeModule = Module as unknown as { _load: NodeModuleLoader }
const originalModuleLoad = nodeModule._load
nodeModule._load = function mockedModuleLoad(
  this: unknown,
  request: string,
  parent: unknown,
  isMain: boolean,
) {
  if (request === "server-only") return {}
  if (request === "@supabase/ssr") {
    return { createServerClient() {} }
  }
  if (request === "next/headers") {
    return { async cookies() {} }
  }
  if (request === "@supabase/supabase-js") {
    return {
      createClient(url: string, key: string, options: Record<string, unknown>) {
        clientCalls.push({ url, key, options })
        return statelessClient
      },
    }
  }
  if (request === "@/utils/supabase/server") {
    if (!createAbortingServiceRoleFetch) {
      throw new Error("aborting_fetch_test_dependency_unavailable")
    }
    return { createAbortingServiceRoleFetch }
  }
  return originalModuleLoad.call(this, request, parent, isMain)
}

const testRequire = createRequire(
  resolve(
    process.cwd(),
    "tests/sponsorships/stateless-email-auth-client.spec.ts",
  ),
)
const serverModulePath = resolve(process.cwd(), "src/utils/supabase/server.ts")
const previouslyCachedServerModule = testRequire.cache[serverModulePath]
delete testRequire.cache[serverModulePath]
createAbortingServiceRoleFetch = (testRequire(serverModulePath) as ServerModule)
  .createAbortingServiceRoleFetch
if (previouslyCachedServerModule) {
  testRequire.cache[serverModulePath] = previouslyCachedServerModule
} else {
  delete testRequire.cache[serverModulePath]
}
// The module under test must be built while the loader stub above is
// installed. A Playwright worker runs many spec files in one process, so
// another spec may already have loaded this module, or @supabase/supabase-js,
// against the real client. Requiring a cached module never re-enters the stub,
// so the assertions would silently observe a real SupabaseClient. Evicting
// both entries first makes this spec independent of file execution order.
const statelessAuthModulePath = testRequire.resolve(
  "../../src/lib/sponsorships/management/statelessAuth",
)
const supabaseModulePath = testRequire.resolve("@supabase/supabase-js")
const previouslyCachedModules = new Map(
  [statelessAuthModulePath, supabaseModulePath].map((path) => [
    path,
    testRequire.cache[path],
  ]),
)
for (const path of previouslyCachedModules.keys()) {
  delete testRequire.cache[path]
}
const statelessAuth = testRequire(
  statelessAuthModulePath,
) as StatelessAuthModule
for (const [path, cached] of previouslyCachedModules) {
  if (cached) testRequire.cache[path] = cached
  else delete testRequire.cache[path]
}
nodeModule._load = originalModuleLoad

const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const previousAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

test.beforeEach(() => {
  clientCalls.length = 0
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co"
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key"
})

test.afterAll(() => {
  restoreEnvironment("NEXT_PUBLIC_SUPABASE_URL", previousUrl)
  restoreEnvironment("NEXT_PUBLIC_SUPABASE_ANON_KEY", previousAnonKey)
})

test("creates an implicit auth sender without persistence or browser detection", () => {
  const client = statelessAuth.createStatelessSponsorEmailAuthClient()

  expect(client).toBe(statelessClient)
  expect(clientCalls).toEqual([
    {
      url: "https://example.supabase.co",
      key: "anon-key",
      options: {
        auth: {
          autoRefreshToken: false,
          detectSessionInUrl: false,
          flowType: "implicit",
          persistSession: false,
        },
      },
    },
  ])
  expect(JSON.stringify(clientCalls)).not.toContain("pkce")
  expect(JSON.stringify(clientCalls)).not.toContain("storage")
})

test("installs a genuinely aborting fetch only when a timeout is requested", async () => {
  const receivedSignals: AbortSignal[] = []
  const previousFetch = globalThis.fetch
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
    const signal = init?.signal
    if (signal) receivedSignals.push(signal)
    return new Promise<Response>((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      })
    })
  }) as typeof fetch

  try {
    const client = statelessAuth.createStatelessSponsorEmailAuthClient({
      requestTimeoutMilliseconds: 1_000,
    })
    expect(client).toBe(statelessClient)
    const configuredFetch = (
      clientCalls[0].options as {
        global?: { fetch?: typeof fetch }
      }
    ).global?.fetch
    expect(configuredFetch).toEqual(expect.any(Function))
    const startedAt = Date.now()
    await expect(
      configuredFetch?.("https://example.invalid"),
    ).rejects.toMatchObject({ name: "TimeoutError" })
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(900)
    expect(receivedSignals).toHaveLength(1)
    expect(receivedSignals[0].aborted).toBe(true)
  } finally {
    globalThis.fetch = previousFetch
  }
})

test("rejects unsafe timeout bounds before creating a client", () => {
  for (const requestTimeoutMilliseconds of [999, 45_001, 1_500.5, NaN]) {
    expect(() =>
      statelessAuth.createStatelessSponsorEmailAuthClient({
        requestTimeoutMilliseconds,
      }),
    ).toThrow(RangeError)
  }
  expect(clientCalls).toHaveLength(0)
})

test("fails closed when either public Supabase setting is unavailable", () => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL
  expect(() => statelessAuth.createStatelessSponsorEmailAuthClient()).toThrow(
    "sponsor_email_auth_unavailable",
  )
  expect(clientCalls).toHaveLength(0)

  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co"
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  expect(() => statelessAuth.createStatelessSponsorEmailAuthClient()).toThrow(
    "sponsor_email_auth_unavailable",
  )
  expect(clientCalls).toHaveLength(0)
})
