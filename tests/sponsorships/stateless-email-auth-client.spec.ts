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

const clientCalls: Array<{
  url: string
  key: string
  options: Record<string, unknown>
}> = []
const statelessClient = { kind: "stateless-email-auth-client" }

const nodeModule = Module as unknown as { _load: NodeModuleLoader }
const originalModuleLoad = nodeModule._load
nodeModule._load = function mockedModuleLoad(
  this: unknown,
  request: string,
  parent: unknown,
  isMain: boolean,
) {
  if (request === "server-only") return {}
  if (request === "@supabase/supabase-js") {
    return {
      createClient(url: string, key: string, options: Record<string, unknown>) {
        clientCalls.push({ url, key, options })
        return statelessClient
      },
    }
  }
  return originalModuleLoad.call(this, request, parent, isMain)
}

const testRequire = createRequire(
  resolve(
    process.cwd(),
    "tests/sponsorships/stateless-email-auth-client.spec.ts",
  ),
)
const statelessAuth = testRequire(
  "../../src/lib/sponsorships/management/statelessAuth",
) as StatelessAuthModule
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
