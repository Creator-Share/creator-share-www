import "server-only"

export const PAYMENT_GATEWAY_EVENT_MAX_ATTEMPTS = 12 as const

export type PaymentGatewayProvider = "STRIPE" | "PAYPAL"

export interface ClaimedPaymentGatewayEvent {
  gatewayEventId: string
  processingLeaseToken: string
  provider: PaymentGatewayProvider
  providerAccountScope: string
  providerEventId: string
  eventType: string
  providerObjectType: string | null
  paymentAttemptId: string | null
  verificationMethod: string
  processingAttemptCount: number
}

export interface PaymentGatewayWelcomeBundle {
  claimTokenDigest: string
  recipientEmailCiphertext: string
  emailEncryptionKeyVersion: number
  secretPayloadCiphertext: string
  welcomeTemplateKey: "sponsor-welcome-v1"
  welcomeTemplateData: Record<string, string | number | boolean | null>
}

export type PaymentGatewayApplicationEffect =
  | "payment_succeeded"
  | "payment_failed"
  | "checkout_expired"
  | "subscription_lifecycle"
  | "duplicate_movement"
  | "refund_required"
  | "ignored"
  | "refund_applied"
  | "reversal_applied"
  | "dispute_debit_applied"
  | "dispute_credit_applied"
  | "legacy_applied"

export interface PaymentGatewayApplicationResult {
  effect: PaymentGatewayApplicationEffect | null
  retryState?: PaymentGatewayRetryState
}

export interface PaymentGatewayRetryState {
  processingAttemptCount: number
  maxProcessingAttempts: number
  terminal: boolean
}

export interface PaymentGatewayWorkerContext {
  requestId: string
  traceId: string | null
}

export interface CheckoutContactErasureCounts {
  erased: number
  succeeded: number
  failed: number
  cancelled: number
  expired: number
}

export interface PaymentGatewayEventRepository {
  claimEvents(options: {
    workerId: string
    batchSize: number
    context: PaymentGatewayWorkerContext
  }): Promise<ClaimedPaymentGatewayEvent[]>
  prepareWelcomeBundle(
    event: ClaimedPaymentGatewayEvent,
    context: PaymentGatewayWorkerContext,
  ): Promise<PaymentGatewayWelcomeBundle | null>
  applySuccess(
    event: ClaimedPaymentGatewayEvent,
    bundle: PaymentGatewayWelcomeBundle | null,
    context: PaymentGatewayWorkerContext,
  ): Promise<PaymentGatewayApplicationResult>
  applyFailure(
    event: ClaimedPaymentGatewayEvent,
    context: PaymentGatewayWorkerContext,
  ): Promise<PaymentGatewayApplicationResult>
  applyCheckoutExpiration(
    event: ClaimedPaymentGatewayEvent,
    context: PaymentGatewayWorkerContext,
  ): Promise<PaymentGatewayApplicationResult>
  applySubscriptionLifecycle(
    event: ClaimedPaymentGatewayEvent,
    context: PaymentGatewayWorkerContext,
  ): Promise<PaymentGatewayApplicationResult>
  applyFinancialAdjustment(
    event: ClaimedPaymentGatewayEvent,
    context: PaymentGatewayWorkerContext,
  ): Promise<PaymentGatewayApplicationResult>
  applyLegacyStripe(
    event: ClaimedPaymentGatewayEvent,
    context: PaymentGatewayWorkerContext,
  ): Promise<PaymentGatewayApplicationResult>
  ignore(
    event: ClaimedPaymentGatewayEvent,
    reason: string,
    context: PaymentGatewayWorkerContext,
  ): Promise<void>
  retry(
    event: ClaimedPaymentGatewayEvent,
    errorSummary: string,
    retryDelaySeconds: number,
    context: PaymentGatewayWorkerContext,
  ): Promise<PaymentGatewayRetryState>
  purgeCheckoutContactEnvelopes(
    context: PaymentGatewayWorkerContext,
  ): Promise<CheckoutContactErasureCounts>
}

