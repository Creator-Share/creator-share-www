import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

type IssuerModule = typeof import("../../src/lib/auth/supabaseEmailProofIssuer")
type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown

type Event = {
  kind: string
  args?: unknown
}

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const INVITER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const OUTBOX_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
const REQUEST_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
const HASHED_TOKEN = "t".repeat(48)
const events: Event[] = []
const serviceClientOptions: unknown[] = []

let rpcHandler: (
  name: string,
  args: Record<string, unknown>,
) => unknown | Promise<unknown>
let otpHandler: (input: Record<string, unknown>) => unknown | Promise<unknown>
let signUpHandler: (
  input: Record<string, unknown>,
) => unknown | Promise<unknown>
let resetHandler: (email: string) => unknown | Promise<unknown>
let inviteHandler: (
  email: string,
  options: Record<string, unknown>,
) => unknown | Promise<unknown>
let generateHandler: (
  input: Record<string, unknown>,
) => unknown | Promise<unknown>
let statelessClientFactory: (options: unknown) => unknown
let serviceClientFactory: (options: unknown) => unknown

function successUser(email: string) {
  return { id: USER_ID, email }
}

function generatedLinkResponse(email: string, redirectTo: string) {
  return {
    data: {
      properties: {
        action_link: `https://project.supabase.co/auth/v1/verify?token=${HASHED_TOKEN}`,
        email_otp: "123456",
        hashed_token: HASHED_TOKEN,
        redirect_to: redirectTo,
        verification_type: "magiclink",
      },
      user: successUser(email),
    },
    error: null,
  }
}

function resetHarness(): void {
  events.length = 0
  serviceClientOptions.length = 0
  rpcHandler = (name) => ({
    data:
      name === "acquire_email_proof_issuance_gate"
        ? [{ acquisition_result: "acquired", retry_after_seconds: 0 }]
        : null,
    error: null,
  })
  otpHandler = () => ({
    data: { user: null, session: null },
    error: null,
  })
  signUpHandler = (input) => ({
    data: {
      user: successUser(input.email as string),
      session: null,
    },
    error: null,
  })
  resetHandler = () => ({ data: {}, error: null })
  inviteHandler = (email) => ({
    data: { user: successUser(email) },
    error: null,
  })
  generateHandler = (input) =>
    generatedLinkResponse(
      input.email as string,
      (input.options as { redirectTo: string }).redirectTo,
    )

  statelessClientFactory = (options) => {
    events.push({ kind: "stateless-client", args: options })
    return {
      auth: {
        async signInWithOtp(input: Record<string, unknown>) {
          events.push({ kind: "signInWithOtp", args: input })
          return otpHandler(input)
        },
        async signUp(input: Record<string, unknown>) {
          events.push({ kind: "signUp", args: input })
          return signUpHandler(input)
        },
        async resetPasswordForEmail(email: string) {
          events.push({ kind: "resetPasswordForEmail", args: email })
          return resetHandler(email)
        },
      },
    }
  }

  serviceClientFactory = (options) => {
    events.push({ kind: "service-client", args: options })
    serviceClientOptions.push(options)
    return {
      async rpc(name: string, args: Record<string, unknown>) {
        events.push({ kind: name, args })
        return rpcHandler(name, args)
      },
      auth: {
        admin: {
          async inviteUserByEmail(
            email: string,
            options: Record<string, unknown>,
          ) {
            events.push({
              kind: "inviteUserByEmail",
              args: { email, options },
            })
            return inviteHandler(email, options)
          },
          async generateLink(input: Record<string, unknown>) {
            events.push({ kind: "generateLink", args: input })
            return generateHandler(input)
          },
        },
      },
    }
  }
}

const nodeModule = Module as unknown as { _load: NodeModuleLoader }
const originalModuleLoad = nodeModule._load
nodeModule._load = function mockedModuleLoad(
  this: unknown,
  request: string,
  parent: unknown,
  isMain: boolean,
) {
  if (request === "server-only") return {}
  if (request === "@/utils/supabase/server") {
    return {
      createServiceRoleClient(options: unknown) {
        return serviceClientFactory(options)
      },
    }
  }
  if (request === "@/lib/sponsorships/management/statelessAuth") {
    return {
      createStatelessSponsorEmailAuthClient(options: unknown) {
        return statelessClientFactory(options)
      },
    }
  }
  return originalModuleLoad.call(this, request, parent, isMain)
}

