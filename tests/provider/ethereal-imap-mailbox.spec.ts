import { expect, test } from "@playwright/test"

import {
  createEtherealImapMailbox,
  FF029_HOSTED_ETHEREAL_CLEANUP_QUIET_PERIOD_MILLISECONDS,
  isFf029CanaryEmail,
  proofTokenHashFromEtherealHtml,
  readEtherealImapMailboxEnvironment,
} from "./support/ethereal-imap-mailbox.mjs"

const EXPECTED_STAGING_PROOF_LINK =
  "https://advocate-staging.creatorshare.com/auth/confirm?next=%2Fapp#token_hash={token_hash}&v=1"

interface FakeMessage {
  envelope: {
    bcc?: Array<{ address: string }>
    cc?: Array<{ address: string }>
    to?: Array<{ address: string }>
  }
  source?: Buffer
  uid: number
}

function lifecycle(milliseconds = 5_000) {
  return {
    executionDeadline: Date.now() + milliseconds,
    signal: new AbortController().signal,
  }
}

function fakeImapFixture(
  initialMessages: FakeMessage[],
  behavior: {
    connectError?: Error
    logoutError?: Error
    mailboxOpenError?: Error
    messageDeleteImplementation?: (uids: number[]) => Promise<boolean>
  } = {},
) {
  const state = {
    clientClosed: false,
    clientCloseCalls: 0,
    clientConnected: false,
    clientLogoutCalls: 0,
    deletedUids: [] as number[][],
    lockReleases: 0,
    messages: [...initialMessages],
    options: null as Record<string, unknown> | null,
    searchQueries: [] as Array<Record<string, unknown>>,
  }

  class FakeImapFlow {
    constructor(options: Record<string, unknown>) {
      state.options = options
    }

    async connect() {
      if (behavior.connectError) throw behavior.connectError
      state.clientConnected = true
    }

    async mailboxOpen(path: string) {
      expect(path).toBe("INBOX")
      if (behavior.mailboxOpenError) throw behavior.mailboxOpenError
      return { uidValidity: 42n }
    }

    async getMailboxLock(path: string) {
      expect(path).toBe("INBOX")
      return {
        release() {
          state.lockReleases += 1
        },
      }
    }

    async search(query: Record<string, unknown>, options: unknown) {
      expect(options).toEqual({ uid: true })
      state.searchQueries.push(query)
      const recipient = String(query.to).toLowerCase()
      return state.messages
        .filter((message) =>
          [
            ...(message.envelope.to ?? []),
            ...(message.envelope.cc ?? []),
            ...(message.envelope.bcc ?? []),
          ].some((candidate) => candidate.address.toLowerCase() === recipient),
        )
        .map((message) => message.uid)
    }

    async fetchAll(
      uids: number[],
      query: Record<string, unknown>,
      options: unknown,
    ) {
      expect(query).toEqual({ uid: true, envelope: true })
      expect(options).toEqual({ uid: true })
      return state.messages.filter((message) => uids.includes(message.uid))
    }

    async fetchOne(
      uid: string,
      query: Record<string, unknown>,
      options: unknown,
    ) {
      expect(query).toEqual({ uid: true, source: true, size: true })
      expect(options).toEqual({ uid: true })
      const message = state.messages.find(
        (candidate) => candidate.uid === Number(uid),
      )
      return message
        ? {
            ...message,
            size: message.source?.length ?? 0,
          }
        : false
    }

    async messageDelete(uids: number[], options: unknown) {
      expect(options).toEqual({ uid: true })
      if (behavior.messageDeleteImplementation) {
        return behavior.messageDeleteImplementation(uids)
      }
      state.deletedUids.push([...uids])
      state.messages = state.messages.filter(
        (message) => !uids.includes(message.uid),
      )
      return true
    }

    async logout() {
      state.clientLogoutCalls += 1
      if (behavior.logoutError) throw behavior.logoutError
      state.clientConnected = false
    }

    close() {
      state.clientCloseCalls += 1
      state.clientClosed = true
      state.clientConnected = false
    }
  }

  return { FakeImapFlow, state }
}

