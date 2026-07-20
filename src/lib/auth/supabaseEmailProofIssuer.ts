import "server-only"

import { randomBytes, randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  createEmailProofIssuanceGateRepository,
  EMAIL_PROOF_RECIPIENT_HMAC_KEY_VERSION,
  EMAIL_PROOF_RECIPIENT_NORMALIZATION_VERSION,
  EmailProofIssuanceGateError,
  type EmailProofIssuanceContext,
  type EmailProofIssuanceFlow,
  type EmailProofIssuanceGateInput,
  type EmailProofIssuanceGateRepository,
} from "@/lib/auth/emailProofIssuanceGate"
import { getSponsorClaimCanonicalOrigin } from "@/lib/sponsorships/accountClaim"
import {
  createSponsorshipCryptoFromEnvironment,
  normalizeSponsorEmailV1,
  toSupabaseRpcBytea,
  type SupabaseRpcBytea,
  type VersionedEmailDigest,
} from "@/lib/sponsorships/crypto"
import { createStatelessSponsorEmailAuthClient } from "@/lib/sponsorships/management/statelessAuth"
import { validatePassword } from "@/utils/passwordValidation"
import { createServiceRoleClient } from "@/utils/supabase/server"

export type EmailProofIssuerContext = EmailProofIssuanceContext

export const EMAIL_PROOF_AMBIGUOUS_RETRY_AFTER_SECONDS = 3900 as const

export type EmailProofIssuanceNonIssuedResult =
  | Readonly<{
      status: "coalesced" | "deferred"
      retryAfterSeconds: number
    }>
  | Readonly<{
      status: "ambiguous"
      retryAfterSeconds: typeof EMAIL_PROOF_AMBIGUOUS_RETRY_AFTER_SECONDS
    }>
  | Readonly<{
      status: "unavailable"
      stage: "configuration" | "acquire"
    }>
  | Readonly<{
      status: "unavailable"
      stage: "begin"
      retryAfterSeconds: typeof EMAIL_PROOF_AMBIGUOUS_RETRY_AFTER_SECONDS
    }>

export type BasicEmailProofIssuanceResult =
  Readonly<{ status: "issued" }> | EmailProofIssuanceNonIssuedResult

export type CreatorShareAdminInvitationEmailProofResult =
  | Readonly<{ status: "issued"; userId: string }>
  | EmailProofIssuanceNonIssuedResult

export type AdvocateInvitationEmailProofResult =
  | Readonly<{
      status: "issued"
      proof: Readonly<{
        userId: string
        hashedToken: string
        authType: "magiclink" | "signup"
      }>
    }>
  | EmailProofIssuanceNonIssuedResult

export interface BasicEmailLinkProofOptions {
  recipientEmail: string
  redirectTo: string
  context: EmailProofIssuerContext
}

export interface RegistrationEmailProofOptions extends BasicEmailLinkProofOptions {
  password: string
  firstName: string
  lastName: string
}

export interface PasswordResetEmailProofOptions {
  recipientEmail: string
  context: EmailProofIssuerContext
}

export interface CreatorShareAdminInvitationEmailProofOptions extends BasicEmailLinkProofOptions {
  invitedByUserId: string
}

export interface AdvocateInvitationEmailProofOptions extends BasicEmailLinkProofOptions {
  outboxId: string
}

export class EmailProofIssuanceInputError extends Error {
  constructor() {
    super("email_proof_issuance_input_invalid")
    this.name = "EmailProofIssuanceInputError"
  }
}

type InternalIssuedResult<T> = Readonly<{ status: "issued"; value: T }>
type InternalExecutionResult<T> =
  InternalIssuedResult<T> | EmailProofIssuanceNonIssuedResult

type ProviderCall<T> = Readonly<{
  invoke(): Promise<unknown>
  parse(response: unknown): T
}>

type ProviderCallBuilder<T> = (serviceClient: SupabaseClient) => ProviderCall<T>

interface PreparedExecution {
  recipient: VersionedEmailDigest
  context: EmailProofIssuerContext
  serviceClient: SupabaseClient
  repository: EmailProofIssuanceGateRepository
}