const testRequire = createRequire(
  resolve(process.cwd(), "tests/auth/supabase-email-proof-issuer.spec.ts"),
)
const issuer = testRequire(
  "../../src/lib/auth/supabaseEmailProofIssuer",
) as IssuerModule
nodeModule._load = originalModuleLoad

const previousEnvironment = {
  NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_SERVICE_ROLE_KEY: process.env.NEXT_SERVICE_ROLE_KEY,
  SPONSORSHIP_CRYPTO_SECRET_V1: process.env.SPONSORSHIP_CRYPTO_SECRET_V1,
}

function restoreEnvironment(
  name: keyof typeof previousEnvironment,
  value: string | undefined,
): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

function validEnvironment(): void {
  process.env.NEXT_PUBLIC_BASE_URL = "https://creatorshare.com"
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co"
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = `anon_${"a".repeat(64)}`
  process.env.NEXT_SERVICE_ROLE_KEY = `service_${"s".repeat(64)}`
  process.env.SPONSORSHIP_CRYPTO_SECRET_V1 = Buffer.alloc(32, 31).toString(
    "base64",
  )
}

function context() {
  return { requestId: REQUEST_ID, traceId: "sfo1::email-proof" }
}

function managementOptions() {
  return {
    recipientEmail: " Sponsor+Family@Example.com ",
    redirectTo: "https://creatorshare.com/auth/confirm?next=%2Fapp",
    context: context(),
  }
}

function claimOptions() {
  return {
    recipientEmail: " Sponsor+Family@Example.com ",
    redirectTo: "https://creatorshare.com/auth/confirm?next=%2Fsponsor%2Fclaim",
    context: context(),
  }
}

function rpcEvents(name: string): Event[] {
  return events.filter((event) => event.kind === name)
}

test.beforeEach(() => {
  validEnvironment()
  resetHarness()
})

test.afterAll(() => {
  for (const [name, value] of Object.entries(previousEnvironment)) {
    restoreEnvironment(name as keyof typeof previousEnvironment, value)
  }
})

test("orders acquire, local provider construction, begin, one issuance, and finish", async () => {
  await expect(
    issuer.issueGenericSignInEmailProof(managementOptions()),
  ).resolves.toEqual({ status: "issued" })

  expect(events.map((event) => event.kind)).toEqual([
    "service-client",
    "acquire_email_proof_issuance_gate",
    "stateless-client",
    "begin_email_proof_issuance",
    "signInWithOtp",
    "finish_email_proof_issuance",
  ])
  expect(serviceClientOptions).toEqual([{ requestTimeoutMilliseconds: 8_000 }])
  expect(
    events.find((event) => event.kind === "stateless-client")?.args,
  ).toEqual({ requestTimeoutMilliseconds: 8_000 })

  const acquire = rpcEvents("acquire_email_proof_issuance_gate")[0]
    .args as Record<string, unknown>
  const begin = rpcEvents("begin_email_proof_issuance")[0].args as Record<
    string,
    unknown
  >
  const finish = rpcEvents("finish_email_proof_issuance")[0].args as Record<
    string,
    unknown
  >
  expect(acquire).toEqual(begin)
  expect(finish).toEqual({
    ...acquire,
    target_finish_disposition: "issued",
  })
  expect(acquire.target_issuance_flow).toBe("generic-sign-in")
  expect(acquire.target_operation_id).toMatch(/^[0-9a-f-]{36}$/)
  expect(acquire.target_lease_token).toMatch(/^\\x[0-9a-f]{64}$/)
  expect(acquire.target_recipient_digest).toMatch(/^\\x[0-9a-f]{64}$/)
  expect(JSON.stringify(acquire)).not.toContain("sponsor+family")

  expect(events.find((event) => event.kind === "signInWithOtp")?.args).toEqual({
    email: "sponsor+family@example.com",
    options: {
      emailRedirectTo: "https://creatorshare.com/auth/confirm?next=%2Fapp",
      shouldCreateUser: false,
    },
  })
})

