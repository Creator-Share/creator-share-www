import "server-only"

import {
  ADVOCATE_INVITATION_EMAIL_INVOCATION_BUDGET_MILLISECONDS,
  advocateInvitationInvocationHeadroomMilliseconds,
  type AdvocateInvitationEmailWorkerConfig,
} from "./emailWorker"
import {
  ADVOCATE_STAGING_CANONICAL_ORIGIN,
  isAdvocateStagingEnvironmentEnabled,
} from "../host"
import {
  loadAdvocateStagingEmailRecipientPolicy,
  type AdvocateStagingEmailRecipientPolicy,
} from "@/lib/stagingOutboundEmail"

export type AdvocateInvitationEmailEnvironment = Readonly<
  Record<string, string | undefined>
>

export interface AdvocateInvitationEmailTransportConfig {
  host: string
  port: number
  secure: boolean
  username: string
  password: string
  fromAddress: string
  timeoutMilliseconds: number
  stagingRecipientPolicy?: AdvocateStagingEmailRecipientPolicy
}

function configurationError(): never {
  throw new Error("Advocate invitation email worker is unavailable")
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || value === "") return fallback
  if (!/^\d+$/.test(value)) configurationError()
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    configurationError()
  }
  return parsed
}

function requiredTrimmed(
  value: string | undefined,
  maximumLength: number,
): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximumLength ||
    value !== value.trim() ||
    /[\r\n\0]/.test(value)
  ) {
    configurationError()
  }
  return value
}

function parseFromAddress(value: string | undefined): string {
  const configured = requiredTrimmed(value, 320)
  const branded = configured.match(
    /^(?:"Creator Share"|Creator Share)\s*<([^<>\s]+)>$/,
  )
  const address = branded?.[1] ?? configured
  if (
    !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(
      address,
    ) ||
    address.length > 254 ||
    address.includes("..")
  ) {
    configurationError()
  }
  return address
}

export function loadAdvocateInvitationEmailWorkerConfig(
  environment: AdvocateInvitationEmailEnvironment = process.env,
): AdvocateInvitationEmailWorkerConfig {
  const config = {
    batchSize: boundedInteger(
      environment.ADVOCATE_INVITATION_EMAIL_BATCH_SIZE,
      2,
      1,
      20,
    ),
    concurrency: boundedInteger(
      environment.ADVOCATE_INVITATION_EMAIL_CONCURRENCY,
      2,
      1,
      4,
    ),
    retryAfterSeconds: boundedInteger(
      environment.ADVOCATE_INVITATION_EMAIL_RETRY_AFTER_SECONDS,
      300,
      1,
      86_400,
    ),
    serviceRequestTimeoutMilliseconds: boundedInteger(
      environment.ADVOCATE_INVITATION_EMAIL_SERVICE_REQUEST_TIMEOUT_MILLISECONDS,
      5_000,
      1_000,
      10_000,
    ),
    transportTimeoutMilliseconds: boundedInteger(
      environment.ADVOCATE_INVITATION_EMAIL_TRANSPORT_TIMEOUT_MILLISECONDS,
      20_000,
      1_000,
      30_000,
    ),
    invocationSafetyMarginMilliseconds: boundedInteger(
      environment.ADVOCATE_INVITATION_EMAIL_INVOCATION_SAFETY_MARGIN_MILLISECONDS,
      5_000,
      1_000,
      15_000,
    ),
  }
  if (
    config.concurrency !== config.batchSize ||
    advocateInvitationInvocationHeadroomMilliseconds(config) >=
      ADVOCATE_INVITATION_EMAIL_INVOCATION_BUDGET_MILLISECONDS
  ) {
    configurationError()
  }
  return config
}

export function loadAdvocateInvitationEmailWorkerSecret(
  environment: AdvocateInvitationEmailEnvironment = process.env,
): string {
  const dedicated = environment.ADVOCATE_INVITATION_EMAIL_WORKER_SECRET
  const selected =
    dedicated === undefined || dedicated === ""
      ? environment.CRON_SECRET
      : dedicated
  if (
    typeof selected !== "string" ||
    selected.length < 32 ||
    selected.length > 1_024 ||
    selected !== selected.trim() ||
    /[\u0000-\u001f\u007f\s]/.test(selected)
  ) {
    configurationError()
  }
  return selected
}

export function loadAdvocateInvitationEmailTransportConfig(
  environment: AdvocateInvitationEmailEnvironment = process.env,
): AdvocateInvitationEmailTransportConfig {
  const secureValue = environment.EMAIL_SECURE ?? "false"
  if (secureValue !== "true" && secureValue !== "false") {
    configurationError()
  }
  const password = environment.EMAIL_PASSWORD
  if (
    typeof password !== "string" ||
    password.length < 1 ||
    password.length > 2_048 ||
    /[\r\n\0]/.test(password)
  ) {
    configurationError()
  }
  const config = {
    host: requiredTrimmed(environment.EMAIL_HOST, 255),
    port: boundedInteger(environment.EMAIL_PORT, 587, 1, 65_535),
    secure: secureValue === "true",
    username: requiredTrimmed(environment.EMAIL_USER, 320),
    password,
    fromAddress: parseFromAddress(environment.EMAIL_FROM),
    timeoutMilliseconds: boundedInteger(
      environment.ADVOCATE_INVITATION_EMAIL_TRANSPORT_TIMEOUT_MILLISECONDS,
      20_000,
      1_000,
      30_000,
    ),
  }
  let stagingRecipientPolicy: AdvocateStagingEmailRecipientPolicy | undefined
  try {
    stagingRecipientPolicy = loadAdvocateStagingEmailRecipientPolicy({
      environment,
      host: config.host,
      port: config.port,
      secure: config.secure,
      username: config.username,
    })
  } catch {
    configurationError()
  }
  return {
    ...config,
    ...(stagingRecipientPolicy === undefined ? {} : { stagingRecipientPolicy }),
  }
}

export function loadAdvocateInvitationEmailCanonicalOrigin(
  environment: AdvocateInvitationEmailEnvironment = process.env,
): "https://creatorshare.com" | typeof ADVOCATE_STAGING_CANONICAL_ORIGIN {
  const stagingEnabled = isAdvocateStagingEnvironmentEnabled(environment)
  const configured = environment.ADVOCATE_INVITATION_CANONICAL_ORIGIN
  if (stagingEnabled && configured === undefined) configurationError()
  const value = configured ?? "https://creatorshare.com"
  if (
    value !== "https://creatorshare.com" &&
    (value !== ADVOCATE_STAGING_CANONICAL_ORIGIN || !stagingEnabled)
  ) {
    configurationError()
  }
  if (stagingEnabled && value !== ADVOCATE_STAGING_CANONICAL_ORIGIN) {
    configurationError()
  }
  return value
}
