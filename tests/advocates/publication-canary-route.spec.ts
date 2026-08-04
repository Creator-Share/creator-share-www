import { createHmac } from "node:crypto"
import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"
import type { SupabaseClient } from "@supabase/supabase-js"

type ChallengeModule =
  typeof import("../../src/lib/advocates/publicationCanary/challenge")
type RepositoryModule =
  typeof import("../../src/lib/advocates/publicationCanary/repository")
type PublicationCanaryTargetIdentity =
  import("../../src/lib/advocates/publicationCanary/repository").PublicationCanaryTargetIdentity
type PublicationCanaryRequestDependencies =
  import("../../src/lib/advocates/publicationCanary/challenge").PublicationCanaryRequestDependencies
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
  resolve(process.cwd(), "tests/advocates/publication-canary-route.spec.ts"),
)
const challenge = testRequire(
  "../../src/lib/advocates/publicationCanary/challenge",
) as ChallengeModule
const repositoryModule = testRequire(
  "../../src/lib/advocates/publicationCanary/repository",
) as RepositoryModule
nodeModule._load = originalModuleLoad

const NOW = Date.parse("2026-07-18T12:00:00.000Z")
const SECRET = Buffer.alloc(32, 23).toString("base64")
const DEPLOYMENT_ID = "dpl_exact_host_123"
const REVISION = "b".repeat(40)
const IDENTITY = Object.freeze({
  runId: "11111111-1111-4111-8111-111111111111",
  advocateId: "22222222-2222-4222-8222-222222222222",
  domainId: "33333333-3333-4333-8333-333333333333",
  hostname: "hope.creatorshare.com",
  advocateVersion: 17,
  deploymentId: DEPLOYMENT_ID,
  revision: REVISION,
})
const TARGET = Object.freeze({
  advocateId: IDENTITY.advocateId,
  domainId: IDENTITY.domainId,
  hostname: IDENTITY.hostname,
  advocateVersion: IDENTITY.advocateVersion,
})
const ENVIRONMENT = Object.freeze({
  NODE_ENV: "production",
  ADVOCATE_PUBLICATION_CANARY_SECRET_V1: SECRET,
  VERCEL_DEPLOYMENT_ID: DEPLOYMENT_ID,
  VERCEL_GIT_COMMIT_SHA: REVISION,
})

function token(now = NOW) {
  return challenge.createPublicationCanaryToken(IDENTITY, {
    environment: ENVIRONMENT,
    now: () => now,
  })
}

function request(
  options: {
    authorization?: string
    host?: string
    method?: string
    search?: string
    forwardedHost?: string
  } = {},
) {
  const headers = new Headers({
    host: options.host ?? IDENTITY.hostname,
    ...(options.authorization === undefined
      ? { authorization: `Bearer ${token()}` }
      : options.authorization === ""
        ? {}
        : { authorization: options.authorization }),
  })
  if (options.forwardedHost !== undefined) {
    headers.set("x-forwarded-host", options.forwardedHost)
  }
  return new Request(
    `https://internal-runtime.example${challenge.ADVOCATE_PUBLICATION_CANARY_PATH}${options.search ?? ""}`,
    {
      method: options.method ?? "POST",
      headers,
    },
  )
}

function dependencies(
  options: {
    environment?: Record<string, string | undefined>
    loadTarget?: (
      identity: PublicationCanaryTargetIdentity,
    ) => Promise<PublicationCanaryTargetIdentity | null>
  } = {},
): PublicationCanaryRequestDependencies {
  return {
    environment: options.environment ?? ENVIRONMENT,
    now: () => NOW,
    loadTarget: options.loadTarget ?? (async () => TARGET),
  }
}

