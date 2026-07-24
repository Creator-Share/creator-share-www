import { ADVOCATE_STAGING_CANONICAL_ORIGIN, resolveAdvocateHost } from "./host"
import {
  ADVOCATE_EXPOSURE_BROKER_PATH,
  ADVOCATE_EXPOSURE_BROKER_VERSION,
  ADVOCATE_EXPOSURE_BROKER_VERSION_HEADER,
  ADVOCATE_EXPOSURE_CONTENT_TYPE,
  ADVOCATE_EXPOSURE_MAXIMUM_BODY_BYTES,
  isValidAdvocateExposurePagePath,
} from "./exposureBrokerProtocol"

const PRODUCTION_EXPOSURE_BROKER_ORIGIN = "https://creatorshare.com"
const RETRY_DELAYS_MILLISECONDS = Object.freeze([0, 300, 1_200] as const)
const ATTEMPT_TIMEOUT_MILLISECONDS = 8_000
const TRANSIENT_RESPONSE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])

type ExposureFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

type Wait = (milliseconds: number) => Promise<void>

export interface AdvocateExposureBrokerClientOptions {
  allowStagingEnvironment?: boolean
  fetchImplementation?: ExposureFetch
  nodeEnvironment?: string
  retryDelaysMilliseconds?: readonly number[]
  wait?: Wait
}

function defaultWait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

/**
 * Each hosted environment has one fixed collector origin. Staging requires an
 * explicit exact deployment flag. Local development derives only the validated
 * numeric port from a one-label tenant.localhost host. No request value or
 * arbitrary configured URL can replace either canonical collector origin.
 */
export function resolveAdvocateExposureBrokerUrl(
  rawPageHost: string,
  nodeEnvironment: string | undefined = process.env.NODE_ENV,
  allowStagingEnvironment = false,
): string | null {
  const host = resolveAdvocateHost(rawPageHost, {
    allowLocalhostDevelopment: nodeEnvironment === "development",
    allowStagingEnvironment,
  })
  if (host.kind !== "tenant-candidate") return null

  if (nodeEnvironment === "production") {
    if (host.environment === "staging" && allowStagingEnvironment) {
      return `${ADVOCATE_STAGING_CANONICAL_ORIGIN}${ADVOCATE_EXPOSURE_BROKER_PATH}`
    }
    if (host.environment !== "production") return null
    return `${PRODUCTION_EXPOSURE_BROKER_ORIGIN}${ADVOCATE_EXPOSURE_BROKER_PATH}`
  }

  if (
    nodeEnvironment !== "development" ||
    host.environment !== "local-development"
  ) {
    return null
  }

  const port = host.requestPort === null ? "" : `:${host.requestPort}`
  return `http://localhost${port}${ADVOCATE_EXPOSURE_BROKER_PATH}`
}

function hasValidRetryDelays(values: readonly number[]): boolean {
  return (
    values.length >= 1 &&
    values.length <= 4 &&
    values[0] === 0 &&
    values.every(
      (value) => Number.isSafeInteger(value) && value >= 0 && value <= 10_000,
    )
  )
}

export async function recordAdvocateExposureThroughBroker(
  input: {
    pageHost: string
    pagePath: string
  },
  options: AdvocateExposureBrokerClientOptions = {},
): Promise<boolean> {
  if (!isValidAdvocateExposurePagePath(input.pagePath)) return false

  const endpoint = resolveAdvocateExposureBrokerUrl(
    input.pageHost,
    options.nodeEnvironment,
    options.allowStagingEnvironment === true,
  )
  if (endpoint === null) return false

  const body = JSON.stringify({ pagePath: input.pagePath })
  if (
    new TextEncoder().encode(body).length > ADVOCATE_EXPOSURE_MAXIMUM_BODY_BYTES
  ) {
    return false
  }

  const retryDelays =
    options.retryDelaysMilliseconds ?? RETRY_DELAYS_MILLISECONDS
  if (!hasValidRetryDelays(retryDelays)) return false
  const fetchImplementation = options.fetchImplementation ?? window.fetch
  const wait = options.wait ?? defaultWait

  for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
    const delay = retryDelays[attempt]
    if (delay > 0) await wait(delay)

    try {
      const response = await fetchImplementation(endpoint, {
        body,
        cache: "no-store",
        credentials: "include",
        headers: {
          "Content-Type": ADVOCATE_EXPOSURE_CONTENT_TYPE,
          [ADVOCATE_EXPOSURE_BROKER_VERSION_HEADER]:
            ADVOCATE_EXPOSURE_BROKER_VERSION,
        },
        keepalive: true,
        method: "POST",
        mode: "cors",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MILLISECONDS),
      })
      if (response.status === 204) return true
      if (!TRANSIENT_RESPONSE_STATUSES.has(response.status)) return false
    } catch {
      // A rejected CORS request and a transient network failure are
      // intentionally indistinguishable. Both receive the same small retry
      // budget and never mark the page as recorded.
    }
  }

  return false
}