test("retries one acquire transport failure with the identical operation and lease", async () => {
  let acquireAttempts = 0
  rpcHandler = (name) => {
    if (name === "acquire_email_proof_issuance_gate") {
      acquireAttempts += 1
      if (acquireAttempts === 1) throw new TypeError("fetch failed")
      return {
        data: [{ acquisition_result: "acquired", retry_after_seconds: 0 }],
        error: null,
      }
    }
    return { data: null, error: null }
  }

  await expect(
    issuer.issueGenericSignInEmailProof(managementOptions()),
  ).resolves.toEqual({ status: "issued" })
  const acquisitions = rpcEvents("acquire_email_proof_issuance_gate")
  expect(acquisitions).toHaveLength(2)
  expect(acquisitions[0].args).toEqual(acquisitions[1].args)
  expect(rpcEvents("begin_email_proof_issuance")).toHaveLength(1)
  expect(events.filter((event) => event.kind === "signInWithOtp")).toHaveLength(
    1,
  )
})

test("never retries semantic acquire errors and stops after two transport failures", async () => {
  rpcHandler = (name) => ({
    data: null,
    error:
      name === "acquire_email_proof_issuance_gate"
        ? { code: "55000", message: "stale" }
        : null,
  })
  await expect(
    issuer.issueGenericSignInEmailProof(managementOptions()),
  ).resolves.toEqual({ status: "unavailable", stage: "acquire" })
  expect(rpcEvents("acquire_email_proof_issuance_gate")).toHaveLength(1)
  expect(events.some((event) => event.kind === "stateless-client")).toBe(false)

  resetHarness()
  rpcHandler = (name) => {
    if (name === "acquire_email_proof_issuance_gate") {
      throw new TypeError("network unavailable")
    }
    return { data: null, error: null }
  }
  await expect(
    issuer.issueGenericSignInEmailProof(managementOptions()),
  ).resolves.toEqual({ status: "unavailable", stage: "acquire" })
  expect(rpcEvents("acquire_email_proof_issuance_gate")).toHaveLength(2)
  expect(events.some((event) => event.kind === "stateless-client")).toBe(false)
})

test("coalesced and deferred acquisitions perform no later transition or provider work", async () => {
  for (const [status, retryAfterSeconds] of [
    ["coalesced", 0],
    ["deferred", 3900],
  ] as const) {
    resetHarness()
    rpcHandler = (name) => ({
      data:
        name === "acquire_email_proof_issuance_gate"
          ? [
              {
                acquisition_result: status,
                retry_after_seconds: retryAfterSeconds,
              },
            ]
          : null,
      error: null,
    })

    await expect(
      issuer.issueGenericSignInEmailProof(managementOptions()),
    ).resolves.toEqual({ status, retryAfterSeconds })
    expect(events.map((event) => event.kind)).toEqual([
      "service-client",
      "acquire_email_proof_issuance_gate",
    ])
  }
})

test("abandons an acquired reservation when local provider construction fails", async () => {
  statelessClientFactory = () => {
    events.push({ kind: "stateless-client" })
    throw new Error("missing local auth configuration")
  }

  await expect(
    issuer.issueGenericSignInEmailProof(managementOptions()),
  ).resolves.toEqual({ status: "unavailable", stage: "configuration" })
  expect(events.map((event) => event.kind)).toEqual([
    "service-client",
    "acquire_email_proof_issuance_gate",
    "stateless-client",
    "abandon_email_proof_issuance",
  ])
})

test("does not abandon or call the provider after an uncertain begin", async () => {
  rpcHandler = (name) => ({
    data:
      name === "acquire_email_proof_issuance_gate"
        ? [{ acquisition_result: "acquired", retry_after_seconds: 0 }]
        : null,
    error:
      name === "begin_email_proof_issuance"
        ? { code: "57014", message: "statement canceled" }
        : null,
  })

  await expect(
    issuer.issueGenericSignInEmailProof(managementOptions()),
  ).resolves.toEqual({
    status: "unavailable",
    stage: "begin",
    retryAfterSeconds: 3900,
  })
  expect(events.map((event) => event.kind)).toEqual([
    "service-client",
    "acquire_email_proof_issuance_gate",
    "stateless-client",
    "begin_email_proof_issuance",
  ])
})

test("settles every provider throw, error, or malformed response as ambiguous", async () => {
  const failures: Array<() => unknown | Promise<unknown>> = [
    () => {
      throw new Error("provider failed")
    },
    () => ({
      data: { user: null, session: null },
      error: { message: "provider rejected request" },
    }),
    () => undefined,
    () => ({
      data: { user: null, session: null, recipient: "leak" },
      error: null,
    }),
  ]

  for (const failure of failures) {
    resetHarness()
    otpHandler = failure
    await expect(
      issuer.issueGenericSignInEmailProof(managementOptions()),
    ).resolves.toEqual({ status: "ambiguous", retryAfterSeconds: 3900 })
    expect(
      events.filter((event) => event.kind === "signInWithOtp"),
    ).toHaveLength(1)
    expect(rpcEvents("finish_email_proof_issuance")[0].args).toMatchObject({
      target_finish_disposition: "ambiguous",
    })
  }
})