async function createFixtureMailbox(
  messages: FakeMessage[],
  overrides: Record<string, unknown> = {},
  behavior: Parameters<typeof fakeImapFixture>[1] = {},
) {
  const fixture = fakeImapFixture(messages, behavior)
  const mailbox = await createEtherealImapMailbox({
    user: "ff029-canary@ethereal.email",
    password: "fixture-password",
    ImapFlowImplementation: fixture.FakeImapFlow,
    simpleParserImplementation: async (source: Buffer) => ({
      html: source.toString("utf8"),
    }),
    pollIntervalMilliseconds: 25,
    pollTimeoutMilliseconds: 1_000,
    cleanupQuietPeriodMilliseconds: 75,
    allowUnsafeTestCleanupQuietPeriod: true,
    ...overrides,
  })
  return { ...fixture, mailbox }
}

test("accepts only fixed Ethereal IMAP configuration and tagged identities", async () => {
  const configuration = readEtherealImapMailboxEnvironment({
    FF029_ETHEREAL_IMAP_USER: "ff029-canary@ethereal.email",
    FF029_ETHEREAL_IMAP_PASSWORD: "fixture-password",
    NODE_ENV: "test",
  })
  expect(configuration).toEqual({
    host: "imap.ethereal.email",
    port: 993,
    secure: true,
    mailbox: "INBOX",
    user: "ff029-canary@ethereal.email",
    password: "fixture-password",
  })
  expect(
    isFf029CanaryEmail(
      "creator-share-ff029-0123456789abcdef0123456789abcdef@example.com",
    ),
  ).toBe(true)
  expect(isFf029CanaryEmail("ordinary-user@example.com")).toBe(false)
  expect(FF029_HOSTED_ETHEREAL_CLEANUP_QUIET_PERIOD_MILLISECONDS).toBe(60_000)

  const secret = "must-not-appear-in-errors"
  for (const environment of [
    {
      FF029_ETHEREAL_IMAP_USER: "attacker@example.com",
      FF029_ETHEREAL_IMAP_PASSWORD: secret,
      NODE_ENV: "test",
    },
    {
      FF029_ETHEREAL_IMAP_USER: "ff029-canary@ethereal.email",
      FF029_ETHEREAL_IMAP_PASSWORD: "bad password",
      NODE_ENV: "test",
    },
  ] as const) {
    let error: unknown
    try {
      readEtherealImapMailboxEnvironment(environment)
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(Error)
    expect(String(error)).not.toContain(secret)
  }

  let constructorCalls = 0
  await expect(
    createEtherealImapMailbox({
      host: "imap.attacker.example",
      user: "ff029-canary@ethereal.email",
      password: "fixture-password",
      ImapFlowImplementation: class {
        constructor() {
          constructorCalls += 1
        }
      },
      simpleParserImplementation: async () => ({ html: "" }),
    }),
  ).rejects.toThrow(/ff029_ethereal_endpoint_invalid/)
  expect(constructorCalls).toBe(0)

  await expect(
    createEtherealImapMailbox({
      user: "ff029-canary@ethereal.email",
      password: "fixture-password",
      cleanupQuietPeriodMilliseconds: 59_999,
      ImapFlowImplementation: class {},
      simpleParserImplementation: async () => ({ html: "" }),
    }),
  ).rejects.toThrow(/ff029_ethereal_cleanup_quiet_period_invalid/)
})

test("accepts one exact staging proof link and rejects ambiguous or expanded links", () => {
  const token = "a".repeat(48)
  expect(
    proofTokenHashFromEtherealHtml(
      `<a href="https://example.com#token_hash=${token}&amp;legacy=1">Continue</a>`,
    ),
  ).toBe(token)
  expect(
    proofTokenHashFromEtherealHtml(
      [
        '<a href="https://creatorshare.com/about">About</a>',
        `<a href="https://advocate-staging.creatorshare.com/auth/confirm?next=%2Fapp#token_hash=${token}&amp;v=1">Continue</a>`,
      ].join(""),
      EXPECTED_STAGING_PROOF_LINK,
    ),
  ).toBe(token)

  for (const href of [
    `https://attacker.example/auth/confirm?next=%2Fapp#token_hash=${token}&v=1`,
    `https://advocate-staging.creatorshare.com/auth/callback?next=%2Fapp#token_hash=${token}&v=1`,
    `https://advocate-staging.creatorshare.com/auth/confirm?next=%2Fsponsor%2Fclaim#token_hash=${token}&v=1`,
    `https://advocate-staging.creatorshare.com/auth/confirm?next=%2Fapp&unexpected=1#token_hash=${token}&v=1`,
    `https://advocate-staging.creatorshare.com/auth/confirm?next=%2Fapp#token_hash=${token}&v=1&unexpected=1`,
    `https://advocate-staging.creatorshare.com/auth/confirm?next=%2Fapp#token_hash=${token}&token_hash=${token}&v=1`,
    `https://advocate-staging.creatorshare.com/auth/confirm?next=%2Fapp#v=1&token_hash=${token}`,
    `https://advocate-staging.creatorshare.com/auth/confirm?token_hash=${token}&next=%2Fapp#v=1`,
  ]) {
    expect(() =>
      proofTokenHashFromEtherealHtml(
        `<a href="${href.replaceAll("&", "&amp;")}">Continue</a>`,
        EXPECTED_STAGING_PROOF_LINK,
      ),
    ).toThrow(/ff029_ethereal_proof_invalid/)
  }

  const validHref = `https://advocate-staging.creatorshare.com/auth/confirm?next=%2Fapp#token_hash=${token}&amp;v=1`
  expect(() =>
    proofTokenHashFromEtherealHtml(
      `<a href="${validHref}">First</a><a href="${validHref}">Second</a>`,
      EXPECTED_STAGING_PROOF_LINK,
    ),
  ).toThrow(/ff029_ethereal_proof_ambiguous/)

  expect(() =>
    proofTokenHashFromEtherealHtml(
      `<a href="${validHref}">Continue</a>`,
      "https://creatorshare.com/auth/confirm?next=%2Fapp#token_hash={token_hash}&v=1",
    ),
  ).toThrow(/ff029_ethereal_proof_template_invalid/)
})

test("retrieves only a newly delivered exact-recipient proof", async () => {
  const email =
    "creator-share-ff029-0123456789abcdef0123456789abcdef@example.com"
  const oldToken = "a".repeat(48)
  const newToken = "b".repeat(48)
  const { mailbox, state } = await createFixtureMailbox([
    {
      uid: 1,
      envelope: { to: [{ address: "unrelated@example.com" }] },
      source: Buffer.from(
        `<a href="https://example.com#token_hash=${oldToken}">`,
      ),
    },
    {
      uid: 2,
      envelope: { to: [{ address: email }] },
      source: Buffer.from(
        `<a href="https://example.com#token_hash=${oldToken}">`,
      ),
    },
  ])
  const runLifecycle = lifecycle()
  const priorIds = await mailbox.snapshot(email, runLifecycle)
  expect([...priorIds]).toEqual(["42:2"])

  state.messages.push({
    uid: 3,
    envelope: { to: [{ address: email.toUpperCase() }] },
    source: Buffer.from(
      [
        '<a href="https://creatorshare.com/about">About</a>',
        `<a href="https://advocate-staging.creatorshare.com/auth/confirm?next=%2Fapp#token_hash=${newToken}&amp;v=1">Continue</a>`,
      ].join(""),
    ),
  })
  const messageId = await mailbox.waitForNewMessage(
    email,
    priorIds,
    runLifecycle,
  )
  expect(messageId).toBe("42:3")
  await expect(
    mailbox.proofFromMessage(
      messageId,
      runLifecycle,
      EXPECTED_STAGING_PROOF_LINK,
    ),
  ).resolves.toBe(newToken)
  expect(state.searchQueries).toEqual([{ to: email }, { to: email }])
  expect(state.options).toMatchObject({
    host: "imap.ethereal.email",
    port: 993,
    secure: true,
    logger: false,
    emitLogs: false,
    disableAutoIdle: true,
  })
  expect(state.options).not.toHaveProperty("password")
  await mailbox.close(runLifecycle)
  expect(state.clientConnected).toBe(false)
})

test("deletes only messages whose complete recipient set is tracked", async () => {
  const email =
    "creator-share-ff029-0123456789abcdef0123456789abcdef@example.com"
  const secondEmail =
    "creator-share-ff029-abcdef0123456789abcdef0123456789@example.com"
  const { mailbox, state } = await createFixtureMailbox([
    {
      uid: 1,
      envelope: { to: [{ address: "unrelated@example.com" }] },
    },
    {
      uid: 2,
      envelope: { to: [{ address: email }] },
    },
    {
      uid: 3,
      envelope: {
        to: [{ address: email }, { address: "unrelated@example.com" }],
      },
    },
    {
      uid: 4,
      envelope: {
        to: [{ address: email }],
        cc: [{ address: secondEmail }],
      },
    },
  ])
  const runLifecycle = { cleanupDeadline: Date.now() + 5_000 }
  await expect(
    mailbox.deleteTrackedMessages(new Set([email, secondEmail]), runLifecycle),
  ).rejects.toThrow(/ff029_ethereal_cleanup_incomplete/)
  expect(state.deletedUids).toEqual([[2, 4]])
  expect(state.messages.map((message) => message.uid)).toEqual([1, 3])
  expect(
    await mailbox.countTrackedMessages(new Set([email]), runLifecycle),
  ).toBe(1)
})

test("proves complete cleanup without touching unrelated mail", async () => {
  const email =
    "creator-share-ff029-0123456789abcdef0123456789abcdef@example.com"
  const { mailbox, state } = await createFixtureMailbox([
    {
      uid: 1,
      envelope: { to: [{ address: "unrelated@example.com" }] },
    },
    {
      uid: 2,
      envelope: { to: [{ address: email }] },
    },
  ])
  const runLifecycle = lifecycle()
  await expect(
    mailbox.deleteTrackedMessages(new Set([email]), runLifecycle),
  ).resolves.toBeUndefined()
  expect(state.deletedUids).toEqual([[2]])
  expect(state.messages.map((message) => message.uid)).toEqual([1])
  await expect(
    mailbox.countTrackedMessages(new Set([email]), runLifecycle),
  ).resolves.toBe(0)
})

test("requires a bounded quiet period and removes late tracked delivery", async () => {
  const email =
    "creator-share-ff029-0123456789abcdef0123456789abcdef@example.com"
  const { mailbox, state } = await createFixtureMailbox([], {
    cleanupQuietPeriodMilliseconds: 100,
  })
  const lateDelivery = setTimeout(() => {
    state.messages.push({
      uid: 9,
      envelope: { to: [{ address: email }] },
    })
  }, 40)
  try {
    await expect(
      mailbox.deleteTrackedMessages(new Set([email]), {
        cleanupDeadline: Date.now() + 2_000,
      }),
    ).resolves.toBeUndefined()
  } finally {
    clearTimeout(lateDelivery)
  }
  expect(state.deletedUids).toEqual([[9]])
  expect(state.messages).toEqual([])
})

test("fails closed when the cleanup deadline cannot contain the quiet period", async () => {
  const email =
    "creator-share-ff029-0123456789abcdef0123456789abcdef@example.com"
  const { mailbox, state } = await createFixtureMailbox([], {
    cleanupQuietPeriodMilliseconds: 1_000,
    pollIntervalMilliseconds: 250,
  })
  const outcome = await mailbox
    .deleteTrackedMessages(new Set([email]), {
      cleanupDeadline: Date.now() + 80,
    })
    .then(
      () => ({ status: "resolved" as const, error: null }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    )
  expect(outcome.status).toBe("rejected")
  expect((outcome.error as Error).message).toBe(
    "ff029_ethereal_operation_unsettled_after_abort",
  )
  expect(
    (outcome.error as { ff029RetainExclusiveOwnership?: boolean })
      .ff029RetainExclusiveOwnership,
  ).toBe(true)
  await mailbox.close(lifecycle())
  expect(state.clientClosed).toBe(true)
})

test("joins a late IMAP deletion or marks ownership retained before returning", async () => {
  const email =
    "creator-share-ff029-0123456789abcdef0123456789abcdef@example.com"
  let mutationAt = 0
  const fixture = await createFixtureMailbox(
    [
      {
        uid: 2,
        envelope: { to: [{ address: email }] },
      },
    ],
    {
      cleanupQuietPeriodMilliseconds: 50,
    },
    {
      async messageDeleteImplementation() {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 120))
        mutationAt = Date.now()
        return true
      },
    },
  )
  let settledAt = 0
  const outcome = await fixture.mailbox
    .deleteTrackedMessages(new Set([email]), {
      cleanupDeadline: Date.now() + 30,
      signal: new AbortController().signal,
    })
    .then(
      () => ({ status: "resolved" as const, error: null }),
      (error: unknown) => ({
        status: "rejected" as const,
        error,
      }),
    )
    .finally(() => {
      settledAt = Date.now()
    })
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 150))
  expect(outcome.status).toBe("rejected")
  expect(mutationAt).toBeGreaterThan(0)
  if (settledAt < mutationAt) {
    expect(
      (outcome.error as { ff029RetainExclusiveOwnership?: boolean })
        .ff029RetainExclusiveOwnership,
    ).toBe(true)
  } else {
    expect(settledAt).toBeGreaterThanOrEqual(mutationAt)
  }
})