async function failureSnapshot(response: Response) {
  return {
    status: response.status,
    body: await response.text(),
    headers: [...response.headers.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  }
}

test.describe("protected exact-host publication challenge route", () => {
  test("returns only a MAC authenticated response for the literal exact host", async () => {
    const lookups: PublicationCanaryTargetIdentity[] = []
    const challengeToken = token()
    const response = await challenge.handlePublicationCanaryRequest(
      request({
        authorization: `Bearer ${challengeToken}`,
        forwardedHost: "attacker.example",
      }),
      dependencies({
        async loadTarget(identity) {
          lookups.push(identity)
          return TARGET
        },
      }),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    )
    expect(response.headers.get("pragma")).toBe("no-cache")
    expect(response.headers.get("vary")).toBe("Authorization, Host")
    expect(response.headers.get("referrer-policy")).toBe("no-referrer")
    expect(response.headers.get("content-security-policy")).toBe(
      "frame-ancestors 'none'",
    )
    expect(response.headers.get("x-frame-options")).toBe("DENY")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(response.headers.get("set-cookie")).toBeNull()
    expect(lookups).toEqual([TARGET])

    const rawBody = await response.text()
    const claims = challenge.verifyPublicationCanaryToken(challengeToken, {
      environment: ENVIRONMENT,
      now: () => NOW,
    })
    expect(claims).not.toBeNull()
    if (claims === null) throw new Error("Expected challenge claims")
    expect(
      challenge.verifyPublicationCanaryResponse(rawBody, claims, ENVIRONMENT),
    ).toMatchObject({
      purpose: "advocate-publication-canary-response",
      ...TARGET,
      runId: IDENTITY.runId,
      deploymentId: DEPLOYMENT_ID,
      revision: REVISION,
      verifiedAt: new Date(NOW).toISOString(),
    })

    const parsed = JSON.parse(rawBody) as Record<string, unknown>
    parsed.hostname = "other.creatorshare.com"
    expect(
      challenge.verifyPublicationCanaryResponse(
        JSON.stringify(parsed),
        claims,
        ENVIRONMENT,
      ),
    ).toBeNull()

    const secondClaims = challenge.verifyPublicationCanaryToken(token(), {
      environment: ENVIRONMENT,
      now: () => NOW,
    })
    expect(secondClaims).not.toBeNull()
    if (secondClaims === null) throw new Error("Expected second claims")
    expect(secondClaims.nonce).not.toBe(claims.nonce)
    expect(
      challenge.verifyPublicationCanaryResponse(
        rawBody,
        secondClaims,
        ENVIRONMENT,
      ),
    ).toBeNull()
  })

  test("rejects MAC valid response timestamps outside the challenge window and unknown key ids", async () => {
    const challengeToken = token()
    const response = await challenge.handlePublicationCanaryRequest(
      request({ authorization: `Bearer ${challengeToken}` }),
      dependencies(),
    )
    const claims = challenge.verifyPublicationCanaryToken(challengeToken, {
      environment: ENVIRONMENT,
      now: () => NOW,
    })
    expect(claims).not.toBeNull()
    if (claims === null) throw new Error("Expected challenge claims")

    const original = JSON.parse(await response.text()) as Record<
      string,
      unknown
    >
    for (const override of [
      {
        verifiedAt: new Date((claims.issuedAt - 31) * 1_000).toISOString(),
      },
      { verifiedAt: new Date(claims.expiresAt * 1_000).toISOString() },
      { keyId: "v2" },
    ]) {
      const unsigned: Record<string, unknown> = { ...original, ...override }
      delete unsigned.responseMac
      const responseMac = createHmac("sha256", Buffer.from(SECRET, "base64"))
        .update(
          Buffer.from(
            "creator-share/advocate-publication-canary/response/v1\0",
            "utf8",
          ),
        )
        .update(JSON.stringify(unsigned), "utf8")
        .digest("base64url")

      expect(
        challenge.verifyPublicationCanaryResponse(
          JSON.stringify({ ...unsigned, responseMac }),
          claims,
          ENVIRONMENT,
        ),
      ).toBeNull()
    }
  })

  test("collapses every authorization and immutable binding failure to one 404", async () => {
    let lookupCount = 0
    const baseDependencies = dependencies({
      async loadTarget() {
        lookupCount += 1
        return TARGET
      },
    })
    const validToken = token()
    const cases: Array<[Request, PublicationCanaryRequestDependencies]> = [
      [request({ authorization: "" }), baseDependencies],
      [request({ authorization: `Basic ${validToken}` }), baseDependencies],
      [
        request({
          authorization: `Bearer ${validToken.slice(0, -1)}${
            validToken.endsWith("A") ? "B" : "A"
          }`,
        }),
        baseDependencies,
      ],
      [request({ host: IDENTITY.hostname.toUpperCase() }), baseDependencies],
      [request({ host: `${IDENTITY.hostname}:443` }), baseDependencies],
      [request({ search: "?probe=1" }), baseDependencies],
      [request({ method: "GET" }), baseDependencies],
      [
        request(),
        dependencies({
          environment: {
            ...ENVIRONMENT,
            VERCEL_DEPLOYMENT_ID: "dpl_other",
          },
        }),
      ],
      [
        request(),
        dependencies({
          environment: {
            ...ENVIRONMENT,
            VERCEL_GIT_COMMIT_SHA: "c".repeat(40),
          },
        }),
      ],
      [
        request({
          authorization: `Bearer ${token(
            NOW -
              (challenge.ADVOCATE_PUBLICATION_CANARY_MAX_TTL_SECONDS + 1) *
                1_000,
          )}`,
        }),
        baseDependencies,
      ],
    ]

    const snapshots = []
    for (const [candidate, candidateDependencies] of cases) {
      snapshots.push(
        await failureSnapshot(
          await challenge.handlePublicationCanaryRequest(
            candidate,
            candidateDependencies,
          ),
        ),
      )
    }

    for (const [index, snapshot] of snapshots.entries()) {
      expect(snapshot, `failure case ${index}`).toEqual(snapshots[0])
    }
    expect(snapshots[0]).toMatchObject({ status: 404, body: "Not Found" })
    expect(lookupCount).toBe(0)
  })

  test("collapses missing, changed, malformed, and failed repository state to the same 404", async () => {
    const outcomes = [
      async () => null,
      async () => ({ ...TARGET, advocateVersion: TARGET.advocateVersion + 1 }),
      async () => {
        throw new Error("database unavailable")
      },
    ]
    const snapshots = []
    for (const loadTarget of outcomes) {
      snapshots.push(
        await failureSnapshot(
          await challenge.handlePublicationCanaryRequest(
            request(),
            dependencies({ loadTarget }),
          ),
        ),
      )
    }

    expect(
      new Set(snapshots.map((snapshot) => JSON.stringify(snapshot))).size,
    ).toBe(1)
    expect(snapshots[0]).toMatchObject({ status: 404, body: "Not Found" })
  })
})

function mockClient(result: {
  data: unknown
  error: { code?: string } | null
}) {
  const calls: Array<{ operation: string; args: unknown[] }> = []
  const builder = {
    select(...args: unknown[]) {
      calls.push({ operation: "select", args })
      return builder
    },
    eq(...args: unknown[]) {
      calls.push({ operation: "eq", args })
      return builder
    },
    in(...args: unknown[]) {
      calls.push({ operation: "in", args })
      return builder
    },
    async maybeSingle() {
      calls.push({ operation: "maybeSingle", args: [] })
      return result
    },
  }
  const client = {
    from(...args: unknown[]) {
      calls.push({ operation: "from", args })
      return builder
    },
  } as unknown as SupabaseClient
  return { client, calls }
}

function targetRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TARGET.domainId,
    advocate_id: TARGET.advocateId,
    hostname: TARGET.hostname,
    is_primary: true,
    status: "verifying",
    advocate: {
      id: TARGET.advocateId,
      version: TARGET.advocateVersion,
      relationship_status: "active",
      publication_status: "provisioning",
    },
    ...overrides,
  }
}

