const ETHEREAL_IMAP_HOST = "imap.ethereal.email"
const ETHEREAL_IMAP_PORT = 993
const ETHEREAL_MAILBOX = "INBOX"
const DEFAULT_CONNECT_TIMEOUT_MILLISECONDS = 10_000
const DEFAULT_OPERATION_TIMEOUT_MILLISECONDS = 15_000
const DEFAULT_OPERATION_ABORT_JOIN_MILLISECONDS = 5_000
const DEFAULT_POLL_INTERVAL_MILLISECONDS = 250
const DEFAULT_POLL_TIMEOUT_MILLISECONDS = 30_000
export const FF029_HOSTED_ETHEREAL_CLEANUP_QUIET_PERIOD_MILLISECONDS = 60_000
const DEFAULT_CLEANUP_QUIET_PERIOD_MILLISECONDS =
  FF029_HOSTED_ETHEREAL_CLEANUP_QUIET_PERIOD_MILLISECONDS
const MAXIMUM_CLEANUP_QUIET_PERIOD_MILLISECONDS = 5 * 60_000
const MAXIMUM_MESSAGE_BYTES = 2 * 1024 * 1024
const MAXIMUM_SEARCH_RESULTS = 10_000
const CANARY_EMAIL_PATTERN = /^creator-share-ff029-[0-9a-f]{32}@example\.com$/
const ETHEREAL_USER_PATTERN =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@ethereal\.email$/
const TOKEN_HASH_PATTERN = /^[A-Za-z0-9._~-]{32,384}$/
const TOKEN_HASH_TEMPLATE_VALUE = "{token_hash}"
const STAGING_PROOF_ORIGINS = new Set([
  "https://advocate-staging.creatorshare.com",
  "https://canary.advocate-staging.creatorshare.com",
])
const TOKEN_HASH_TEMPLATE_SUBSTITUTE = "x".repeat(48)

function fixedError(code) {
  return new Error(code)
}

function exclusiveOwnershipError(code) {
  const error = fixedError(code)
  Object.defineProperty(error, "ff029RetainExclusiveOwnership", {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  })
  return error
}

function requiredEnvironmentValue(environment, name, minimum, maximum) {
  const value = environment[name]
  if (
    typeof value !== "string" ||
    value.length < minimum ||
    value.length > maximum ||
    !/^[\x21-\x7e]+$/.test(value)
  ) {
    throw fixedError(`ff029_environment_${name.toLowerCase()}_invalid`)
  }
  return value
}

function positiveDuration(value, fallback, code, minimum, maximum) {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw fixedError(code)
  }
  return value
}

function normalizeCanaryEmail(value) {
  if (typeof value !== "string") {
    throw fixedError("ff029_ethereal_canary_email_invalid")
  }
  const normalized = value.toLowerCase()
  if (normalized !== value || !CANARY_EMAIL_PATTERN.test(normalized)) {
    throw fixedError("ff029_ethereal_canary_email_invalid")
  }
  return normalized
}

function normalizeTrackedEmails(values) {
  if (!(values instanceof Set) || values.size === 0) {
    throw fixedError("ff029_ethereal_tracked_emails_invalid")
  }
  return new Set([...values].map(normalizeCanaryEmail))
}

function envelopeRecipients(envelope) {
  const recipients = []
  for (const field of ["to", "cc", "bcc"]) {
    const addresses = envelope?.[field]
    if (!Array.isArray(addresses)) continue
    for (const candidate of addresses) {
      if (typeof candidate?.address !== "string") continue
      recipients.push(candidate.address.toLowerCase())
    }
  }
  return recipients
}

function validUid(value) {
  return Number.isSafeInteger(value) && value > 0
}

function uidValidityString(value) {
  const normalized =
    typeof value === "bigint"
      ? value.toString()
      : Number.isSafeInteger(value) && value > 0
        ? String(value)
        : null
  if (!normalized || !/^[1-9][0-9]{0,19}$/.test(normalized)) {
    throw fixedError("ff029_ethereal_mailbox_identity_invalid")
  }
  return normalized
}

function messageIdentity(uidValidity, uid) {
  if (!validUid(uid)) throw fixedError("ff029_ethereal_message_id_invalid")
  return `${uidValidity}:${uid}`
}

