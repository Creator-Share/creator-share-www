import {
  DOMAIN_PROVIDER_REQUEST_TIMEOUT_MAX_MS,
  DOMAIN_PROVIDER_REQUEST_TIMEOUT_MIN_MS,
  loadCloudflareProvisioningConfig,
  loadVercelProvisioningConfig,
  type ProvisioningEnvironment,
} from "./config"
import { CloudflareDomainAdapter } from "./cloudflare"
import {
  isPaymentPathProvider,
  PaymentPathReadinessAdapter,
} from "./paymentPaths"
import type { FetchImplementation } from "./providerHttp"
import {
  DomainProvisioningError,
  type DomainProviderAdapter,
  type DomainProvisioningProvider,
} from "./types"
import { VercelDomainAdapter } from "./vercel"

export type DomainProviderAdapterFactory = (
  provider: DomainProvisioningProvider,
  requestTimeoutMs?: number,
) => DomainProviderAdapter

export function createDomainProviderAdapterFactory(
  options: {
    env?: ProvisioningEnvironment
    fetchImplementation?: FetchImplementation
  } = {},
): DomainProviderAdapterFactory {
  const env = options.env ?? process.env
  const fetchImplementation = options.fetchImplementation ?? fetch

  return (
    provider,
    requestTimeoutMs = DOMAIN_PROVIDER_REQUEST_TIMEOUT_MAX_MS,
  ) => {
    if (
      !Number.isSafeInteger(requestTimeoutMs) ||
      requestTimeoutMs < DOMAIN_PROVIDER_REQUEST_TIMEOUT_MIN_MS ||
      requestTimeoutMs > DOMAIN_PROVIDER_REQUEST_TIMEOUT_MAX_MS
    ) {
      throw new DomainProvisioningError({
        code: "worker_configuration_invalid",
        retryable: false,
      })
    }
    if (provider === "cloudflare") {
      const config = loadCloudflareProvisioningConfig(env)
      return new CloudflareDomainAdapter(
        {
          ...config,
          requestTimeoutMs: Math.min(config.requestTimeoutMs, requestTimeoutMs),
        },
        fetchImplementation,
      )
    }
    if (provider === "vercel") {
      const config = loadVercelProvisioningConfig(env)
      return new VercelDomainAdapter(
        {
          ...config,
          requestTimeoutMs: Math.min(config.requestTimeoutMs, requestTimeoutMs),
        },
        fetchImplementation,
      )
    }
    if (isPaymentPathProvider(provider)) {
      return new PaymentPathReadinessAdapter(
        provider,
        env,
        fetchImplementation,
        requestTimeoutMs,
      )
    }

    throw new DomainProvisioningError({
      code: "unsupported_domain_provider",
      retryable: false,
    })
  }
}