test("treats a provider timeout as ambiguous without a second provider call", async () => {
  otpHandler = () => new Promise(() => {})
  const nativeSetTimeout = globalThis.setTimeout
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void) =>
    nativeSetTimeout(callback, 0)) as typeof setTimeout
  try {
    await expect(
      issuer.issueGenericSignInEmailProof(managementOptions()),
    ).resolves.toEqual({ status: "ambiguous", retryAfterSeconds: 3900 })
  } finally {
    globalThis.setTimeout = nativeSetTimeout
  }

  expect(events.filter((event) => event.kind === "signInWithOtp")).toHaveLength(
    1,
  )
  expect(rpcEvents("finish_email_proof_issuance")[0].args).toMatchObject({
    target_finish_disposition: "ambiguous",
  })
})

test("a lost finish cannot trigger another provider call or erase an issued result", async () => {
  rpcHandler = (name) => ({
    data:
      name === "acquire_email_proof_issuance_gate"
        ? [{ acquisition_result: "acquired", retry_after_seconds: 0 }]
        : null,
    error:
      name === "finish_email_proof_issuance"
        ? { code: "57014", message: "response lost" }
        : null,
  })

  await expect(
    issuer.issueGenericSignInEmailProof(managementOptions()),
  ).resolves.toEqual({ status: "issued" })
  expect(events.filter((event) => event.kind === "signInWithOtp")).toHaveLength(
    1,
  )
  expect(rpcEvents("finish_email_proof_issuance")).toHaveLength(1)
})

test("applies fixed creation policy and flow identity to every OTP flow", async () => {
  const cases = [
    {
      invoke: () => issuer.issueGenericSignInEmailProof(managementOptions()),
      flow: "generic-sign-in",
      shouldCreateUser: false,
    },
    {
      invoke: () => issuer.issueReauthenticationEmailProof(managementOptions()),
      flow: "reauthentication",
      shouldCreateUser: false,
    },
    {
      invoke: () => issuer.issueInitialClaimEmailProof(claimOptions()),
      flow: "initial-claim",
      shouldCreateUser: true,
    },
    {
      invoke: () => issuer.issueAccountClaimEmailProof(claimOptions()),
      flow: "account-claim",
      shouldCreateUser: false,
    },
  ]

  for (const scenario of cases) {
    resetHarness()
    await expect(scenario.invoke()).resolves.toEqual({ status: "issued" })
    const acquire = rpcEvents("acquire_email_proof_issuance_gate")[0]
      .args as Record<string, unknown>
    const provider = events.find((event) => event.kind === "signInWithOtp")
      ?.args as { options: { shouldCreateUser: boolean } }
    expect(acquire.target_issuance_flow).toBe(scenario.flow)
    expect(provider.options.shouldCreateUser).toBe(scenario.shouldCreateUser)
  }
})

test("requests an eight second abort bound for every anonymous provider transport", async () => {
  const calls = [
    () => issuer.issueGenericSignInEmailProof(managementOptions()),
    () =>
      issuer.issueRegistrationEmailProof({
        recipientEmail: "family@example.com",
        password: "Correct1!",
        firstName: "Ada",
        lastName: "Lovelace",
        redirectTo:
          "https://creatorshare.com/auth/confirm?next=%2Fapp%2Fmain%2Fonboarding",
        context: context(),
      }),
    () =>
      issuer.issuePasswordResetEmailProof({
        recipientEmail: "family@example.com",
        context: context(),
      }),
  ]

  for (const issue of calls) {
    resetHarness()
    await expect(issue()).resolves.toMatchObject({ status: "issued" })
    expect(
      events.find((event) => event.kind === "stateless-client")?.args,
    ).toEqual({ requestTimeoutMilliseconds: 8_000 })
  }
})