function uidFromMessageIdentity(identity, expectedUidValidity) {
  if (typeof identity !== "string") {
    throw fixedError("ff029_ethereal_message_id_invalid")
  }
  const match = identity.match(/^([1-9][0-9]{0,19}):([1-9][0-9]{0,15})$/)
  if (!match || match[1] !== expectedUidValidity) {
    throw fixedError("ff029_ethereal_message_id_invalid")
  }
  const uid = Number(match[2])
  if (!validUid(uid)) throw fixedError("ff029_ethereal_message_id_invalid")
  return uid
}

function uniqueParameterEntries(parameters) {
  const entries = [...parameters.entries()]
  if (
    entries.some(
      ([key], index) =>
        key.length === 0 ||
        entries.findIndex(([candidate]) => candidate === key) !== index,
    )
  ) {
    return null
  }
  return entries
}

function exactParameterEntries(actual, expected, dynamicKey = null) {
  const actualEntries = uniqueParameterEntries(actual)
  const expectedEntries = uniqueParameterEntries(expected)
  if (
    actualEntries === null ||
    expectedEntries === null ||
    actualEntries.length !== expectedEntries.length
  ) {
    return false
  }
  const expectedValues = new Map(expectedEntries)
  for (const [key, value] of actualEntries) {
    if (
      !expectedValues.has(key) ||
      (key !== dynamicKey && expectedValues.get(key) !== value)
    ) {
      return false
    }
  }
  return true
}

function strictProofTemplate(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 8_192 ||
    value.split(TOKEN_HASH_TEMPLATE_VALUE).length !== 2
  ) {
    throw fixedError("ff029_ethereal_proof_template_invalid")
  }
  let template
  try {
    template = new URL(
      value.replace(TOKEN_HASH_TEMPLATE_VALUE, TOKEN_HASH_TEMPLATE_SUBSTITUTE),
    )
  } catch {
    throw fixedError("ff029_ethereal_proof_template_invalid")
  }
  const fragment = new URLSearchParams(template.hash.slice(1))
  const fragmentEntries = uniqueParameterEntries(fragment)
  if (
    !STAGING_PROOF_ORIGINS.has(template.origin) ||
    template.username !== "" ||
    template.password !== "" ||
    template.pathname.length === 0 ||
    uniqueParameterEntries(template.searchParams) === null ||
    fragmentEntries === null ||
    fragmentEntries.length !== 2 ||
    fragment.get("token_hash") !== TOKEN_HASH_TEMPLATE_SUBSTITUTE ||
    fragment.get("v") !== "1"
  ) {
    throw fixedError("ff029_ethereal_proof_template_invalid")
  }
  return template
}

function strictProofToken(link, template) {
  const fragment = new URLSearchParams(link.hash.slice(1))
  const tokenHash = fragment.get("token_hash")
  if (
    link.origin !== template.origin ||
    link.username !== "" ||
    link.password !== "" ||
    link.pathname !== template.pathname ||
    link.search !== template.search ||
    link.hash !==
      template.hash.replace(TOKEN_HASH_TEMPLATE_SUBSTITUTE, tokenHash ?? "") ||
    !exactParameterEntries(link.searchParams, template.searchParams) ||
    !exactParameterEntries(
      fragment,
      new URLSearchParams(template.hash.slice(1)),
      "token_hash",
    ) ||
    typeof tokenHash !== "string" ||
    !TOKEN_HASH_PATTERN.test(tokenHash)
  ) {
    throw fixedError("ff029_ethereal_proof_invalid")
  }
  return tokenHash
}

/**
 * @param {unknown} html
 * @param {string | undefined} expectedLinkTemplate
 * @returns {string}
 */