const PROVIDER_TRANSPORT_TIMEOUT_MILLISECONDS = 8_000
const PROVIDER_RESPONSE_TIMEOUT_MILLISECONDS = 10_000
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ZERO_UUID = "00000000-0000-0000-0000-000000000000"
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/
const HASHED_TOKEN_PATTERN = /^[A-Za-z0-9._~-]{32,384}$/
const MESSAGE_ID_PATTERN = /^[^\u0000-\u001f\u007f-\u009f]{1,1024}$/
const AUTH_RESPONSE_KEYS = new Set(["data", "error"])
const OTP_DATA_REQUIRED_KEYS = new Set(["user", "session"])
const GENERATED_LINK_PROPERTY_KEYS = new Set([
  "action_link",
  "email_otp",
  "hashed_token",
  "redirect_to",
  "verification_type",
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function inputError(): never {
  throw new EmailProofIssuanceInputError()
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: ReadonlySet<string>,
): boolean {
  const keys = Object.keys(value)
  return keys.length === expected.size && keys.every((key) => expected.has(key))
}

function assertExactKeys(
  value: unknown,
  expected: ReadonlySet<string>,
): asserts value is Record<string, unknown> {
  if (!isRecord(value) || !hasExactKeys(value, expected)) inputError()
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    UUID_PATTERN.test(value) &&
    value.toLowerCase() !== ZERO_UUID
  )
}

function normalizeRecipientEmail(value: unknown): string {
  if (typeof value !== "string") inputError()
  try {
    return normalizeSponsorEmailV1(value)
  } catch {
    inputError()
  }
}

function assertContext(
  value: unknown,
): asserts value is EmailProofIssuerContext {
  assertExactKeys(value, new Set(["requestId", "traceId"]))
  const traceId = value.traceId
  if (
    !isUuid(value.requestId) ||
    (traceId !== null &&
      (typeof traceId !== "string" ||
        traceId !== traceId.trim() ||
        Buffer.byteLength(traceId, "utf8") < 1 ||
        Buffer.byteLength(traceId, "utf8") > 255 ||
        CONTROL_CHARACTER_PATTERN.test(traceId)))
  ) {
    inputError()
  }
}

function assertName(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 100 ||
    value !== value.trim().replace(/\s+/g, " ") ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    inputError()
  }
}

function assertPassword(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length > 256 ||
    !validatePassword(value).isValid
  ) {
    inputError()
  }
}

function assertCanonicalRedirect(options: {
  value: unknown
  canonicalOrigin: string
  pathname: string
  nextPath?: string
}): string {
  if (typeof options.value !== "string") inputError()

  let redirect: URL
  try {
    redirect = new URL(options.value)
  } catch {
    inputError()
  }

  const expectedSearch =
    options.nextPath === undefined
      ? ""
      : new URLSearchParams({ next: options.nextPath }).toString()
  if (
    redirect.origin !== options.canonicalOrigin ||
    redirect.pathname !== options.pathname ||
    redirect.search.slice(1) !== expectedSearch ||
    redirect.hash !== "" ||
    redirect.username !== "" ||
    redirect.password !== "" ||
    redirect.toString() !== options.value
  ) {
    inputError()
  }

  return options.value
}

function assertSupabaseConfiguration(options: {
  needsAnonymousProvider: boolean
  environment: Readonly<Record<string, string | undefined>>
}): void {
  const rawUrl = options.environment.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = options.environment.NEXT_SERVICE_ROLE_KEY
  const anonymousKey = options.environment.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (
    typeof rawUrl !== "string" ||
    rawUrl.length < 12 ||
    rawUrl.length > 2048 ||
    typeof serviceRoleKey !== "string" ||
    serviceRoleKey.length < 32 ||
    serviceRoleKey.length > 8192 ||
    serviceRoleKey !== serviceRoleKey.trim() ||
    CONTROL_CHARACTER_PATTERN.test(serviceRoleKey) ||
    (options.needsAnonymousProvider &&
      (typeof anonymousKey !== "string" ||
        anonymousKey.length < 32 ||
        anonymousKey.length > 8192 ||
        anonymousKey !== anonymousKey.trim() ||
        CONTROL_CHARACTER_PATTERN.test(anonymousKey) ||
        anonymousKey === serviceRoleKey))
  ) {
    throw new Error("email_proof_issuer_configuration_unavailable")
  }

  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error("email_proof_issuer_configuration_unavailable")
  }
  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]"
  if (
    (url.protocol !== "https:" &&
      !(
        options.environment.NODE_ENV !== "production" &&
        loopback &&
        url.protocol === "http:"
      )) ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("email_proof_issuer_configuration_unavailable")
  }
}