test("issues registration with exact normalized identity, profile, password, and redirect", async () => {
  await expect(
    issuer.issueRegistrationEmailProof({
      recipientEmail: " Family@Example.com ",
      password: "Correct1!",
      firstName: "Ada",
      lastName: "Lovelace",
      redirectTo:
        "https://creatorshare.com/auth/confirm?next=%2Fapp%2Fmain%2Fonboarding",
      context: context(),
    }),
  ).resolves.toEqual({ status: "issued" })

  expect(events.find((event) => event.kind === "signUp")?.args).toEqual({
    email: "family@example.com",
    password: "Correct1!",
    options: {
      data: { first_name: "Ada", last_name: "Lovelace" },
      emailRedirectTo:
        "https://creatorshare.com/auth/confirm?next=%2Fapp%2Fmain%2Fonboarding",
    },
  })
  expect(
    (
      rpcEvents("acquire_email_proof_issuance_gate")[0].args as Record<
        string,
        unknown
      >
    ).target_issuance_flow,
  ).toBe("registration")
})

test("settles every malformed registration response without leaking registration data to the gate", async () => {
  const password = " Correct1! "
  const firstName = "Ada Marie"
  const lastName = "Lovelace Family"
  const normalizedEmail = "family@example.com"
  const redirectTo =
    "https://creatorshare.com/auth/confirm?next=%2Fapp%2Fmain%2Fonboarding"
  const validUser = successUser(normalizedEmail)
  const validData = { user: validUser, session: null }
  const failures: Array<{
    label: string
    invoke: () => unknown | Promise<unknown>
  }> = [
    {
      label: "provider throw",
      invoke: () => {
        throw new Error("provider failed")
      },
    },
    {
      label: "provider error",
      invoke: () => ({
        data: validData,
        error: { message: "provider rejected request" },
      }),
    },
    {
      label: "null user",
      invoke: () => ({
        data: { user: null, session: null },
        error: null,
      }),
    },
    {
      label: "invalid user UUID",
      invoke: () => ({
        data: {
          user: { id: "not-a-uuid", email: normalizedEmail },
          session: null,
        },
        error: null,
      }),
    },
    {
      label: "mismatched user email",
      invoke: () => ({
        data: {
          user: successUser("other@example.com"),
          session: null,
        },
        error: null,
      }),
    },
    {
      label: "noncanonical user email",
      invoke: () => ({
        data: {
          user: successUser("Family@Example.com"),
          session: null,
        },
        error: null,
      }),
    },
    {
      label: "missing root data",
      invoke: () => ({ error: null }),
    },
    {
      label: "missing root error",
      invoke: () => ({ data: validData }),
    },
    {
      label: "extra root key",
      invoke: () => ({ data: validData, error: null, extra: true }),
    },
    {
      label: "missing data user",
      invoke: () => ({ data: { session: null }, error: null }),
    },
    {
      label: "missing data session",
      invoke: () => ({ data: { user: validUser }, error: null }),
    },
    {
      label: "extra data key",
      invoke: () => ({
        data: { ...validData, extra: true },
        error: null,
      }),
    },
    {
      label: "unconfirmed provider session",
      invoke: () => ({
        data: { user: validUser, session: { access_token: "secret" } },
        error: null,
      }),
    },
    {
      label: "undefined response",
      invoke: () => undefined,
    },
  ]

  for (const failure of failures) {
    await test.step(failure.label, async () => {
      resetHarness()
      signUpHandler = failure.invoke

      await expect(
        issuer.issueRegistrationEmailProof({
          recipientEmail: " Family@Example.com ",
          password,
          firstName,
          lastName,
          redirectTo,
          context: context(),
        }),
      ).resolves.toEqual({ status: "ambiguous", retryAfterSeconds: 3900 })

      const providerEvents = events.filter((event) => event.kind === "signUp")
      expect(providerEvents).toHaveLength(1)
      expect(providerEvents[0].args).toEqual({
        email: normalizedEmail,
        password,
        options: {
          data: {
            first_name: firstName,
            last_name: lastName,
          },
          emailRedirectTo: redirectTo,
        },
      })

      const acquireEvents = rpcEvents("acquire_email_proof_issuance_gate")
      const beginEvents = rpcEvents("begin_email_proof_issuance")
      const finishEvents = rpcEvents("finish_email_proof_issuance")
      expect(acquireEvents).toHaveLength(1)
      expect(beginEvents).toHaveLength(1)
      expect(finishEvents).toHaveLength(1)
      const acquire = acquireEvents[0].args as Record<string, unknown>
      const begin = beginEvents[0].args as Record<string, unknown>
      const finish = finishEvents[0].args as Record<string, unknown>
      expect(begin).toEqual(acquire)
      expect(finish).toEqual({
        ...acquire,
        target_finish_disposition: "ambiguous",
      })
      const serializedGateArguments = JSON.stringify([acquire, begin, finish])
      for (const privateValue of [
        normalizedEmail,
        password,
        firstName,
        lastName,
      ]) {
        expect(serializedGateArguments).not.toContain(privateValue)
      }
      expect(
        events.filter((event) =>
          (JSON.stringify(event.args) ?? "").includes(password),
        ),
      ).toEqual(providerEvents)
    })
  }
})

