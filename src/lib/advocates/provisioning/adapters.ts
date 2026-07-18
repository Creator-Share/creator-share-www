import {
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
) => DomainProviderAdapter

export function createDomainProviderAdapterFactory(options: {
  env?: ProvisioningEnvironment
  fetchImplementation?: FetchImplementation
} = {}): DomainProviderAdapterFactory {
  const env = options.env ?? process.env
  const fetchImplementation = options.fetchImplementation ?? fetch

  return (provider) => {
    if (provider === "cloudflare") {
      return new CloudflareDomainAdapter(
        loadCloudflareProvisioningConfig(env),
        fetchImplementation,
      )
    }
    if (provider === "vercel") {
      return new VercelDomainAdapter(
        loadVercelProvisioningConfig(env),
        fetchImplementation,
      )
    }
    if (isPaymentPathProvider(provider)) {
      return new PaymentPathReadinessAdapter(
        provider,
        env,
        fetchImplementation,
      )
    }

    throw new DomainProvisioningError({
      code: "unsupported_domain_provider",
      retryable: false,
    })
  }
}
