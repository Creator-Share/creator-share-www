import {
  loadPayPalPaymentPathConfig,
  loadStripePaymentPathConfig,
  type PayPalPaymentPathConfig,
  type ProvisioningEnvironment,
  type StripePaymentPathConfig,
  type StripePaymentPathProvider,
} from "./config"
import {
  isRecord,
  retryAfterSeconds,
  type FetchImplementation,
} from "./providerHttp"
import {
  DomainProvisioningError,
  type ClaimedDomainProvisioningJob,
  type DomainProviderAdapter,
  type DomainProvisioningContext,
  type DomainProvisioningProvider,
  type ProviderReconciliation,
  type SafeProviderEvidence,
} from "./types"

type PaymentPathProvider = StripePaymentPathProvider | "paypal"
type PaymentPathConfig = StripePaymentPathConfig | PayPalPaymentPathConfig

const STRIPE_BALANCE_URL = "https://api.stripe.com/v1/balance"
const PAYPAL_TOKEN_URL = "https://api-m.paypal.com/v1/oauth2/token"
const MAX_PROBE_RESPONSE_BYTES = 64_000

function providerResourceId(provider: PaymentPathProvider): string {
  return `${provider}:hosted_checkout`
}

function absentEvidence(provider: PaymentPathProvider): SafeProviderEvidence {
  return {
    provider_status: "absent",
    provider_resource_id: providerResourceId(provider),
    verified: true,
    already_applied: true,
  }
}

function readyEvidence(provider: PaymentPathProvider): SafeProviderEvidence {
  return {
    provider_status: "payment_path_ready",
    provider_resource_id: providerResourceId(provider),
    http_status: 200,
    verified: true,
  }
}

function isExactReconciliationEvidence(
  provider: PaymentPathProvider,
  job: ClaimedDomainProvisioningJob,
  reconciliation: ProviderReconciliation,
): boolean {
  const expected =
    job.kind === "deprovision"
      ? absentEvidence(provider)
      : readyEvidence(provider)

  return (
    reconciliation.outcome === "matches_intent" &&
    reconciliation.desiredStateVerified &&
    Object.keys(reconciliation.evidence).length ===
      Object.keys(expected).length &&
    Object.entries(expected).every(
      ([key, value]) =>
        reconciliation.evidence[key as keyof SafeProviderEvidence] === value,
    ) &&
    (job.kind === "deprovision" || reconciliation.evidence.http_status === 200)
  )
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentLength = response.headers.get("content-length")
  if (
    contentLength !== null &&
    /^\d+$/.test(contentLength) &&
    Number(contentLength) > MAX_PROBE_RESPONSE_BYTES
  ) {
    throw new DomainProvisioningError({
      code: "payment_path_invalid_response",
      retryable: true,
      evidence: { http_status: response.status },
    })
  }

  let text: string
  try {
    text = await response.text()
  } catch {
    throw new DomainProvisioningError({
      code: "payment_path_invalid_response",
      retryable: true,
      evidence: { http_status: response.status },
    })
  }

  if (new TextEncoder().encode(text).byteLength > MAX_PROBE_RESPONSE_BYTES) {
    throw new DomainProvisioningError({
      code: "payment_path_invalid_response",
      retryable: true,
      evidence: { http_status: response.status },
    })
  }

  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new DomainProvisioningError({
      code: "payment_path_invalid_response",
      retryable: true,
      evidence: { http_status: response.status },
    })
  }
}

function throwForProbeStatus(
  provider: PaymentPathProvider,
  response: Response,
): never {
  const status = response.status
  const retryable = status === 429 || status >= 500
  throw new DomainProvisioningError({
    code: retryable
      ? `${provider}_probe_transient_error`
      : `${provider}_configuration_or_authorization_failed`,
    retryable,
    retryAfterSeconds: retryAfterSeconds(response),
    evidence: { http_status: status },
  })
}

async function fetchProbe(options: {
  provider: PaymentPathProvider
  fetchImplementation: FetchImplementation
  url: typeof STRIPE_BALANCE_URL | typeof PAYPAL_TOKEN_URL
  init: RequestInit
  timeoutMs: number
}): Promise<{ response: Response; payload: unknown }> {
  let response: Response
  try {
    response = await options.fetchImplementation(options.url, {
      ...options.init,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(options.timeoutMs),
    })
  } catch {
    throw new DomainProvisioningError({
      code: `${options.provider}_probe_network_error`,
      retryable: true,
    })
  }

  if (!response.ok) {
    try {
      await response.body?.cancel()
    } catch {
      // The provider body is deliberately neither parsed nor propagated.
    }
    throwForProbeStatus(options.provider, response)
  }
  return { response, payload: await readBoundedJson(response) }
}

