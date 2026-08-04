import "server-only"

import {
  createPayPalBillingPlan,
  createPayPalBillingProduct,
  PayPalBillingCatalogError,
  type PayPalBillingCatalogFetch,
  type PayPalBillingCatalogTerms,
  verifyPayPalBillingPlan,
} from "@/lib/paypal/billingCatalog"

export interface PayPalBillingCatalogContext {
  requestId: string
  traceId: string | null
}

export interface ExactPayPalBillingCatalogTerms extends PayPalBillingCatalogTerms {
  subjectKind: "standard" | "blind"
  beneficiaryId: string | null
  baseAmountUsdCents: number
  conversionRate: number
  currencyRateSource: string
}

export interface ClaimedPayPalBillingCatalogEntry {
  catalogEntryId: string
  catalogStatus: "provisioning" | "active" | "manual_review"
  provisioningLeaseToken: string | null
  productRequestId: string
  planRequestId: string
  providerProductId: string | null
  providerPlanId: string | null
  provisioningRequired: boolean
}

export type PayPalBillingCatalogRequestPhase = "product" | "plan"
export type PayPalBillingCatalogManualReviewCode =
  | "product_request_ambiguous"
  | "product_response_recording_failed"
  | "plan_request_ambiguous"
  | "plan_response_recording_failed"
  | "active_plan_drift"

export interface PayPalBillingCatalogRepository {
  claimEntry(options: {
    terms: ExactPayPalBillingCatalogTerms
    context: PayPalBillingCatalogContext
  }): Promise<ClaimedPayPalBillingCatalogEntry>
  markProviderRequestStarted(options: {
    catalogEntryId: string
    provisioningLeaseToken: string
    phase: PayPalBillingCatalogRequestPhase
    context: PayPalBillingCatalogContext
  }): Promise<{ providerRequestId: string }>
  recordProduct(options: {
    catalogEntryId: string
    provisioningLeaseToken: string
    providerProductId: string
    context: PayPalBillingCatalogContext
  }): Promise<void>
  activateEntry(options: {
    catalogEntryId: string
    provisioningLeaseToken: string
    providerProductId: string
    providerPlanId: string
    context: PayPalBillingCatalogContext
  }): Promise<void>
  failKnownRejection(options: {
    catalogEntryId: string
    provisioningLeaseToken: string
    phase: PayPalBillingCatalogRequestPhase
    context: PayPalBillingCatalogContext
  }): Promise<void>
  quarantineEntry(options: {
    catalogEntryId: string
    provisioningLeaseToken: string | null
    manualReviewCode: PayPalBillingCatalogManualReviewCode
    observedProviderProductId: string | null
    observedProviderPlanId: string | null
    context: PayPalBillingCatalogContext
  }): Promise<void>
}

export interface PayPalBillingCatalogProvisionerDependencies {
  repository: PayPalBillingCatalogRepository
  fetch?: PayPalBillingCatalogFetch
}

export class PayPalBillingCatalogProvisioningError extends Error {
  readonly code:
    | "catalog-unavailable"
    | "dependency-failed"
    | "provider-rejected"
    | "settlement-unknown"

  constructor(code: PayPalBillingCatalogProvisioningError["code"]) {
    super("PayPal recurring sponsorship is temporarily unavailable")
    this.name = "PayPalBillingCatalogProvisioningError"
    this.code = code
  }
}

function provisioningError(
  code: PayPalBillingCatalogProvisioningError["code"],
): never {
  throw new PayPalBillingCatalogProvisioningError(code)
}

function providerFailureIsKnownRejection(error: unknown): boolean {
  return (
    error instanceof PayPalBillingCatalogError &&
    (error.code === "provider-rejected" || error.code === "provider-not-found")
  )
}

function activePlanFailureIsDrift(error: unknown): boolean {
  return (
    error instanceof PayPalBillingCatalogError &&
    (error.code === "invalid-provider-response" ||
      error.code === "provider-not-found")
  )
}