function unavailable(
  stage: "configuration" | "acquire" | "begin",
): EmailProofIssuanceNonIssuedResult {
  return stage === "begin"
    ? Object.freeze({
        status: "unavailable",
        stage,
        retryAfterSeconds: EMAIL_PROOF_AMBIGUOUS_RETRY_AFTER_SECONDS,
      })
    : Object.freeze({ status: "unavailable", stage })
}

function prepareExecution(options: {
  normalizedEmail: string
  context: EmailProofIssuerContext
  needsAnonymousProvider: boolean
}): PreparedExecution | EmailProofIssuanceNonIssuedResult {
  try {
    assertSupabaseConfiguration({
      needsAnonymousProvider: options.needsAnonymousProvider,
      environment: process.env,
    })
    const recipient = createSponsorshipCryptoFromEnvironment().digestEmail(
      options.normalizedEmail,
    )
    if (
      recipient.normalizedEmail !== options.normalizedEmail ||
      recipient.normalizationVersion !==
        EMAIL_PROOF_RECIPIENT_NORMALIZATION_VERSION ||
      recipient.hmacKeyVersion !== EMAIL_PROOF_RECIPIENT_HMAC_KEY_VERSION
    ) {
      throw new Error("email_proof_issuer_configuration_unavailable")
    }

    const serviceClient = createServiceRoleClient({
      requestTimeoutMilliseconds: PROVIDER_TRANSPORT_TIMEOUT_MILLISECONDS,
    })
    return Object.freeze({
      recipient,
      context: Object.freeze({ ...options.context }),
      serviceClient,
      repository: createEmailProofIssuanceGateRepository(serviceClient),
    })
  } catch {
    return unavailable("configuration")
  }
}

function createGateInput(
  prepared: PreparedExecution,
  operationIdOverride?: string,
): EmailProofIssuanceGateInput | null {
  let operationId: string
  let leaseBytes: Buffer
  try {
    operationId = operationIdOverride ?? randomUUID()
    leaseBytes = randomBytes(32)
  } catch {
    return null
  }
  if (!isUuid(operationId) || leaseBytes.byteLength !== 32) {
    leaseBytes.fill(0)
    return null
  }

  let leaseToken: SupabaseRpcBytea
  try {
    leaseToken = toSupabaseRpcBytea(leaseBytes)
  } catch {
    return null
  } finally {
    leaseBytes.fill(0)
  }

  return Object.freeze({
    recipientDigest: prepared.recipient.digestRpcBytea,
    recipientNormalizationVersion: EMAIL_PROOF_RECIPIENT_NORMALIZATION_VERSION,
    recipientHmacKeyVersion: EMAIL_PROOF_RECIPIENT_HMAC_KEY_VERSION,
    flow: "generic-sign-in",
    operationId: operationId.toLowerCase(),
    leaseToken,
    context: prepared.context,
  })
}

async function acquireGate(
  repository: EmailProofIssuanceGateRepository,
  input: EmailProofIssuanceGateInput,
) {
  try {
    return await repository.acquire(input)
  } catch (error) {
    if (
      !(error instanceof EmailProofIssuanceGateError) ||
      error.stage !== "acquire" ||
      !error.transportFailure
    ) {
      throw error
    }
  }

  return repository.acquire(input)
}

async function abandonBestEffort(
  repository: EmailProofIssuanceGateRepository,
  input: EmailProofIssuanceGateInput,
): Promise<void> {
  try {
    await repository.abandon(input)
  } catch {
    // A failed abandon never permits provider issuance from this operation.
  }
}

