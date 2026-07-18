import "server-only"

import { getSponsorClaimCanonicalOrigin } from "@/lib/sponsorships/accountClaim"
import type { SponsorWelcomeEmailWorkerConfig } from "@/lib/sponsorships/email/sponsorWelcomeEmailWorker"

export type SponsorWelcomeEmailEnvironment = Readonly<
  Record<string, string | undefined>
>

export interface SponsorWelcomeEmailTransportConfig {
  host: string
  port: number
  secure: boolean
  username: string
  password: string
  fromAddress: string
  timeoutMilliseconds: number
}

function configurationError(): never {
  throw new Error("Sponsor welcome email configuration is unavailable")
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

export function loadSponsorWelcomeEmailWorkerConfig(
  environment: SponsorWelcomeEmailEnvironment = process.env,
): SponsorWelcomeEmailWorkerConfig {
  const config = {
    batchSize: boundedInteger(
      environment.SPONSOR_WELCOME_EMAIL_BATCH_SIZE,
      4,
      1,
      100,
    ),
    concurrency: boundedInteger(
      environment.SPONSOR_WELCOME_EMAIL_CONCURRENCY,
      4,
      1,
      10,
    ),
    retryAfterSeconds: boundedInteger(
      environment.SPONSOR_WELCOME_EMAIL_RETRY_AFTER_SECONDS,
      300,
      1,
      86_400,
    ),
    transportTimeoutMilliseconds: boundedInteger(
      environment.SPONSOR_WELCOME_EMAIL_TRANSPORT_TIMEOUT_MILLISECONDS,
      20_000,
      1_000,
      45_000,
    ),
    invocationSafetyMarginMilliseconds: boundedInteger(
      environment.SPONSOR_WELCOME_EMAIL_INVOCATION_SAFETY_MARGIN_MILLISECONDS,
      5_000,
      1_000,
      15_000,
    ),
  }
  if (
    config.batchSize > config.concurrency ||
    config.transportTimeoutMilliseconds +
      config.invocationSafetyMarginMilliseconds >
      55_000
  ) {
    configurationError()
  }
  return config
}

export function loadSponsorWelcomeEmailWorkerSecret(
  environment: SponsorWelcomeEmailEnvironment = process.env,
): string {
  const dedicatedSecret = environment.SPONSOR_WELCOME_EMAIL_WORKER_SECRET
  const secret =
    dedicatedSecret === undefined || dedicatedSecret === ""
      ? environment.CRON_SECRET
      : dedicatedSecret
  if (
    typeof secret !== "string" ||
    secret.length < 32 ||
    secret.length > 1024 ||
    secret !== secret.trim()
  ) {
    configurationError()
  }
  return secret
}

export function loadSponsorWelcomeEmailTransportConfig(
  environment: SponsorWelcomeEmailEnvironment = process.env,
): SponsorWelcomeEmailTransportConfig {
  const secureValue = environment.EMAIL_SECURE ?? "false"
  if (secureValue !== "true" && secureValue !== "false") {
    configurationError()
  }

  const password = environment.EMAIL_PASSWORD
  if (
    typeof password !== "string" ||
    password.length < 1 ||
    password.length > 2048 ||
    /[\r\n\0]/.test(password)
  ) {
    configurationError()
  }

  return {
    host: requiredTrimmed(environment.EMAIL_HOST, 255),
    port: boundedInteger(environment.EMAIL_PORT, 587, 1, 65_535),
    secure: secureValue === "true",
    username: requiredTrimmed(environment.EMAIL_USER, 320),
    password,
    fromAddress: parseFromAddress(environment.EMAIL_FROM),
    timeoutMilliseconds: boundedInteger(
      environment.SPONSOR_WELCOME_EMAIL_TRANSPORT_TIMEOUT_MILLISECONDS,
      20_000,
      1_000,
      45_000,
    ),
  }
}

export function loadSponsorWelcomeEmailCanonicalOrigin(
  environment: SponsorWelcomeEmailEnvironment = process.env,
): string {
  return getSponsorClaimCanonicalOrigin(environment)
}