test("issues password reset without accepting a caller-controlled redirect", async () => {
  await expect(
    issuer.issuePasswordResetEmailProof({
      recipientEmail: " Family@Example.com ",
      context: context(),
    }),
  ).resolves.toEqual({ status: "issued" })
  expect(
    events.find((event) => event.kind === "resetPasswordForEmail")?.args,
  ).toBe("family@example.com")
  expect(
    (
      rpcEvents("acquire_email_proof_issuance_gate")[0].args as Record<
        string,
        unknown
      >
    ).target_issuance_flow,
  ).toBe("password-reset")
})

test("issues Creator Share administrator invitations with fixed metadata", async () => {
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  await expect(
    issuer.issueCreatorShareAdminInvitationEmailProof({
      recipientEmail: " Admin@Example.com ",
      invitedByUserId: INVITER_ID,
      redirectTo: "https://creatorshare.com/set-password",
      context: context(),
    }),
  ).resolves.toEqual({ status: "issued", userId: USER_ID })

  expect(
    events.find((event) => event.kind === "inviteUserByEmail")?.args,
  ).toEqual({
    email: "admin@example.com",
    options: {
      data: { invited_by: INVITER_ID },
      redirectTo: "https://creatorshare.com/set-password",
    },
  })
})

test("uses the durable outbox UUID and returns only bounded advocate proof material", async () => {
  await expect(
    issuer.issueAdvocateInvitationEmailProof({
      recipientEmail: " Advocate@Example.com ",
      outboxId: OUTBOX_ID,
      redirectTo: "https://creatorshare.com/advocate-invitation",
      context: context(),
    }),
  ).resolves.toEqual({
    status: "issued",
    proof: {
      userId: USER_ID,
      hashedToken: HASHED_TOKEN,
      authType: "magiclink",
    },
  })

  const acquire = rpcEvents("acquire_email_proof_issuance_gate")[0]
    .args as Record<string, unknown>
  expect(acquire).toMatchObject({
    target_operation_id: OUTBOX_ID,
    target_issuance_flow: "advocate-invitation",
  })
  expect(events.find((event) => event.kind === "generateLink")?.args).toEqual({
    type: "magiclink",
    email: "advocate@example.com",
    options: { redirectTo: "https://creatorshare.com/advocate-invitation" },
  })
})

test("strict provider response parsing rejects plausible but unsafe successes", async () => {
  signUpHandler = (input) => ({
    data: { user: successUser(input.email as string), session: { token: "x" } },
    error: null,
  })
  await expect(
    issuer.issueRegistrationEmailProof({
      recipientEmail: "family@example.com",
      password: "Correct1!",
      firstName: "Ada",
      lastName: "Lovelace",
      redirectTo:
        "https://creatorshare.com/auth/confirm?next=%2Fapp%2Fmain%2Fonboarding",
      context: context(),
    }),
  ).resolves.toEqual({ status: "ambiguous", retryAfterSeconds: 3900 })

  resetHarness()
  inviteHandler = (email) => ({
    data: { user: successUser(email), role: "admin" },
    error: null,
  })
  await expect(
    issuer.issueCreatorShareAdminInvitationEmailProof({
      recipientEmail: "admin@example.com",
      invitedByUserId: INVITER_ID,
      redirectTo: "https://creatorshare.com/set-password",
      context: context(),
    }),
  ).resolves.toEqual({ status: "ambiguous", retryAfterSeconds: 3900 })

  resetHarness()
  generateHandler = (input) => {
    const response = generatedLinkResponse(
      input.email as string,
      "https://creatorshare.com/wrong-target",
    )
    return response
  }
  await expect(
    issuer.issueAdvocateInvitationEmailProof({
      recipientEmail: "advocate@example.com",
      outboxId: OUTBOX_ID,
      redirectTo: "https://creatorshare.com/advocate-invitation",
      context: context(),
    }),
  ).resolves.toEqual({ status: "ambiguous", retryAfterSeconds: 3900 })
})