export function proofTokenHashFromEtherealHtml(
  html,
  expectedLinkTemplate = undefined,
) {
  if (
    typeof html !== "string" ||
    html.length === 0 ||
    html.length > MAXIMUM_MESSAGE_BYTES
  ) {
    throw fixedError("ff029_ethereal_message_invalid")
  }
  const template =
    expectedLinkTemplate === undefined
      ? null
      : strictProofTemplate(expectedLinkTemplate)
  const strictTokens = []
  for (const match of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    const href = match[1].replaceAll("&amp;", "&")
    let link
    try {
      link = new URL(href)
    } catch {
      if (template !== null && href.includes("token_hash")) {
        throw fixedError("ff029_ethereal_proof_invalid")
      }
      continue
    }
    const tokenHash = new URLSearchParams(link.hash.slice(1)).get("token_hash")
    if (template === null) {
      if (tokenHash && TOKEN_HASH_PATTERN.test(tokenHash)) return tokenHash
      continue
    }
    if (
      tokenHash !== null ||
      href.includes("token_hash") ||
      (link.origin === template.origin &&
        link.pathname === template.pathname &&
        link.hash !== "")
    ) {
      strictTokens.push(strictProofToken(link, template))
    }
  }
  if (strictTokens.length > 1) {
    throw fixedError("ff029_ethereal_proof_ambiguous")
  }
  if (strictTokens.length === 1) {
    return strictTokens[0]
  }
  throw fixedError("ff029_ethereal_proof_missing")
}

function sleep(milliseconds, signal) {
  return new Promise((resolvePromise, rejectPromise) => {
    if (signal?.aborted) {
      rejectPromise(fixedError("ff029_operation_cancelled"))
      return
    }
    let timer
    const abort = () => {
      clearTimeout(timer)
      rejectPromise(fixedError("ff029_operation_cancelled"))
    }
    timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort)
      resolvePromise()
    }, milliseconds)
    signal?.addEventListener("abort", abort, { once: true })
  })
}

export function readEtherealImapMailboxEnvironment(environment = process.env) {
  const user = requiredEnvironmentValue(
    environment,
    "FF029_ETHEREAL_IMAP_USER",
    3,
    254,
  )
  if (!ETHEREAL_USER_PATTERN.test(user)) {
    throw fixedError("ff029_environment_ff029_ethereal_imap_user_invalid")
  }
  const password = requiredEnvironmentValue(
    environment,
    "FF029_ETHEREAL_IMAP_PASSWORD",
    8,
    512,
  )
  return Object.freeze({
    host: ETHEREAL_IMAP_HOST,
    port: ETHEREAL_IMAP_PORT,
    secure: true,
    mailbox: ETHEREAL_MAILBOX,
    user,
    password,
  })
}

export function isFf029CanaryEmail(value) {
  return typeof value === "string" && CANARY_EMAIL_PATTERN.test(value)
}