test.describe("publication challenge verifying-domain repository", () => {
  test("uses one service-side joined lookup for the exact eligible primary target", async () => {
    const { client, calls } = mockClient({
      data: targetRow(),
      error: null,
    })
    const repository =
      repositoryModule.createServiceRolePublicationCanaryRepository(client)

    await expect(repository.loadVerifyingTarget(TARGET)).resolves.toEqual(
      TARGET,
    )
    expect(calls).toEqual([
      { operation: "from", args: ["advocate_domains"] },
      {
        operation: "select",
        args: [
          "id, advocate_id, hostname, is_primary, status, advocate:advocates!inner(id, version, relationship_status, publication_status)",
        ],
      },
      { operation: "eq", args: ["id", TARGET.domainId] },
      { operation: "eq", args: ["advocate_id", TARGET.advocateId] },
      { operation: "eq", args: ["hostname", TARGET.hostname] },
      { operation: "eq", args: ["is_primary", true] },
      { operation: "eq", args: ["status", "verifying"] },
      { operation: "eq", args: ["advocate.id", TARGET.advocateId] },
      {
        operation: "eq",
        args: ["advocate.version", TARGET.advocateVersion],
      },
      { operation: "eq", args: ["advocate.relationship_status", "active"] },
      {
        operation: "in",
        args: [
          "advocate.publication_status",
          ["draft", "provisioning", "failed", "active"],
        ],
      },
      { operation: "maybeSingle", args: [] },
    ])
  })

  test("preserves no match and rejects operational or malformed results", async () => {
    const noMatch = mockClient({ data: null, error: null })
    await expect(
      repositoryModule
        .createServiceRolePublicationCanaryRepository(noMatch.client)
        .loadVerifyingTarget(TARGET),
    ).resolves.toBeNull()

    const cause = { code: "PGRST999" }
    const failed = mockClient({ data: null, error: cause })
    await expect(
      repositoryModule
        .createServiceRolePublicationCanaryRepository(failed.client)
        .loadVerifyingTarget(TARGET),
    ).rejects.toMatchObject({
      name: "PublicationCanaryRepositoryError",
      stage: "target",
      cause,
    })

    const malformed = mockClient({
      data: targetRow({ status: "active" }),
      error: null,
    })
    await expect(
      repositoryModule
        .createServiceRolePublicationCanaryRepository(malformed.client)
        .loadVerifyingTarget(TARGET),
    ).rejects.toMatchObject({
      name: "PublicationCanaryRepositoryError",
      stage: "target_shape",
    })
  })
})