async function callProviderWithDeadline<T>(call: ProviderCall<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error("email_proof_provider_response_ambiguous")
      error.name = "TimeoutError"
      reject(error)
    }, PROVIDER_RESPONSE_TIMEOUT_MILLISECONDS)
  })

  try {
    const response = await Promise.race([
      Promise.resolve().then(() => call.invoke()),
      timeout,
    ])
    return call.parse(response)
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

async function executeIssuance<T>(options: {
  prepared: PreparedExecution
  flow: EmailProofIssuanceFlow
  operationIdOverride?: string
  buildProviderCall: ProviderCallBuilder<T>
}): Promise<InternalExecutionResult<T>> {
  const input = createGateInput(options.prepared, options.operationIdOverride)
  if (input === null) return unavailable("configuration")
  const flowInput = Object.freeze({ ...input, flow: options.flow })

  let acquisition
  try {
    acquisition = await acquireGate(options.prepared.repository, flowInput)
  } catch {
    return unavailable("acquire")
  }

  if (acquisition.status !== "acquired") {
    return Object.freeze({
      status: acquisition.status,
      retryAfterSeconds: acquisition.retryAfterSeconds,
    })
  }

  let providerCall: ProviderCall<T>
  try {
    providerCall = options.buildProviderCall(options.prepared.serviceClient)
    if (
      !providerCall ||
      typeof providerCall.invoke !== "function" ||
      typeof providerCall.parse !== "function"
    ) {
      throw new Error("email_proof_issuer_configuration_unavailable")
    }
  } catch {
    await abandonBestEffort(options.prepared.repository, flowInput)
    return unavailable("configuration")
  }

  try {
    await options.prepared.repository.begin(flowInput)
  } catch {
    return unavailable("begin")
  }

  let disposition: "issued" | "ambiguous" = "ambiguous"
  let value: T | undefined
  try {
    value = await callProviderWithDeadline(providerCall)
    disposition = "issued"
  } catch {
    disposition = "ambiguous"
  }

  try {
    await options.prepared.repository.finish(flowInput, disposition)
  } catch {
    // The existing database fence remains authoritative after a lost finish.
  }

  return disposition === "issued"
    ? Object.freeze({ status: "issued", value: value as T })
    : Object.freeze({
        status: "ambiguous",
        retryAfterSeconds: EMAIL_PROOF_AMBIGUOUS_RETRY_AFTER_SECONDS,
      })
}

function parseAuthResponse(value: unknown): Record<string, unknown> {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, AUTH_RESPONSE_KEYS) ||
    value.error !== null ||
    !isRecord(value.data)
  ) {
    throw new Error("email_proof_provider_response_ambiguous")
  }
  return value.data
}

function parseOtpResponse(value: unknown): void {
  const data = parseAuthResponse(value)
  const keys = Object.keys(data)
  if (
    keys.length < OTP_DATA_REQUIRED_KEYS.size ||
    keys.length > OTP_DATA_REQUIRED_KEYS.size + 1 ||
    keys.some(
      (key) => key !== "messageId" && !OTP_DATA_REQUIRED_KEYS.has(key),
    ) ||
    data.user !== null ||
    data.session !== null ||
    ("messageId" in data &&
      data.messageId !== null &&
      (typeof data.messageId !== "string" ||
        !MESSAGE_ID_PATTERN.test(data.messageId)))
  ) {
    throw new Error("email_proof_provider_response_ambiguous")
  }
}

function parseReturnedUser(
  value: unknown,
  expectedEmail: string,
): { userId: string } {
  if (!isRecord(value) || !isUuid(value.id)) {
    throw new Error("email_proof_provider_response_ambiguous")
  }

  let returnedEmail: string
  try {
    returnedEmail = normalizeSponsorEmailV1(value.email as string)
  } catch {
    throw new Error("email_proof_provider_response_ambiguous")
  }
  if (returnedEmail !== expectedEmail || value.email !== expectedEmail) {
    throw new Error("email_proof_provider_response_ambiguous")
  }
  return { userId: value.id.toLowerCase() }
}