export class PaymentGatewayEventRepositoryError extends Error {
  readonly stage: string
  readonly leaseLost: boolean

  constructor(stage: string, options: { leaseLost?: boolean } = {}) {
    super(`payment_gateway_event_repository_${stage}`)
    this.name = "PaymentGatewayEventRepositoryError"
    this.stage = stage
    this.leaseLost = options.leaseLost === true
  }
}

export type PaymentGatewayEventProcessStatus =
  | "applied"
  | "ignored"
  | "retried"
  | "terminal_failed"
  | "lease_lost"
  | "settlement_unknown"

export interface PaymentGatewayEventProcessResult {
  gatewayEventId: string
  status: PaymentGatewayEventProcessStatus
  effect?: PaymentGatewayApplicationEffect
  code?: string
}

export interface PaymentGatewayEventBatchResult {
  claimed: number
  applied: number
  ignored: number
  retried: number
  terminalFailed: number
  leaseLost: number
  settlementUnknown: number
  contactErasure: CheckoutContactErasureCounts
  results: PaymentGatewayEventProcessResult[]
}

export interface PaymentGatewayEventWorkerConfig {
  batchSize: number
  concurrency: number
}

type PaymentGatewayEventRoute =
  | "success"
  | "failure"
  | "subscription_lifecycle"
  | "financial_adjustment"
  | "checkout_expiration"
  | "legacy_stripe"
  | "unsupported"

interface RouteDefinition {
  objectType: string
  route: Exclude<PaymentGatewayEventRoute, "unsupported">
}

const STRIPE_ROUTES: Readonly<Record<string, RouteDefinition>> = {
  "checkout.session.completed": {
    objectType: "checkout_session",
    route: "success",
  },
  "checkout.session.async_payment_succeeded": {
    objectType: "checkout_session",
    route: "success",
  },
  "checkout.session.async_payment_failed": {
    objectType: "checkout_session",
    route: "failure",
  },
  "checkout.session.expired": {
    objectType: "checkout_session",
    route: "checkout_expiration",
  },
  "invoice.paid": { objectType: "invoice", route: "success" },
  "invoice.payment_succeeded": {
    objectType: "invoice",
    route: "success",
  },
  "invoice.payment_failed": { objectType: "invoice", route: "failure" },
  "customer.subscription.created": {
    objectType: "subscription",
    route: "subscription_lifecycle",
  },
  "customer.subscription.updated": {
    objectType: "subscription",
    route: "subscription_lifecycle",
  },
  "customer.subscription.deleted": {
    objectType: "subscription",
    route: "subscription_lifecycle",
  },
  "refund.created": { objectType: "refund", route: "financial_adjustment" },
  "refund.updated": { objectType: "refund", route: "financial_adjustment" },
  "charge.dispute.funds_withdrawn": {
    objectType: "dispute",
    route: "financial_adjustment",
  },
  "charge.dispute.funds_reinstated": {
    objectType: "dispute",
    route: "financial_adjustment",
  },
}