async function quarantineAndFail(options: {
  repository: PayPalBillingCatalogRepository
  entry: ClaimedPayPalBillingCatalogEntry
  manualReviewCode: PayPalBillingCatalogManualReviewCode
  observedProviderProductId?: string | null
  observedProviderPlanId?: string | null
  context: PayPalBillingCatalogContext
}): Promise<never> {
  try {
    await options.repository.quarantineEntry({
      catalogEntryId: options.entry.catalogEntryId,
      provisioningLeaseToken: options.entry.provisioningLeaseToken,
      manualReviewCode: options.manualReviewCode,
      observedProviderProductId: options.observedProviderProductId ?? null,
      observedProviderPlanId: options.observedProviderPlanId ?? null,
      context: options.context,
    })
  } catch {
    // The provider side effect remains uncertain even when durable quarantine
    // settlement also fails. The stale request age gate is the final backstop.
  }
  return provisioningError("settlement-unknown")
}

async function failKnownProviderRejection(options: {
  repository: PayPalBillingCatalogRepository
  entry: ClaimedPayPalBillingCatalogEntry
  phase: PayPalBillingCatalogRequestPhase
  context: PayPalBillingCatalogContext
}): Promise<never> {
  const leaseToken = options.entry.provisioningLeaseToken
  if (!leaseToken) provisioningError("dependency-failed")
  try {
    await options.repository.failKnownRejection({
      catalogEntryId: options.entry.catalogEntryId,
      provisioningLeaseToken: leaseToken,
      phase: options.phase,
      context: options.context,
    })
  } catch {
    provisioningError("dependency-failed")
  }
  return provisioningError("provider-rejected")
}

async function markProviderRequestStarted(options: {
  repository: PayPalBillingCatalogRepository
  entry: ClaimedPayPalBillingCatalogEntry
  phase: PayPalBillingCatalogRequestPhase
  context: PayPalBillingCatalogContext
}): Promise<{ leaseToken: string; providerRequestId: string }> {
  const leaseToken = options.entry.provisioningLeaseToken
  if (!leaseToken) provisioningError("dependency-failed")
  try {
    const marker = await options.repository.markProviderRequestStarted({
      catalogEntryId: options.entry.catalogEntryId,
      provisioningLeaseToken: leaseToken,
      phase: options.phase,
      context: options.context,
    })
    return { leaseToken, providerRequestId: marker.providerRequestId }
  } catch {
    provisioningError("dependency-failed")
  }
}

async function provisionProduct(options: {
  dependencies: PayPalBillingCatalogProvisionerDependencies
  entry: ClaimedPayPalBillingCatalogEntry
  terms: ExactPayPalBillingCatalogTerms
  context: PayPalBillingCatalogContext
}): Promise<string> {
  if (options.entry.providerProductId) {
    return options.entry.providerProductId
  }
  const marker = await markProviderRequestStarted({
    repository: options.dependencies.repository,
    entry: options.entry,
    phase: "product",
    context: options.context,
  })

  let productId: string
  try {
    productId = (
      await createPayPalBillingProduct(
        marker.providerRequestId,
        options.terms,
        options.dependencies.fetch,
      )
    ).productId
  } catch (error) {
    if (providerFailureIsKnownRejection(error)) {
      return failKnownProviderRejection({
        repository: options.dependencies.repository,
        entry: options.entry,
        phase: "product",
        context: options.context,
      })
    }
    return quarantineAndFail({
      repository: options.dependencies.repository,
      entry: options.entry,
      manualReviewCode: "product_request_ambiguous",
      context: options.context,
    })
  }

  try {
    await options.dependencies.repository.recordProduct({
      catalogEntryId: options.entry.catalogEntryId,
      provisioningLeaseToken: marker.leaseToken,
      providerProductId: productId,
      context: options.context,
    })
  } catch {
    return quarantineAndFail({
      repository: options.dependencies.repository,
      entry: options.entry,
      manualReviewCode: "product_response_recording_failed",
      observedProviderProductId: productId,
      context: options.context,
    })
  }
  return productId
}

