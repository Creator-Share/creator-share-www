import { expect, test } from "@playwright/test"

import {
  createEtherealImapMailbox,
  isFf029CanaryEmail,
  readEtherealImapMailboxEnvironment,
} from "./support/ethereal-imap-mailbox.mjs"

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

function fakeImapFixture(initialMessages: FakeMessage[]) {
  const state = {
    clientClosed: false,
    clientConnected: false,
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
      state.clientConnected = true
    }

    async mailboxOpen(path: string) {
      expect(path).toBe("INBOX")
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
      state.deletedUids.push([...uids])
      state.messages = state.messages.filter(
        (message) => !uids.includes(message.uid),
      )
      return true
    }

    async logout() {
      state.clientConnected = false
    }

    close() {
      state.clientClosed = true
    }
  }

  return { FakeImapFlow, state }
}

async function createFixtureMailbox(
  messages: FakeMessage[],
  overrides: Record<string, unknown> = {},
) {
  const fixture = fakeImapFixture(messages)
  const mailbox = await createEtherealImapMailbox({
    user: "ff029-canary@ethereal.email",
    password: "fixture-password",
    ImapFlowImplementation: fixture.FakeImapFlow,
    simpleParserImplementation: async (source: Buffer) => ({
      html: source.toString("utf8"),
    }),
    pollIntervalMilliseconds: 25,
    pollTimeoutMilliseconds: 1_000,
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
        `<a href="https://creatorshare.com/auth/confirm#token_hash=${newToken}&amp;v=1">Continue</a>`,
      ].join(""),
    ),
  })
  const messageId = await mailbox.waitForNewMessage(
    email,
    priorIds,
    runLifecycle,
  )
  expect(messageId).toBe("42:3")
  await expect(mailbox.proofFromMessage(messageId, runLifecycle)).resolves.toBe(
    newToken,
  )
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