async function probeStripe(
  config: StripePaymentPathConfig,
  fetchImplementation: FetchImplementation,
): Promise<SafeProviderEvidence> {
  const result = await fetchProbe({
    provider: config.provider,
    fetchImplementation,
    url: STRIPE_BALANCE_URL,
    init: {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.secretKey}`,
      },
    },
    timeoutMs: config.requestTimeoutMs,
  })

  if (
    !isRecord(result.payload) ||
    result.response.status !== 200 ||
    result.payload.object !== "balance" ||
    result.payload.livemode !== true
  ) {
    throw new DomainProvisioningError({
      code:
        isRecord(result.payload) && result.payload.livemode === false
          ? `${config.provider}_account_not_live`
          : `${config.provider}_probe_invalid_response`,
      retryable: !(
        isRecord(result.payload) && result.payload.livemode === false
      ),
      evidence: { http_status: result.response.status },
    })
  }

  return readyEvidence(config.provider)
}

async function probePayPal(
  config: PayPalPaymentPathConfig,
  fetchImplementation: FetchImplementation,
): Promise<SafeProviderEvidence> {
  const credentials = Buffer.from(
    `${config.clientId}:${config.clientSecret}`,
    "utf8",
  ).toString("base64")
  const result = await fetchProbe({
    provider: config.provider,
    fetchImplementation,
    url: PAYPAL_TOKEN_URL,
    init: {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    },
    timeoutMs: config.requestTimeoutMs,
  })

  if (
    !isRecord(result.payload) ||
    result.response.status !== 200 ||
    typeof result.payload.access_token !== "string" ||
    result.payload.access_token.length < 1 ||
    result.payload.access_token.length > 4096 ||
    typeof result.payload.token_type !== "string" ||
    result.payload.token_type.toLowerCase() !== "bearer" ||
    typeof result.payload.expires_in !== "number" ||
    !Number.isSafeInteger(result.payload.expires_in) ||
    result.payload.expires_in < 1
  ) {
    throw new DomainProvisioningError({
      code: "paypal_probe_invalid_response",
      retryable: true,
      evidence: { http_status: result.response.status },
    })
  }

  return readyEvidence(config.provider)
}

export class PaymentPathReadinessAdapter implements DomainProviderAdapter {
  readonly provider: PaymentPathProvider

  constructor(
    provider: PaymentPathProvider,
    private readonly env: ProvisioningEnvironment = process.env,
    private readonly fetchImplementation: FetchImplementation = fetch,
    private readonly requestTimeoutCapMs = Number.POSITIVE_INFINITY,
  ) {
    this.provider = provider
  }

  private loadConfig(): PaymentPathConfig {
    const config =
      this.provider === "paypal"
        ? loadPayPalPaymentPathConfig(this.env)
        : loadStripePaymentPathConfig(this.provider, this.env)
    return {
      ...config,
      requestTimeoutMs: Math.min(
        config.requestTimeoutMs,
        this.requestTimeoutCapMs,
      ),
    }
  }

  private assertProviderScope(
    job: ClaimedDomainProvisioningJob,
    context: DomainProvisioningContext,
  ): void {
    if (
      job.provider !== this.provider ||
      context.integrationProvider !== this.provider
    ) {
      throw new DomainProvisioningError({
        code: "payment_path_provider_mismatch",
        retryable: false,
      })
    }
  }

  async reconcile(
    job: ClaimedDomainProvisioningJob,
    context: DomainProvisioningContext,
  ): Promise<ProviderReconciliation> {
    this.assertProviderScope(job, context)
    if (job.kind === "deprovision") {
      return {
        outcome: "matches_intent",
        desiredStateVerified: true,
        evidence: absentEvidence(this.provider),
      }
    }

    const config = this.loadConfig()
    const evidence =
      config.provider === "paypal"
        ? await probePayPal(config, this.fetchImplementation)
        : await probeStripe(config, this.fetchImplementation)

    return {
      outcome: "matches_intent",
      desiredStateVerified: true,
      evidence,
    }
  }

  async apply(
    job: ClaimedDomainProvisioningJob,
    context: DomainProvisioningContext,
    reconciliation: ProviderReconciliation,
  ): Promise<SafeProviderEvidence> {
    this.assertProviderScope(job, context)
    if (!isExactReconciliationEvidence(this.provider, job, reconciliation)) {
      throw new DomainProvisioningError({
        code: "payment_path_apply_not_verified",
        retryable: false,
      })
    }

    return reconciliation.evidence
  }
}

export function isPaymentPathProvider(
  provider: DomainProvisioningProvider,
): provider is PaymentPathProvider {
  return (
    provider === "stripe_us" ||
    provider === "stripe_uk" ||
    provider === "paypal"
  )
}