function parseSignUpResponse(value: unknown, expectedEmail: string): void {
  const data = parseAuthResponse(value)
  if (
    !hasExactKeys(data, new Set(["user", "session"])) ||
    data.session !== null
  ) {
    throw new Error("email_proof_provider_response_ambiguous")
  }
  parseReturnedUser(data.user, expectedEmail)
}

function parsePasswordResetResponse(value: unknown): void {
  const data = parseAuthResponse(value)
  if (Object.keys(data).length !== 0) {
    throw new Error("email_proof_provider_response_ambiguous")
  }
}

function parseAdminInvitationResponse(
  value: unknown,
  expectedEmail: string,
): { userId: string } {
  const data = parseAuthResponse(value)
  if (!hasExactKeys(data, new Set(["user"]))) {
    throw new Error("email_proof_provider_response_ambiguous")
  }
  return parseReturnedUser(data.user, expectedEmail)
}

function parseAdvocateInvitationResponse(
  value: unknown,
  expectedEmail: string,
  expectedRedirect: string,
): {
  userId: string
  hashedToken: string
  authType: "magiclink" | "signup"
} {
  const data = parseAuthResponse(value)
  if (!hasExactKeys(data, new Set(["properties", "user"]))) {
    throw new Error("email_proof_provider_response_ambiguous")
  }
  const user = parseReturnedUser(data.user, expectedEmail)
  const properties = data.properties
  if (
    !isRecord(properties) ||
    !hasExactKeys(properties, GENERATED_LINK_PROPERTY_KEYS) ||
    typeof properties.action_link !== "string" ||
    properties.action_link.length < 1 ||
    properties.action_link.length > 8192 ||
    typeof properties.email_otp !== "string" ||
    properties.email_otp.length < 1 ||
    properties.email_otp.length > 64 ||
    typeof properties.hashed_token !== "string" ||
    !HASHED_TOKEN_PATTERN.test(properties.hashed_token) ||
    properties.redirect_to !== expectedRedirect ||
    (properties.verification_type !== "magiclink" &&
      properties.verification_type !== "signup")
  ) {
    throw new Error("email_proof_provider_response_ambiguous")
  }

  return Object.freeze({
    userId: user.userId,
    hashedToken: properties.hashed_token,
    authType: properties.verification_type,
  })
}

function createOtpProviderCall(options: {
  recipientEmail: string
  redirectTo: string
  shouldCreateUser: boolean
}): ProviderCall<void> {
  const client = createStatelessSponsorEmailAuthClient({
    requestTimeoutMilliseconds: PROVIDER_TRANSPORT_TIMEOUT_MILLISECONDS,
  })
  if (typeof client.auth?.signInWithOtp !== "function") {
    throw new Error("email_proof_issuer_configuration_unavailable")
  }
  return Object.freeze({
    invoke: () =>
      client.auth.signInWithOtp({
        email: options.recipientEmail,
        options: {
          emailRedirectTo: options.redirectTo,
          shouldCreateUser: options.shouldCreateUser,
        },
      }),
    parse: parseOtpResponse,
  })
}

async function issueOtpFlow(options: {
  source: BasicEmailLinkProofOptions
  flow:
    "generic-sign-in" | "reauthentication" | "initial-claim" | "account-claim"
  nextPath: "/app" | "/sponsor/claim"
  shouldCreateUser: boolean
}): Promise<BasicEmailProofIssuanceResult> {
  assertExactKeys(
    options.source,
    new Set(["recipientEmail", "redirectTo", "context"]),
  )
  const recipientEmail = normalizeRecipientEmail(options.source.recipientEmail)
  assertContext(options.source.context)

  let canonicalOrigin: string
  try {
    canonicalOrigin = getSponsorClaimCanonicalOrigin()
  } catch {
    return unavailable("configuration")
  }
  const redirectTo = assertCanonicalRedirect({
    value: options.source.redirectTo,
    canonicalOrigin,
    pathname: "/auth/confirm",
    nextPath: options.nextPath,
  })
  const prepared = prepareExecution({
    normalizedEmail: recipientEmail,
    context: options.source.context,
    needsAnonymousProvider: true,
  })
  if (!("recipient" in prepared)) return prepared

  const result = await executeIssuance({
    prepared,
    flow: options.flow,
    buildProviderCall: () =>
      createOtpProviderCall({
        recipientEmail,
        redirectTo,
        shouldCreateUser: options.shouldCreateUser,
      }),
  })
  return result.status === "issued"
    ? Object.freeze({ status: "issued" })
    : result
}