const PAYPAL_ROUTES: Readonly<Record<string, RouteDefinition>> = {
  "PAYMENT.CAPTURE.COMPLETED": { objectType: "capture", route: "success" },
  "PAYMENT.SALE.COMPLETED": { objectType: "sale", route: "success" },
  "PAYMENT.CAPTURE.DENIED": { objectType: "capture", route: "failure" },
  "PAYMENT.CAPTURE.DECLINED": { objectType: "capture", route: "failure" },
  "PAYMENT.SALE.DENIED": { objectType: "sale", route: "failure" },
  "BILLING.SUBSCRIPTION.ACTIVATED": {
    objectType: "billing_subscription",
    route: "subscription_lifecycle",
  },
  "BILLING.SUBSCRIPTION.CANCELLED": {
    objectType: "billing_subscription",
    route: "subscription_lifecycle",
  },
  "BILLING.SUBSCRIPTION.SUSPENDED": {
    objectType: "billing_subscription",
    route: "subscription_lifecycle",
  },
  "BILLING.SUBSCRIPTION.EXPIRED": {
    objectType: "billing_subscription",
    route: "subscription_lifecycle",
  },
  "BILLING.SUBSCRIPTION.UPDATED": {
    objectType: "billing_subscription",
    route: "subscription_lifecycle",
  },
  "BILLING.SUBSCRIPTION.PAYMENT.FAILED": {
    objectType: "billing_subscription",
    route: "failure",
  },
  "PAYMENT.CAPTURE.REFUNDED": {
    objectType: "capture",
    route: "financial_adjustment",
  },
  "PAYMENT.CAPTURE.REVERSED": {
    objectType: "capture",
    route: "financial_adjustment",
  },
  "PAYMENT.SALE.REFUNDED": {
    objectType: "sale",
    route: "financial_adjustment",
  },
  "PAYMENT.SALE.REVERSED": {
    objectType: "sale",
    route: "financial_adjustment",
  },
}

const UNSUPPORTED_EVENT_ERROR = "typed_gateway_event_resolver_missing"
const APPLICATION_FAILURE_ERROR = "typed_gateway_event_application_failed"

function routeEvent(
  event: ClaimedPaymentGatewayEvent,
): PaymentGatewayEventRoute {
  if (event.verificationMethod === "stripe_webhook_signature_legacy") {
    return event.provider === "STRIPE" && event.paymentAttemptId === null
      ? "legacy_stripe"
      : "unsupported"
  }
  if (
    event.provider === "PAYPAL" &&
    (event.eventType === "CUSTOMER.DISPUTE.CREATED" ||
      event.eventType === "CUSTOMER.DISPUTE.RESOLVED") &&
    (event.providerObjectType === "capture" ||
      event.providerObjectType === "sale")
  ) {
    return "financial_adjustment"
  }
  const definitions =
    event.provider === "STRIPE" ? STRIPE_ROUTES : PAYPAL_ROUTES
  const definition = definitions[event.eventType]
  if (!definition || definition.objectType !== event.providerObjectType) {
    return "unsupported"
  }
  return definition.route
}

function retryDelaySeconds(attemptCount: number): number {
  const exponent = Math.max(0, Math.min(attemptCount - 1, 10))
  return Math.min(3_600, 30 * 2 ** exponent)
}

function resultFromApplication(
  event: ClaimedPaymentGatewayEvent,
  application: PaymentGatewayApplicationResult,
): PaymentGatewayEventProcessResult {
  if (application.effect !== null) {
    return {
      gatewayEventId: event.gatewayEventId,
      status:
        application.effect === "ignored" ||
        application.effect === "duplicate_movement"
          ? "ignored"
          : "applied",
      effect: application.effect,
    }
  }

  if (!application.retryState) {
    throw new PaymentGatewayEventRepositoryError("application_shape")
  }
  return {
    gatewayEventId: event.gatewayEventId,
    status: application.retryState.terminal ? "terminal_failed" : "retried",
    code: APPLICATION_FAILURE_ERROR,
  }
}

async function settleFailure(options: {
  repository: PaymentGatewayEventRepository
  event: ClaimedPaymentGatewayEvent
  context: PaymentGatewayWorkerContext
  code: string
}): Promise<PaymentGatewayEventProcessResult> {
  const { repository, event, context, code } = options
  try {
    const retryState = await repository.retry(
      event,
      code,
      retryDelaySeconds(event.processingAttemptCount),
      context,
    )
    return {
      gatewayEventId: event.gatewayEventId,
      status: retryState.terminal ? "terminal_failed" : "retried",
      code,
    }
  } catch (error) {
    if (
      error instanceof PaymentGatewayEventRepositoryError &&
      error.leaseLost
    ) {
      return {
        gatewayEventId: event.gatewayEventId,
        status: "lease_lost",
        code,
      }
    }
    return {
      gatewayEventId: event.gatewayEventId,
      status: "settlement_unknown",
      code,
    }
  }
}