export async function createEtherealImapMailbox(options) {
  const host = options?.host ?? ETHEREAL_IMAP_HOST
  const port = options?.port ?? ETHEREAL_IMAP_PORT
  const secure = options?.secure ?? true
  const mailbox = options?.mailbox ?? ETHEREAL_MAILBOX
  if (
    host !== ETHEREAL_IMAP_HOST ||
    port !== ETHEREAL_IMAP_PORT ||
    secure !== true ||
    mailbox !== ETHEREAL_MAILBOX
  ) {
    throw fixedError("ff029_ethereal_endpoint_invalid")
  }
  const user = options?.user
  const password = options?.password
  if (
    typeof user !== "string" ||
    !ETHEREAL_USER_PATTERN.test(user) ||
    typeof password !== "string" ||
    password.length < 8 ||
    password.length > 512 ||
    !/^[\x21-\x7e]+$/.test(password)
  ) {
    throw fixedError("ff029_ethereal_credentials_invalid")
  }
  const connectTimeoutMilliseconds = positiveDuration(
    options?.connectTimeoutMilliseconds,
    DEFAULT_CONNECT_TIMEOUT_MILLISECONDS,
    "ff029_ethereal_connect_timeout_invalid",
    1_000,
    60_000,
  )
  const operationTimeoutMilliseconds = positiveDuration(
    options?.operationTimeoutMilliseconds,
    DEFAULT_OPERATION_TIMEOUT_MILLISECONDS,
    "ff029_ethereal_operation_timeout_invalid",
    1_000,
    60_000,
  )
  const operationAbortJoinMilliseconds = positiveDuration(
    options?.operationAbortJoinMilliseconds,
    DEFAULT_OPERATION_ABORT_JOIN_MILLISECONDS,
    "ff029_ethereal_operation_abort_join_invalid",
    100,
    60_000,
  )
  const pollIntervalMilliseconds = positiveDuration(
    options?.pollIntervalMilliseconds,
    DEFAULT_POLL_INTERVAL_MILLISECONDS,
    "ff029_ethereal_poll_interval_invalid",
    25,
    5_000,
  )
  const pollTimeoutMilliseconds = positiveDuration(
    options?.pollTimeoutMilliseconds,
    DEFAULT_POLL_TIMEOUT_MILLISECONDS,
    "ff029_ethereal_poll_timeout_invalid",
    1_000,
    120_000,
  )
  const cleanupQuietPeriodMilliseconds = positiveDuration(
    options?.cleanupQuietPeriodMilliseconds,
    DEFAULT_CLEANUP_QUIET_PERIOD_MILLISECONDS,
    "ff029_ethereal_cleanup_quiet_period_invalid",
    options?.allowUnsafeTestCleanupQuietPeriod === true
      ? 50
      : FF029_HOSTED_ETHEREAL_CLEANUP_QUIET_PERIOD_MILLISECONDS,
    MAXIMUM_CLEANUP_QUIET_PERIOD_MILLISECONDS,
  )
  if (pollIntervalMilliseconds >= pollTimeoutMilliseconds) {
    throw fixedError("ff029_ethereal_poll_window_invalid")
  }

  const ImapFlowImplementation =
    options?.ImapFlowImplementation ?? (await import("imapflow")).ImapFlow
  const simpleParserImplementation =
    options?.simpleParserImplementation ??
    (await import("mailparser")).simpleParser
  if (
    typeof ImapFlowImplementation !== "function" ||
    typeof simpleParserImplementation !== "function"
  ) {
    throw fixedError("ff029_ethereal_dependency_invalid")
  }

  const client = new ImapFlowImplementation({
    host,
    port,
    secure,
    auth: { user, pass: password },
    logger: false,
    emitLogs: false,
    disableAutoIdle: true,
    greetingTimeout: connectTimeoutMilliseconds,
    authTimeout: connectTimeoutMilliseconds,
    connectionTimeout: connectTimeoutMilliseconds,
    socketTimeout: operationTimeoutMilliseconds,
    tls: { servername: host },
  })
  let connected = false
  let closed = false
  let uidValidity = null
  let clientCloseInvoked = false
  let unsettledOperationError = null
  const forceClose = () => {
    connected = false
    if (clientCloseInvoked) return
    clientCloseInvoked = true
    try {
      client.close()
    } catch {}
  }
  try {
    if (typeof client.on === "function") {
      client.on("error", () => {})
      client.on("close", () => {
        connected = false
      })
    }
  } catch {
    closed = true
    forceClose()
    throw fixedError("ff029_ethereal_connection_unavailable")
  }

  function requireLifecycle(lifecycle, fallbackCode) {
    const signal = lifecycle?.signal
    const deadline =
      lifecycle?.deadline ??
      lifecycle?.executionDeadline ??
      lifecycle?.cleanupDeadline
    if (
      signal !== undefined &&
      (!(signal instanceof AbortSignal) || signal.aborted)
    ) {
      throw fixedError("ff029_operation_cancelled")
    }
    if (
      deadline !== undefined &&
      (!Number.isSafeInteger(deadline) || deadline <= Date.now())
    ) {
      throw fixedError(fallbackCode)
    }
    return { deadline, signal }
  }

  async function bounded(operation, code, lifecycle) {
    const { deadline, signal } = requireLifecycle(lifecycle, code)
    const remaining =
      deadline === undefined
        ? operationTimeoutMilliseconds
        : Math.min(operationTimeoutMilliseconds, deadline - Date.now())
    if (remaining <= 0) throw fixedError(code)
    const operationPromise = Promise.resolve().then(operation)
    const settledOperation = operationPromise.then(
      (value) => Object.freeze({ status: "completed", value }),
      (error) => Object.freeze({ status: "failed", error }),
    )
    let timer
    let abort
    const interrupted = new Promise((resolvePromise) => {
      const terminate = () => {
        resolvePromise(Object.freeze({ status: "interrupted" }))
      }
      timer = setTimeout(terminate, remaining)
      if (signal) {
        abort = terminate
        signal.addEventListener("abort", abort, { once: true })
        if (signal.aborted) terminate()
      }
    })
    const first = await Promise.race([settledOperation, interrupted])
    clearTimeout(timer)
    if (signal && abort) signal.removeEventListener("abort", abort)
    if (first.status === "completed") return first.value
    if (first.status === "failed") {
      if (
        first.error instanceof Error &&
        (/^ff029_(?:ethereal|operation)_/.test(first.error.message) ||
          first.error.ff029RetainExclusiveOwnership === true)
      ) {
        throw first.error
      }
      throw fixedError(code)
    }

    closed = true
    forceClose()
    let joinTimer
    const joinTimeout = new Promise((resolvePromise) => {
      joinTimer = setTimeout(
        () => resolvePromise(Object.freeze({ status: "join_timed_out" })),
        Math.min(operationAbortJoinMilliseconds, remaining),
      )
    })
    const joined = await Promise.race([settledOperation, joinTimeout])
    clearTimeout(joinTimer)
    if (joined.status === "join_timed_out") {
      void operationPromise.catch(() => {})
      unsettledOperationError ??= exclusiveOwnershipError(
        "ff029_ethereal_operation_unsettled_after_abort",
      )
      throw unsettledOperationError
    }
    throw fixedError(code)
  }

  async function ensureConnected(lifecycle) {
    if (closed) throw fixedError("ff029_ethereal_connection_closed")
    if (connected) return
    try {
      await bounded(
        async () => {
          await client.connect()
          connected = true
          const opened = await client.mailboxOpen(mailbox)
          uidValidity = uidValidityString(opened?.uidValidity)
        },
        "ff029_ethereal_connection_unavailable",
        lifecycle,
      )
    } catch (error) {
      closed = true
      forceClose()
      throw error
    }
  }

  async function withMailbox(operation, code, lifecycle) {
    await ensureConnected(lifecycle)
    return bounded(
      async () => {
        const lock = await client.getMailboxLock(mailbox)
        try {
          return await operation()
        } finally {
          lock.release()
        }
      },
      code,
      lifecycle,
    )
  }

  async function listForEmails(trackedEmails, lifecycle) {
    const emails = normalizeTrackedEmails(trackedEmails)
    return withMailbox(
      async () => {
        const candidateUids = new Set()
        for (const email of emails) {
          const searchResult = await client.search({ to: email }, { uid: true })
          if (searchResult === false) continue
          if (
            !Array.isArray(searchResult) ||
            searchResult.length > MAXIMUM_SEARCH_RESULTS ||
            searchResult.some((uid) => !validUid(uid))
          ) {
            throw fixedError("ff029_ethereal_search_invalid")
          }
          for (const uid of searchResult) candidateUids.add(uid)
        }
        if (candidateUids.size === 0) return []
        if (candidateUids.size > MAXIMUM_SEARCH_RESULTS) {
          throw fixedError("ff029_ethereal_search_invalid")
        }
        const messages = await client.fetchAll(
          [...candidateUids],
          { uid: true, envelope: true },
          { uid: true },
        )
        if (!Array.isArray(messages)) {
          throw fixedError("ff029_ethereal_inventory_invalid")
        }
        return messages
          .map((message) => {
            if (!validUid(message?.uid)) {
              throw fixedError("ff029_ethereal_inventory_invalid")
            }
            const recipients = envelopeRecipients(message.envelope)
            return {
              id: messageIdentity(uidValidity, message.uid),
              recipients,
              uid: message.uid,
            }
          })
          .filter((message) =>
            message.recipients.some((address) => emails.has(address)),
          )
      },
      "ff029_ethereal_inventory_unavailable",
      lifecycle,
    )
  }

  async function snapshot(email, lifecycle) {
    const normalized = normalizeCanaryEmail(email)
    const messages = await listForEmails(new Set([normalized]), lifecycle)
    return new Set(messages.map((message) => message.id))
  }

  async function waitForNewMessage(email, priorIds, lifecycle) {
    const normalized = normalizeCanaryEmail(email)
    if (
      !(priorIds instanceof Set) ||
      [...priorIds].some((identity) => typeof identity !== "string")
    ) {
      throw fixedError("ff029_ethereal_prior_messages_invalid")
    }
    const startedAt = Date.now()
    while (Date.now() - startedAt < pollTimeoutMilliseconds) {
      requireLifecycle(lifecycle, "ff029_ethereal_delivery_unavailable")
      const messages = await listForEmails(new Set([normalized]), lifecycle)
      const candidate = messages
        .filter((message) => !priorIds.has(message.id))
        .sort((left, right) => right.uid - left.uid)[0]
      if (candidate) return candidate.id
      await sleep(pollIntervalMilliseconds, lifecycle?.signal)
    }
    throw fixedError("ff029_ethereal_delivery_unavailable")
  }

  /**
   * @param {string} messageId
   * @param {unknown} lifecycle
   * @param {string | undefined} expectedLinkTemplate
   * @returns {Promise<string>}
   */
  async function proofFromMessage(
    messageId,
    lifecycle,
    expectedLinkTemplate = undefined,
  ) {
    await ensureConnected(lifecycle)
    const uid = uidFromMessageIdentity(messageId, uidValidity)
    return withMailbox(
      async () => {
        const message = await client.fetchOne(
          String(uid),
          { uid: true, source: true, size: true },
          { uid: true },
        )
        if (
          message === false ||
          !validUid(message?.uid) ||
          message.uid !== uid ||
          !Buffer.isBuffer(message.source) ||
          message.source.length === 0 ||
          message.source.length > MAXIMUM_MESSAGE_BYTES ||
          (Number.isSafeInteger(message.size) &&
            message.size > MAXIMUM_MESSAGE_BYTES)
        ) {
          throw fixedError("ff029_ethereal_message_invalid")
        }
        let parsed
        try {
          parsed = await simpleParserImplementation(message.source, {
            skipHtmlToText: true,
            skipTextToHtml: true,
            maxHtmlLengthToParse: MAXIMUM_MESSAGE_BYTES,
          })
        } catch {
          throw fixedError("ff029_ethereal_message_invalid")
        }
        return proofTokenHashFromEtherealHtml(
          parsed?.html,
          expectedLinkTemplate,
        )
      },
      "ff029_ethereal_message_unavailable",
      lifecycle,
    )
  }

  async function countTrackedMessages(trackedEmails, lifecycle) {
    return (await listForEmails(trackedEmails, lifecycle)).length
  }

  async function deleteTrackedMessages(trackedEmails, lifecycle) {
    const emails = normalizeTrackedEmails(trackedEmails)
    let quietStartedAt = null
    while (true) {
      requireLifecycle(lifecycle, "ff029_ethereal_cleanup_failed")
      const messages = await listForEmails(emails, lifecycle)
      const safeUids = messages
        .filter(
          (message) =>
            message.recipients.length > 0 &&
            message.recipients.every(
              (address) => emails.has(address) && isFf029CanaryEmail(address),
            ),
        )
        .map((message) => message.uid)
      if (safeUids.length > 0) {
        await withMailbox(
          async () => {
            const deleted = await client.messageDelete(safeUids, { uid: true })
            if (deleted !== true) {
              throw fixedError("ff029_ethereal_cleanup_failed")
            }
          },
          "ff029_ethereal_cleanup_failed",
          lifecycle,
        )
      }
      if (messages.length !== safeUids.length) {
        throw fixedError("ff029_ethereal_cleanup_incomplete")
      }
      if (messages.length > 0) {
        quietStartedAt = null
      } else if (quietStartedAt === null) {
        quietStartedAt = Date.now()
      } else if (
        Date.now() - quietStartedAt >=
        cleanupQuietPeriodMilliseconds
      ) {
        return
      }
      await bounded(
        () => sleep(pollIntervalMilliseconds, lifecycle?.signal),
        "ff029_ethereal_cleanup_failed",
        lifecycle,
      )
    }
  }

  async function close(lifecycle) {
    if (closed) return
    closed = true
    try {
      if (connected) {
        await bounded(
          async () => {
            await client.logout()
            connected = false
          },
          "ff029_ethereal_disconnect_failed",
          lifecycle,
        )
      }
    } finally {
      forceClose()
    }
  }

  function assertNoUnsettledOperations() {
    if (unsettledOperationError !== null) throw unsettledOperationError
  }

  return Object.freeze({
    assertNoUnsettledOperations,
    close,
    countTrackedMessages,
    deleteTrackedMessages,
    initialize: ensureConnected,
    proofFromMessage,
    snapshot,
    waitForNewMessage,
  })
}
