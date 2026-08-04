import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

type ServerModule = typeof import("../../src/utils/supabase/server")
type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown

const clientOptionsCalls: unknown[] = []
const serverClientOptionsCalls: unknown[] = []
const nodeModule = Module as unknown as { _load: NodeModuleLoader }
const originalModuleLoad = nodeModule._load
nodeModule._load = function mockedModuleLoad(
  this: unknown,
  request: string,
  parent: unknown,
  isMain: boolean,
) {
  if (request === "@supabase/ssr") {
    return {
      createServerClient(_url: string, _key: string, options: unknown) {
        serverClientOptionsCalls.push(options)
        return { options }
      },
    }
  }
  if (request === "@supabase/supabase-js") {
    return {
      createClient(_url: string, _key: string, options: unknown) {
        clientOptionsCalls.push(options)
        return { options }
      },
    }
  }
  if (request === "next/headers") {
    return { async cookies() {} }
  }
  return originalModuleLoad.call(this, request, parent, isMain)
}

const testRequire = createRequire(
  resolve(process.cwd(), "tests/advocates/service-role-client-timeout.spec.ts"),
)
const serverModulePath = resolve(process.cwd(), "src/utils/supabase/server.ts")
const previouslyCachedServerModule = testRequire.cache[serverModulePath]
delete testRequire.cache[serverModulePath]
const {
  createAbortingServiceRoleFetch,
  createClient,
  createServiceRoleClient,
} = testRequire(serverModulePath) as ServerModule
if (previouslyCachedServerModule) {
  testRequire.cache[serverModulePath] = previouslyCachedServerModule
} else {
  delete testRequire.cache[serverModulePath]
}
nodeModule._load = originalModuleLoad

test.beforeEach(() => {
  clientOptionsCalls.length = 0
  serverClientOptionsCalls.length = 0
})

test.describe("service role request timeout", () => {
  test("leaves ordinary service-role callers on the default fetch", () => {
    createServiceRoleClient()

    expect(clientOptionsCalls).toEqual([
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    ])
  })

  test("installs a real aborting fetch only for a bounded client", async () => {
    const receivedSignals: AbortSignal[] = []
    const pendingFetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal
      if (signal) receivedSignals.push(signal)
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        })
      })
    }) as typeof fetch
    const boundedFetch = createAbortingServiceRoleFetch(1_000, pendingFetch)
    const startedAt = Date.now()

    await expect(boundedFetch("https://example.invalid")).rejects.toMatchObject(
      {
        name: "TimeoutError",
      },
    )
    expect(receivedSignals).toHaveLength(1)
    expect(receivedSignals[0]).toBeInstanceOf(AbortSignal)
    expect(receivedSignals[0].aborted).toBe(true)
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(900)

    createServiceRoleClient({ requestTimeoutMilliseconds: 15_000 })
    const options = clientOptionsCalls[0] as {
      global?: { fetch?: unknown }
    }
    expect(options.global?.fetch).toEqual(expect.any(Function))
  })

  test("bounds authenticated server clients only when requested", async () => {
    await createClient()
    await createClient({ requestTimeoutMilliseconds: 8_000 })

    const ordinary = serverClientOptionsCalls[0] as {
      global?: { fetch?: unknown }
    }
    const bounded = serverClientOptionsCalls[1] as {
      global?: { fetch?: unknown }
    }
    expect(ordinary.global).toBeUndefined()
    expect(bounded.global?.fetch).toEqual(expect.any(Function))
  })

  test("rejects unsafe timeout bounds before creating a client", () => {
    for (const requestTimeoutMilliseconds of [999, 45_001, 1_500.5, NaN]) {
      expect(() =>
        createServiceRoleClient({ requestTimeoutMilliseconds }),
      ).toThrow(RangeError)
    }
    expect(clientOptionsCalls).toHaveLength(0)
  })

  test("rejects unsafe authenticated timeout bounds before creating a client", async () => {
    for (const requestTimeoutMilliseconds of [999, 45_001, 1_500.5, NaN]) {
      await expect(
        createClient({ requestTimeoutMilliseconds }),
      ).rejects.toThrow(RangeError)
    }
    expect(serverClientOptionsCalls).toHaveLength(0)
  })
})