export async function issueGenericSignInEmailProof(
  options: BasicEmailLinkProofOptions,
): Promise<BasicEmailProofIssuanceResult> {
  return issueOtpFlow({
    source: options,
    flow: "generic-sign-in",
    nextPath: "/app",
    shouldCreateUser: false,
  })
}

export async function issueReauthenticationEmailProof(
  options: BasicEmailLinkProofOptions,
): Promise<BasicEmailProofIssuanceResult> {
  return issueOtpFlow({
    source: options,
    flow: "reauthentication",
    nextPath: "/app",
    shouldCreateUser: false,
  })
}

export async function issueInitialClaimEmailProof(
  options: BasicEmailLinkProofOptions,
): Promise<BasicEmailProofIssuanceResult> {
  return issueOtpFlow({
    source: options,
    flow: "initial-claim",
    nextPath: "/sponsor/claim",
    shouldCreateUser: true,
  })
}

export async function issueAccountClaimEmailProof(
  options: BasicEmailLinkProofOptions,
): Promise<BasicEmailProofIssuanceResult> {
  return issueOtpFlow({
    source: options,
    flow: "account-claim",
    nextPath: "/sponsor/claim",
    shouldCreateUser: false,
  })
}

export async function issueRegistrationEmailProof(
  options: RegistrationEmailProofOptions,
): Promise<BasicEmailProofIssuanceResult> {
  assertExactKeys(
    options,
    new Set([
      "recipientEmail",
      "redirectTo",
      "context",
      "password",
      "firstName",
      "lastName",
    ]),
  )
  const recipientEmail = normalizeRecipientEmail(options.recipientEmail)
  assertContext(options.context)
  assertPassword(options.password)
  assertName(options.firstName)
  assertName(options.lastName)

  let canonicalOrigin: string
  try {
    canonicalOrigin = getSponsorClaimCanonicalOrigin()
  } catch {
    return unavailable("configuration")
  }
  const redirectTo = assertCanonicalRedirect({
    value: options.redirectTo,
    canonicalOrigin,
    pathname: "/auth/confirm",
    nextPath: "/app/main/onboarding",
  })
  const prepared = prepareExecution({
    normalizedEmail: recipientEmail,
    context: options.context,
    needsAnonymousProvider: true,
  })
  if (!("recipient" in prepared)) return prepared

  const result = await executeIssuance({
    prepared,
    flow: "registration",
    buildProviderCall: () => {
      const client = createStatelessSponsorEmailAuthClient({
        requestTimeoutMilliseconds: PROVIDER_TRANSPORT_TIMEOUT_MILLISECONDS,
      })
      if (typeof client.auth?.signUp !== "function") {
        throw new Error("email_proof_issuer_configuration_unavailable")
      }
      return Object.freeze({
        invoke: () =>
          client.auth.signUp({
            email: recipientEmail,
            password: options.password,
            options: {
              data: {
                first_name: options.firstName,
                last_name: options.lastName,
              },
              emailRedirectTo: redirectTo,
            },
          }),
        parse: (response: unknown) =>
          parseSignUpResponse(response, recipientEmail),
      })
    },
  })
  return result.status === "issued"
    ? Object.freeze({ status: "issued" })
    : result
}

