import {
  DomainProvisioningError,
  type SafeProviderEvidence,
  type SupportedDomainProvider,
} from "./types"
import { sanitizeEvidenceString } from "./validation"

export type FetchImplementation = typeof fetch

export interface ProviderHttpResponse {
  response: Response
  payload: unknown
  evidence: SafeProviderEvidence
}

const MAX_PROVIDER_RESPONSE_BYTES = 1_000_000

function requestIdForProvider(
  provider: SupportedDomainProvider,
  response: Response,
): string | undefined {
  const candidates =
    provider === "cloudflare"
      ? [response.headers.get("cf-ray"), response.headers.get("x-request-id")]
      : [
          response.headers.get("x-vercel-id"),
          response.headers.get("x-request-id"),
        ]

  for (const candidate of candidates) {
    const safe = sanitizeEvidenceString(candidate)
    if (safe) return safe
  }

  return undefined
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentLength = response.headers.get("content-length")
  if (
    contentLength &&
    /^\d+$/.test(contentLength) &&
    Number(contentLength) > MAX_PROVIDER_RESPONSE_BYTES
  ) {
    throw new DomainProvisioningError({
      code: "provider_response_too_large",
      retryable: true,
      evidence: { http_status: response.status },
    })
  }

  const text = await response.text()
  if (text.length > MAX_PROVIDER_RESPONSE_BYTES) {
    throw new DomainProvisioningError({
      code: "provider_response_too_large",
      retryable: true,
      evidence: { http_status: response.status },
    })
  }
  if (!text) return null

  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    throw new DomainProvisioningError({
      code: "provider_invalid_json",
      retryable: response.status >= 500,
      evidence: { http_status: response.status },
      cause: error,
    })
  }
}

export async function fetchProviderJson(options: {
  provider: SupportedDomainProvider
  fetchImplementation: FetchImplementation
  url: string
  init: RequestInit
  timeoutMs: number
}): Promise<ProviderHttpResponse> {
  let response: Response
  try {
    response = await options.fetchImplementation(options.url, {
      ...options.init,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(options.timeoutMs),
    })
  } catch (error) {
    throw new DomainProvisioningError({
      code: `${options.provider}_network_error`,
      retryable: true,
      cause: error,
    })
  }

  const providerRequestId = requestIdForProvider(options.provider, response)
  const evidence: SafeProviderEvidence = {
    http_status: response.status,
    ...(providerRequestId
      ? { provider_request_id: providerRequestId }
      : {}),
  }

  const payload = await readBoundedJson(response)
  return { response, payload, evidence }
}

export function retryAfterSeconds(response: Response): number | undefined {
  const value = response.headers.get("retry-after")
  if (!value) return undefined

  if (/^[0-9]+$/.test(value)) {
    const seconds = Number(value)
    if (Number.isSafeInteger(seconds)) {
      return Math.max(1, Math.min(86_400, seconds))
    }
  }

  const date = Date.parse(value)
  if (!Number.isNaN(date)) {
    const seconds = Math.ceil((date - Date.now()) / 1000)
    return Math.max(1, Math.min(86_400, seconds))
  }

  return undefined
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