test("closes transport after partial initialization and failed logout", async () => {
  const connectFailure = await createFixtureMailbox(
    [],
    {},
    { connectError: new Error("fixture connect failure") },
  )
  await expect(connectFailure.mailbox.initialize(lifecycle())).rejects.toThrow(
    /ff029_ethereal_connection_unavailable/,
  )
  expect(connectFailure.state.clientCloseCalls).toBe(1)
  expect(connectFailure.state.clientConnected).toBe(false)

  const partial = await createFixtureMailbox(
    [],
    {},
    { mailboxOpenError: new Error("fixture mailbox open failure") },
  )
  await expect(partial.mailbox.initialize(lifecycle())).rejects.toThrow(
    /ff029_ethereal_connection_unavailable/,
  )
  expect(partial.state.clientCloseCalls).toBe(1)
  expect(partial.state.clientConnected).toBe(false)
  await partial.mailbox.close(lifecycle())
  expect(partial.state.clientCloseCalls).toBe(1)

  const logoutFailure = await createFixtureMailbox(
    [],
    {},
    { logoutError: new Error("fixture logout failure") },
  )
  await logoutFailure.mailbox.initialize(lifecycle())
  await expect(logoutFailure.mailbox.close(lifecycle())).rejects.toThrow(
    /ff029_ethereal_disconnect_failed/,
  )
  expect(logoutFailure.state.clientLogoutCalls).toBe(1)
  expect(logoutFailure.state.clientCloseCalls).toBe(1)
  expect(logoutFailure.state.clientConnected).toBe(false)
})

test("rejects untagged cleanup before opening the mailbox", async () => {
  const { mailbox, state } = await createFixtureMailbox([])
  await expect(
    mailbox.deleteTrackedMessages(
      new Set(["ordinary-user@example.com"]),
      lifecycle(),
    ),
  ).rejects.toThrow(/ff029_ethereal_canary_email_invalid/)
  expect(state.clientConnected).toBe(false)
  expect(state.searchQueries).toEqual([])
  expect(state.deletedUids).toEqual([])
})