export async function issuePasswordResetEmailProof(
  options: PasswordResetEmailProofOptions,
): Promise<BasicEmailProofIssuanceResult> {
  assertExactKeys(options, new Set(["recipientEmail", "context"]))
  const recipientEmail = normalizeRecipientEmail(options.recipientEmail)
  assertContext(options.context)
  const prepared = prepareExecution({
    normalizedEmail: recipientEmail,
    context: options.context,
    needsAnonymousProvider: true,
  })
  if (!("recipient" in prepared)) return prepared

  const result = await executeIssuance({
    prepared,
    flow: "password-reset",
    buildProviderCall: () => {
      const client = createStatelessSponsorEmailAuthClient({
        requestTimeoutMilliseconds: PROVIDER_TRANSPORT_TIMEOUT_MILLISECONDS,
      })
      if (typeof client.auth?.resetPasswordForEmail !== "function") {
        throw new Error("email_proof_issuer_configuration_unavailable")
      }
      return Object.freeze({
        invoke: () => client.auth.resetPasswordForEmail(recipientEmail),
        parse: parsePasswordResetResponse,
      })
    },
  })
  return result.status === "issued"
    ? Object.freeze({ status: "issued" })
    : result
}

export async function issueCreatorShareAdminInvitationEmailProof(
  options: CreatorShareAdminInvitationEmailProofOptions,
): Promise<CreatorShareAdminInvitationEmailProofResult> {
  assertExactKeys(
    options,
    new Set(["recipientEmail", "redirectTo", "context", "invitedByUserId"]),
  )
  const recipientEmail = normalizeRecipientEmail(options.recipientEmail)
  assertContext(options.context)
  if (!isUuid(options.invitedByUserId)) inputError()

  let canonicalOrigin: string
  try {
    canonicalOrigin = getSponsorClaimCanonicalOrigin()
  } catch {
    return unavailable("configuration")
  }
  const redirectTo = assertCanonicalRedirect({
    value: options.redirectTo,
    canonicalOrigin,
    pathname: "/set-password",
  })
  const prepared = prepareExecution({
    normalizedEmail: recipientEmail,
    context: options.context,
    needsAnonymousProvider: false,
  })
  if (!("recipient" in prepared)) return prepared

  const result = await executeIssuance({
    prepared,
    flow: "creator-share-admin-invitation",
    buildProviderCall: (serviceClient) => {
      if (typeof serviceClient.auth?.admin?.inviteUserByEmail !== "function") {
        throw new Error("email_proof_issuer_configuration_unavailable")
      }
      return Object.freeze({
        invoke: () =>
          serviceClient.auth.admin.inviteUserByEmail(recipientEmail, {
            data: { invited_by: options.invitedByUserId.toLowerCase() },
            redirectTo,
          }),
        parse: (response: unknown) =>
          parseAdminInvitationResponse(response, recipientEmail),
      })
    },
  })
  return result.status === "issued"
    ? Object.freeze({ status: "issued", userId: result.value.userId })
    : result
}

export async function issueAdvocateInvitationEmailProof(
  options: AdvocateInvitationEmailProofOptions,
): Promise<AdvocateInvitationEmailProofResult> {
  assertExactKeys(
    options,
    new Set(["recipientEmail", "redirectTo", "context", "outboxId"]),
  )
  const recipientEmail = normalizeRecipientEmail(options.recipientEmail)
  assertContext(options.context)
  if (!isUuid(options.outboxId)) inputError()

  let canonicalOrigin: string
  try {
    canonicalOrigin = getSponsorClaimCanonicalOrigin()
  } catch {
    return unavailable("configuration")
  }
  const redirectTo = assertCanonicalRedirect({
    value: options.redirectTo,
    canonicalOrigin,
    pathname: "/advocate-invitation",
  })
  const prepared = prepareExecution({
    normalizedEmail: recipientEmail,
    context: options.context,
    needsAnonymousProvider: false,
  })
  if (!("recipient" in prepared)) return prepared

  const result = await executeIssuance({
    prepared,
    flow: "advocate-invitation",
    operationIdOverride: options.outboxId,
    buildProviderCall: (serviceClient) => {
      if (typeof serviceClient.auth?.admin?.generateLink !== "function") {
        throw new Error("email_proof_issuer_configuration_unavailable")
      }
      return Object.freeze({
        invoke: () =>
          serviceClient.auth.admin.generateLink({
            type: "magiclink",
            email: recipientEmail,
            options: { redirectTo },
          }),
        parse: (response: unknown) =>
          parseAdvocateInvitationResponse(response, recipientEmail, redirectTo),
      })
    },
  })
  return result.status === "issued"
    ? Object.freeze({ status: "issued", proof: result.value })
    : result
}