export async function processPaymentGatewayEvent(options: {
  repository: PaymentGatewayEventRepository
  event: ClaimedPaymentGatewayEvent
  context: PaymentGatewayWorkerContext
}): Promise<PaymentGatewayEventProcessResult> {
  const { repository, event, context } = options
  const route = routeEvent(event)

  try {
    switch (route) {
      case "success": {
        if (!event.paymentAttemptId) {
          throw new PaymentGatewayEventRepositoryError("success_chain_shape")
        }
        const bundle = await repository.prepareWelcomeBundle(event, context)
        return resultFromApplication(
          event,
          await repository.applySuccess(event, bundle, context),
        )
      }
      case "failure":
        return resultFromApplication(
          event,
          await repository.applyFailure(event, context),
        )
      case "subscription_lifecycle":
        return resultFromApplication(
          event,
          await repository.applySubscriptionLifecycle(event, context),
        )
      case "financial_adjustment":
        return resultFromApplication(
          event,
          await repository.applyFinancialAdjustment(event, context),
        )
      case "checkout_expiration":
        return resultFromApplication(
          event,
          await repository.applyCheckoutExpiration(event, context),
        )
      case "legacy_stripe":
        return resultFromApplication(
          event,
          await repository.applyLegacyStripe(event, context),
        )
      default:
        return settleFailure({
          repository,
          event,
          context,
          code: UNSUPPORTED_EVENT_ERROR,
        })
    }
  } catch (error) {
    if (
      error instanceof PaymentGatewayEventRepositoryError &&
      error.leaseLost
    ) {
      return { gatewayEventId: event.gatewayEventId, status: "lease_lost" }
    }

    return settleFailure({
      repository,
      event,
      context,
      code: APPLICATION_FAILURE_ERROR,
    })
  }
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  apply: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length)
  let nextIndex = 0

  async function consume() {
    while (nextIndex < values.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await apply(values[index])
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () =>
      consume(),
    ),
  )
  return results
}

function assertConfig(config: PaymentGatewayEventWorkerConfig): void {
  if (
    !Number.isInteger(config.batchSize) ||
    config.batchSize < 1 ||
    config.batchSize > 100 ||
    !Number.isInteger(config.concurrency) ||
    config.concurrency < 1 ||
    config.concurrency > 10
  ) {
    throw new Error("Invalid payment gateway event worker configuration")
  }
}

export async function runPaymentGatewayEventBatch(options: {
  repository: PaymentGatewayEventRepository
  config: PaymentGatewayEventWorkerConfig
  workerId: string
  context: PaymentGatewayWorkerContext
}): Promise<PaymentGatewayEventBatchResult> {
  assertConfig(options.config)
  const events = await options.repository.claimEvents({
    workerId: options.workerId,
    batchSize: options.config.batchSize,
    context: options.context,
  })
  const results = await mapWithConcurrency(
    events,
    options.config.concurrency,
    (event) =>
      processPaymentGatewayEvent({
        repository: options.repository,
        event,
        context: options.context,
      }),
  )
  const contactErasure = await options.repository.purgeCheckoutContactEnvelopes(
    options.context,
  )

  return {
    claimed: results.length,
    applied: results.filter((result) => result.status === "applied").length,
    ignored: results.filter((result) => result.status === "ignored").length,
    retried: results.filter((result) => result.status === "retried").length,
    terminalFailed: results.filter(
      (result) => result.status === "terminal_failed",
    ).length,
    leaseLost: results.filter((result) => result.status === "lease_lost")
      .length,
    settlementUnknown: results.filter(
      (result) => result.status === "settlement_unknown",
    ).length,
    contactErasure,
    results,
  }
}