async function provisionPlan(options: {
  dependencies: PayPalBillingCatalogProvisionerDependencies
  entry: ClaimedPayPalBillingCatalogEntry
  productId: string
  terms: ExactPayPalBillingCatalogTerms
  context: PayPalBillingCatalogContext
}): Promise<string> {
  const marker = await markProviderRequestStarted({
    repository: options.dependencies.repository,
    entry: options.entry,
    phase: "plan",
    context: options.context,
  })

  let planId: string
  try {
    planId = (
      await createPayPalBillingPlan(
        marker.providerRequestId,
        options.productId,
        options.terms,
        options.dependencies.fetch,
      )
    ).planId
  } catch (error) {
    if (providerFailureIsKnownRejection(error)) {
      return failKnownProviderRejection({
        repository: options.dependencies.repository,
        entry: options.entry,
        phase: "plan",
        context: options.context,
      })
    }
    return quarantineAndFail({
      repository: options.dependencies.repository,
      entry: options.entry,
      manualReviewCode: "plan_request_ambiguous",
      observedProviderProductId: options.productId,
      context: options.context,
    })
  }

  try {
    await options.dependencies.repository.activateEntry({
      catalogEntryId: options.entry.catalogEntryId,
      provisioningLeaseToken: marker.leaseToken,
      providerProductId: options.productId,
      providerPlanId: planId,
      context: options.context,
    })
  } catch {
    return quarantineAndFail({
      repository: options.dependencies.repository,
      entry: options.entry,
      manualReviewCode: "plan_response_recording_failed",
      observedProviderProductId: options.productId,
      observedProviderPlanId: planId,
      context: options.context,
    })
  }
  return planId
}

export async function ensurePayPalBillingPlan(options: {
  dependencies: PayPalBillingCatalogProvisionerDependencies
  terms: ExactPayPalBillingCatalogTerms
  context: PayPalBillingCatalogContext
}): Promise<{ planId: string }> {
  let entry: ClaimedPayPalBillingCatalogEntry
  try {
    entry = await options.dependencies.repository.claimEntry({
      terms: options.terms,
      context: options.context,
    })
  } catch {
    return provisioningError("dependency-failed")
  }

  if (entry.catalogStatus === "manual_review") {
    return provisioningError("catalog-unavailable")
  }

  if (entry.catalogStatus === "active") {
    if (
      entry.provisioningRequired ||
      !entry.providerProductId ||
      !entry.providerPlanId
    ) {
      return provisioningError("dependency-failed")
    }
    try {
      await verifyPayPalBillingPlan(
        entry.providerPlanId,
        entry.providerProductId,
        options.terms,
        options.dependencies.fetch,
      )
    } catch (error) {
      if (activePlanFailureIsDrift(error)) {
        return quarantineAndFail({
          repository: options.dependencies.repository,
          entry,
          manualReviewCode: "active_plan_drift",
          observedProviderProductId: entry.providerProductId,
          observedProviderPlanId: entry.providerPlanId,
          context: options.context,
        })
      }
      return provisioningError("dependency-failed")
    }
    return { planId: entry.providerPlanId }
  }

  if (
    entry.catalogStatus !== "provisioning" ||
    !entry.provisioningRequired ||
    !entry.provisioningLeaseToken
  ) {
    return provisioningError("dependency-failed")
  }

  const productId = await provisionProduct({
    dependencies: options.dependencies,
    entry,
    terms: options.terms,
    context: options.context,
  })
  const planId = await provisionPlan({
    dependencies: options.dependencies,
    entry,
    productId,
    terms: options.terms,
    context: options.context,
  })
  return { planId }
}