test("validates all caller-controlled arguments before acquiring a gate", async () => {
  const invalidCalls: Array<() => Promise<unknown>> = [
    () =>
      issuer.issueGenericSignInEmailProof({
        ...managementOptions(),
        redirectTo: "https://evil.example/auth/confirm?next=%2Fapp",
      }),
    () =>
      issuer.issueGenericSignInEmailProof({
        ...managementOptions(),
        recipientEmail: "not an email",
      }),
    () =>
      issuer.issueGenericSignInEmailProof({
        ...managementOptions(),
        context: { requestId: ZERO_UUID, traceId: null },
      }),
    () =>
      issuer.issueRegistrationEmailProof({
        recipientEmail: "family@example.com",
        password: "short",
        firstName: "Ada",
        lastName: "Lovelace",
        redirectTo:
          "https://creatorshare.com/auth/confirm?next=%2Fapp%2Fmain%2Fonboarding",
        context: context(),
      }),
    () =>
      issuer.issueRegistrationEmailProof({
        recipientEmail: "family@example.com",
        password: "alllowercase",
        firstName: "Ada",
        lastName: "Lovelace",
        redirectTo:
          "https://creatorshare.com/auth/confirm?next=%2Fapp%2Fmain%2Fonboarding",
        context: context(),
      }),
    () =>
      issuer.issueRegistrationEmailProof({
        recipientEmail: "family@example.com",
        password: "Correct1!",
        firstName: " Ada ",
        lastName: "Lovelace",
        redirectTo:
          "https://creatorshare.com/auth/confirm?next=%2Fapp%2Fmain%2Fonboarding",
        context: context(),
      }),
    () =>
      issuer.issueCreatorShareAdminInvitationEmailProof({
        recipientEmail: "admin@example.com",
        invitedByUserId: "not-a-uuid",
        redirectTo: "https://creatorshare.com/set-password",
        context: context(),
      }),
    () =>
      issuer.issueAdvocateInvitationEmailProof({
        recipientEmail: "advocate@example.com",
        outboxId: "not-a-uuid",
        redirectTo: "https://creatorshare.com/advocate-invitation",
        context: context(),
      }),
    () =>
      issuer.issuePasswordResetEmailProof({
        recipientEmail: "family@example.com",
        context: context(),
        redirectTo: "https://evil.example" as never,
      } as never),
  ]

  for (const invalidCall of invalidCalls) {
    resetHarness()
    await expect(invalidCall()).rejects.toMatchObject({
      name: "EmailProofIssuanceInputError",
      message: "email_proof_issuance_input_invalid",
    })
    expect(events).toHaveLength(0)
  }
})

const ZERO_UUID = "00000000-0000-0000-0000-000000000000"

test("rejects deterministic configuration failures before acquisition", async () => {
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  await expect(
    issuer.issueGenericSignInEmailProof(managementOptions()),
  ).resolves.toEqual({ status: "unavailable", stage: "configuration" })
  expect(events).toHaveLength(0)

  resetHarness()
  validEnvironment()
  delete process.env.SPONSORSHIP_CRYPTO_SECRET_V1
  await expect(
    issuer.issueGenericSignInEmailProof(managementOptions()),
  ).resolves.toEqual({ status: "unavailable", stage: "configuration" })
  expect(events).toHaveLength(0)

  resetHarness()
  validEnvironment()
  process.env.NEXT_PUBLIC_BASE_URL = "https://evil.example"
  await expect(
    issuer.issueGenericSignInEmailProof(managementOptions()),
  ).rejects.toMatchObject({ name: "EmailProofIssuanceInputError" })
  expect(events).toHaveLength(0)
})

test("uses a fresh server operation and lease for separate issuance attempts", async () => {
  await issuer.issueGenericSignInEmailProof(managementOptions())
  await issuer.issueGenericSignInEmailProof(managementOptions())
  const acquisitions = rpcEvents("acquire_email_proof_issuance_gate").map(
    (event) => event.args as Record<string, unknown>,
  )
  expect(acquisitions).toHaveLength(2)
  expect(acquisitions[0].target_operation_id).not.toBe(
    acquisitions[1].target_operation_id,
  )
  expect(acquisitions[0].target_lease_token).not.toBe(
    acquisitions[1].target_lease_token,
  )
})
