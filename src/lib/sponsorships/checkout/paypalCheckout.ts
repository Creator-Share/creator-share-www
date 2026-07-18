import "server-only"

import {
  ensurePayPalBillingPlan,
  type ExactPayPalBillingCatalogTerms,
} from "@/lib/paypal/billingCatalogProvisioner"
import {
  capturePayPalSponsorshipOrder,
  createPayPalSponsorshipProviderObject,
  type CapturedPayPalOrder,
  type CreatedPayPalProviderObject,
} from "@/lib/paypal/sponsorshipCheckout"
import {
  buildPayPalProviderRequestTemplateClaims,
  createPayPalProviderRequestTemplate,
  openSealedPayPalProviderRequest,
  sealPayPalProviderRequest,
  type PayPalProviderRequestTemplateClaims,
  type SealedPayPalProviderRequest,
} from "@/lib/sponsorships/checkout/paypalProviderRequest"
import {
  assertCheckoutProviderTerms,
  assertCheckoutQuoteTerms,
  assertRecoveredSponsorshipCheckoutTerms,
  assertResumedSponsorshipCheckout,
  checkoutError,
  isCheckoutRecord,
  requestedCheckoutPaymentTerms,
  requestedCheckoutSubject,
  requiredCheckoutUuid,
  selectedCheckoutCurrency,
  sponsorshipCheckoutProductName,
  sponsorshipProviderRequestExpiresAt,
  sponsorshipQuoteFromRecoveredCheckout,
  sponsorshipVisitorDigest,
  SPONSORSHIP_CURRENCY_RATE_SOURCE,
  trustedCheckoutBaseAmount,
  validCheckoutDate,
  type AuthenticatedCheckoutUser,
  type AuthoritativeBeneficiary,
  type BeginV2PaymentInput,
  type BegunV2Payment,
  type IssueV2QuoteInput,
  type IssuedQuote,
  type PrepareV2IntentInput,
  type PreparedIntent,
  type RecoverV2CheckoutInput,
  type RecoveredV2Checkout,
  type ResolvedSponsorshipCheckoutHost,
  type ResumeV2CheckoutInput,
  type ResumedV2Checkout,
  type SponsorshipCheckoutRequestContext,
} from "@/lib/sponsorships/checkout/stripeCheckout"
import {
  sha256Digest,
  toSupabaseRpcBytea,
  type SponsorshipCrypto,
  type SupabaseRpcBytea,
} from "@/lib/sponsorships/crypto"
import { convertUsdCentsToCurrency } from "@/utils/currency"

const PROVIDER = "PAYPAL" as const
const PROVIDER_ACCOUNT_SCOPE = "paypal" as const
const PAYPAL_ORDER_ID_PATTERN = /^[A-Z0-9]{17}$/

export interface CreatePayPalSponsorshipCheckoutInput {
  body: unknown
  host: ResolvedSponsorshipCheckoutHost
  authenticatedUser: AuthenticatedCheckoutUser | null
  visitorToken: string | null
  requestContext: SponsorshipCheckoutRequestContext
}

export type PayPalSponsorshipCheckoutResult =
  | {
      kind: "order"
      orderId: string
      checkoutReceipt: string
    }
  | {
      kind: "approval_redirect"
      approvalUrl: string
      checkoutReceipt: string
    }
  | {
      kind: "processing"
      statusUrl: string
      checkoutReceipt: string
    }

export interface BeginPayPalV2PaymentInput extends Omit<
  BeginV2PaymentInput,
  "providerRequest" | "providerRequestClaims"
> {
  providerRequest: SealedPayPalProviderRequest
  providerRequestClaims: PayPalProviderRequestTemplateClaims
}

export interface ResumedPayPalV2Checkout extends Omit<
  ResumedV2Checkout,
  "providerRequestTemplateClaims"
> {
  providerRequestTemplateClaims: PayPalProviderRequestTemplateClaims
}

export interface SettlePayPalProviderObjectInput {
  paymentAttemptId: string
  providerObjectType: "order" | "billing_subscription"
  providerObjectId: string
  providerRequestSchemaVersion: number
  providerRequestFingerprint: SupabaseRpcBytea
  providerRequestExpiresAt: string
  recoveryLeaseToken: string | null
  requestContext: SponsorshipCheckoutRequestContext
}

export interface PayPalSponsorshipCheckoutV2Dependencies {
  crypto: SponsorshipCrypto
  loadBeneficiary(
    id: string,
    allowCurrentlyIneligible: boolean,
  ): Promise<AuthoritativeBeneficiary | null>
  recoverCheckout(
    input: RecoverV2CheckoutInput,
  ): Promise<RecoveredV2Checkout | null>
  prepareIntent(input: PrepareV2IntentInput): Promise<PreparedIntent>
  issueQuote(input: IssueV2QuoteInput): Promise<IssuedQuote>
  beginPayment(input: BeginPayPalV2PaymentInput): Promise<BegunV2Payment>
  resumeCheckout(input: ResumeV2CheckoutInput): Promise<ResumedPayPalV2Checkout>
  readAttachedOneTimeOrder(input: {
    checkoutReceiptDigest: SupabaseRpcBytea
    operationId: string
  }): Promise<PayPalCaptureMaterial>
  ensureBillingPlan(options: {
    terms: ExactPayPalBillingCatalogTerms
    context: { requestId: string; traceId: string | null }
  }): Promise<{ planId: string }>
  createProviderObject(
    request: ReturnType<typeof openSealedPayPalProviderRequest>,
  ): Promise<CreatedPayPalProviderObject>
  settleProviderObject(input: SettlePayPalProviderObjectInput): Promise<void>
  now(): Date
}

export interface PayPalCaptureMaterial {
  checkoutOperationId: string
  paymentAttemptId: string
  sponsorshipIntentId: string
  paymentQuoteId: string
  providerAccountScope: "paypal"
  providerObjectType: "order"
  providerObjectId: string
  providerRequestSchemaVersion: number
  providerRequestTemplateClaims: PayPalProviderRequestTemplateClaims
  providerRequestFingerprint: SupabaseRpcBytea
  providerRequestExpiresAt: string
  providerRequestCiphertext: SupabaseRpcBytea
  providerRequestEncryptionKeyVersion: number
  providerRequestCiphertextSha256: SupabaseRpcBytea
}

export interface VerifiedPayPalCaptureInput {
  paymentAttemptId: string
  providerAccountScope: "paypal"
  providerEventId: string
  providerObjectId: string
  parentOrderId: string
  redactedPayload: Record<string, unknown>
  payloadCiphertext: SupabaseRpcBytea
  payloadSha256: SupabaseRpcBytea
  signatureVerifiedAt: string
  occurredAt: string
  baseAmountUsdCents: number
  chargedAmountMinor: number
  chargedCurrency: string
  conversionRate: number
  requestContext: SponsorshipCheckoutRequestContext
}

export interface CapturePayPalSponsorshipDependencies {
  crypto: SponsorshipCrypto
  recoverCheckout(
    input: RecoverV2CheckoutInput,
  ): Promise<RecoveredV2Checkout | null>
  readCaptureMaterial(input: {
    checkoutReceiptDigest: SupabaseRpcBytea
    operationId: string
  }): Promise<PayPalCaptureMaterial>
  captureOrder(
    orderId: string,
    request: ReturnType<typeof openSealedPayPalProviderRequest>,
  ): Promise<CapturedPayPalOrder>
  ingestCapture(input: VerifiedPayPalCaptureInput): Promise<void>
  now(): Date
}

export interface CapturePayPalSponsorshipInput {
  operationId: string
  checkoutReceipt: string
  requestContext: SponsorshipCheckoutRequestContext
}

export interface CapturePayPalSponsorshipResult {
  checkoutReceipt: string
  statusUrl: string
  replayed: boolean
}

function hasOnlyStartKeys(body: Record<string, unknown>): boolean {
  const allowed = new Set([
    "action",
    "amount",
    "beneficiaryId",
    "checkoutRequestId",
    "currency",
    "email",
    "paymentType",
    "sponsorshipMode",
    "type",
  ])
  return Object.keys(body).every((key) => allowed.has(key))
}

function externalProviderRequestId(operationId: string): string {
  return requiredCheckoutUuid(operationId)
}

function databaseProviderIdempotencyKey(operationId: string): string {
  return `paypal-checkout:${requiredCheckoutUuid(operationId)}`
}

function statusUrl(baseUrl: string): string {
  return `${baseUrl}/payments/success?provider=paypal`
}

function sealedFromResume(
  resumed: ResumedPayPalV2Checkout,
): SealedPayPalProviderRequest {
  if (resumed.providerRequestSchemaVersion !== 1) {
    throw checkoutError("checkout-failed")
  }
  return {
    schemaVersion: 1,
    fingerprint: resumed.providerRequestFingerprint,
    expiresAt: resumed.providerRequestExpiresAt,
    ciphertext: resumed.providerRequestCiphertext,
    encryptionKeyVersion: resumed.providerRequestEncryptionKeyVersion,
    ciphertextSha256: resumed.providerRequestCiphertextSha256,
  }
}

function openResumedRequest(options: {
  resumed: ResumedPayPalV2Checkout
  operationId: string
  paymentAttemptId: string
  sponsorshipIntentId: string
  paymentQuoteId: string
  emailDigest: ReturnType<SponsorshipCrypto["digestEmail"]>
  crypto: SponsorshipCrypto
}) {
  const sealed = sealedFromResume(options.resumed)
  return {
    sealed,
    request: openSealedPayPalProviderRequest(
      {
        ciphertext: sealed.ciphertext,
        ciphertextSha256: sealed.ciphertextSha256,
        encryptionKeyVersion: sealed.encryptionKeyVersion,
        fingerprint: sealed.fingerprint,
        schemaVersion: sealed.schemaVersion,
        expectedOperationId: options.operationId,
        expectedPaymentAttemptId: options.paymentAttemptId,
        expectedSponsorshipIntentId: options.sponsorshipIntentId,
        expectedPaymentQuoteId: options.paymentQuoteId,
        expectedProviderAccountScope: PROVIDER_ACCOUNT_SCOPE,
        expectedProviderIdempotencyKey: externalProviderRequestId(
          options.operationId,
        ),
        expectedTemplateClaims: options.resumed.providerRequestTemplateClaims,
        expectedEmailDigest: options.emailDigest,
      },
      options.crypto,
    ),
  }
}

async function createAndSettleProviderObject(options: {
  request: ReturnType<typeof openSealedPayPalProviderRequest>
  sealed: SealedPayPalProviderRequest
  recoveryLeaseToken: string | null
  requestContext: SponsorshipCheckoutRequestContext
  dependencies: PayPalSponsorshipCheckoutV2Dependencies
}): Promise<CreatedPayPalProviderObject> {
  const created = await options.dependencies.createProviderObject(
    options.request,
  )
  const expectedType =
    options.request.paymentMode === "one_time"
      ? "order"
      : "billing_subscription"
  if (created.providerObjectType !== expectedType) {
    throw checkoutError("checkout-failed")
  }
  await options.dependencies.settleProviderObject({
    paymentAttemptId: options.request.paymentAttemptId,
    providerObjectType: created.providerObjectType,
    providerObjectId: created.providerObjectId,
    providerRequestSchemaVersion: options.sealed.schemaVersion,
    providerRequestFingerprint: options.sealed.fingerprint,
    providerRequestExpiresAt: options.sealed.expiresAt,
    recoveryLeaseToken: options.recoveryLeaseToken,
    requestContext: options.requestContext,
  })
  return created
}

function checkoutResult(
  created: CreatedPayPalProviderObject,
  checkoutReceipt: string,
): PayPalSponsorshipCheckoutResult {
  return created.providerObjectType === "order"
    ? { kind: "order", orderId: created.providerObjectId, checkoutReceipt }
    : {
        kind: "approval_redirect",
        approvalUrl: created.approvalUrl,
        checkoutReceipt,
      }
}

function assertPayPalCaptureMaterialScope(
  material: PayPalCaptureMaterial,
  expected: {
    operationId: string
    paymentAttemptId: string
    sponsorshipIntentId: string
    paymentQuoteId: string
  },
): void {
  if (
    material.checkoutOperationId !== expected.operationId ||
    material.paymentAttemptId !== expected.paymentAttemptId ||
    material.sponsorshipIntentId !== expected.sponsorshipIntentId ||
    material.paymentQuoteId !== expected.paymentQuoteId ||
    material.providerAccountScope !== PROVIDER_ACCOUNT_SCOPE ||
    material.providerObjectType !== "order" ||
    !PAYPAL_ORDER_ID_PATTERN.test(material.providerObjectId)
  ) {
    throw checkoutError("checkout-failed")
  }
}

export async function createPayPalSponsorshipCheckoutV2(
  input: CreatePayPalSponsorshipCheckoutInput,
  dependencies: PayPalSponsorshipCheckoutV2Dependencies,
): Promise<PayPalSponsorshipCheckoutResult> {
  if (
    !isCheckoutRecord(input.body) ||
    !hasOnlyStartKeys(input.body) ||
    (input.body.action !== undefined && input.body.action !== "start")
  ) {
    throw checkoutError("invalid-request")
  }

  const operationId = requiredCheckoutUuid(input.body.checkoutRequestId)
  const subjectKind = requestedCheckoutSubject(input.body)
  if (subjectKind === "partnership") {
    throw checkoutError("invalid-request")
  }
  const requestedTerms = requestedCheckoutPaymentTerms(input.body.paymentType)
  if (subjectKind === "blind" && requestedTerms.paymentMode === "one_time") {
    throw checkoutError("invalid-request")
  }
  const beneficiaryId =
    subjectKind === "standard"
      ? requiredCheckoutUuid(input.body.beneficiaryId)
      : null
  const currency = selectedCheckoutCurrency(input.body.currency)
  const providerIdempotencyKey = databaseProviderIdempotencyKey(operationId)
  const receipt = dependencies.crypto.deriveCheckoutReceipt(operationId)
  const recoveryScope: RecoverV2CheckoutInput = {
    checkoutReceiptDigest: receipt.digestRpcBytea,
    operationId,
    provider: PROVIDER,
    providerAccountScope: PROVIDER_ACCOUNT_SCOPE,
    providerIdempotencyKey,
  }
  const recovered = await dependencies.recoverCheckout(recoveryScope)
  const beneficiary = beneficiaryId
    ? await dependencies.loadBeneficiary(beneficiaryId, recovered !== null)
    : null
  if (beneficiaryId && (!beneficiary || beneficiary.id !== beneficiaryId)) {
    throw checkoutError("sponsorship-unavailable")
  }

  const baseAmountUsdCents = trustedCheckoutBaseAmount(
    subjectKind,
    beneficiary,
    input.body.amount,
  )
  if (recovered) {
    assertRecoveredSponsorshipCheckoutTerms(recovered, {
      operationId,
      provider: PROVIDER,
      providerAccountScope: PROVIDER_ACCOUNT_SCOPE,
      subjectKind,
      beneficiaryId,
      paymentMode: requestedTerms.paymentMode,
      recurrenceInterval: requestedTerms.recurrenceInterval,
      baseAmountUsdCents,
      chargedCurrency: currency,
    })
  }

  const sponsorEmail =
    input.authenticatedUser?.email ??
    (typeof input.body.email === "string" ? input.body.email : "")
  let emailDigest: ReturnType<SponsorshipCrypto["digestEmail"]>
  try {
    emailDigest = dependencies.crypto.digestEmail(sponsorEmail)
  } catch {
    throw checkoutError("invalid-email")
  }

  const freshConversion = recovered
    ? null
    : convertUsdCentsToCurrency(baseAmountUsdCents, currency)
  const chargedAmountMinor =
    recovered?.chargedAmountMinor ?? freshConversion!.chargedAmountMinor
  const chargedCurrency =
    recovered?.chargedCurrency ?? freshConversion!.chargedCurrency
  const conversionRate =
    recovered?.conversionRate ?? freshConversion!.conversionRate
  const currencyQuoteAt =
    recovered?.currencyQuoteAt ??
    validCheckoutDate(dependencies.now()).toISOString()

  const preparedIntent = await dependencies.prepareIntent({
    checkoutOperationId: operationId,
    checkoutReceiptDigest: receipt.digestRpcBytea,
    provider: PROVIDER,
    providerAccountScope: PROVIDER_ACCOUNT_SCOPE,
    providerIdempotencyKey,
    idempotencyKey: `checkout-v2:${operationId}`,
    source: input.host.source,
    advocateHostname: input.host.advocateHostname,
    visitorTokenDigest: sponsorshipVisitorDigest(
      input.visitorToken,
      dependencies.crypto,
    ),
    authUserId: input.authenticatedUser?.id ?? null,
    contactEmailDigest: emailDigest,
    subjectKind,
    beneficiaryId,
    partnershipProject: null,
    paymentMode: requestedTerms.paymentMode,
    recurrenceInterval: requestedTerms.recurrenceInterval,
    baseAmountUsdCents,
    chargedAmountMinor,
    chargedCurrency,
    conversionRate,
    currencyQuoteAt,
    currencyRateSource: SPONSORSHIP_CURRENCY_RATE_SOURCE,
    requestId: input.requestContext.requestId,
    traceId: input.requestContext.traceId,
  })
  if (
    recovered &&
    preparedIntent.sponsorshipIntentId !== recovered.sponsorshipIntentId
  ) {
    throw checkoutError("checkout-failed")
  }

  let quote = recovered
    ? sponsorshipQuoteFromRecoveredCheckout(recovered)
    : null
  if (!quote) {
    quote = await dependencies.issueQuote({
      checkoutOperationId: operationId,
      sponsorshipIntentId: preparedIntent.sponsorshipIntentId,
      provider: PROVIDER,
      providerAccountScope: PROVIDER_ACCOUNT_SCOPE,
      idempotencyKey: `quote:${operationId}`,
      requestId: input.requestContext.requestId,
      traceId: input.requestContext.traceId,
    })
  }

  if (recovered?.paymentAttemptId) {
    if (recovered.attemptStatus === "succeeded") {
      return {
        kind: "processing",
        statusUrl: statusUrl(input.host.checkoutBaseUrl),
        checkoutReceipt: receipt.token,
      }
    }
    if (
      ["failed", "cancelled", "expired"].includes(
        String(recovered.attemptStatus),
      )
    ) {
      throw checkoutError("sponsorship-unavailable")
    }
    if (
      recovered.attemptStatus === "pending" &&
      recovered.paymentMode === "one_time" &&
      recovered.providerObjectAttached
    ) {
      const material = await dependencies.readAttachedOneTimeOrder({
        checkoutReceiptDigest: receipt.digestRpcBytea,
        operationId,
      })
      assertPayPalCaptureMaterialScope(material, {
        operationId,
        paymentAttemptId: recovered.paymentAttemptId,
        sponsorshipIntentId: recovered.sponsorshipIntentId,
        paymentQuoteId: quote.paymentQuoteId,
      })
      return {
        kind: "order",
        orderId: material.providerObjectId,
        checkoutReceipt: receipt.token,
      }
    }
    const requestStillUsable =
      recovered.recoveryStatus === "available" &&
      recovered.recoveryAttemptCount === 0 &&
      recovered.providerRequestExpiresAt !== null &&
      Date.parse(recovered.providerRequestExpiresAt) >
        validCheckoutDate(dependencies.now()).getTime()
    if (!requestStillUsable) {
      return {
        kind: "processing",
        statusUrl: statusUrl(input.host.checkoutBaseUrl),
        checkoutReceipt: receipt.token,
      }
    }
    const resumed = await dependencies.resumeCheckout({
      ...recoveryScope,
      requestId: input.requestContext.requestId,
      traceId: input.requestContext.traceId,
    })
    assertResumedSponsorshipCheckout(resumed, {
      operationId,
      paymentAttemptId: recovered.paymentAttemptId,
      provider: PROVIDER,
      providerAccountScope: PROVIDER_ACCOUNT_SCOPE,
      providerIdempotencyKey,
      now: dependencies.now(),
    })
    const opened = openResumedRequest({
      resumed,
      operationId,
      paymentAttemptId: recovered.paymentAttemptId,
      sponsorshipIntentId: recovered.sponsorshipIntentId,
      paymentQuoteId: quote.paymentQuoteId,
      emailDigest,
      crypto: dependencies.crypto,
    })
    return checkoutResult(
      await createAndSettleProviderObject({
        ...opened,
        recoveryLeaseToken: resumed.foregroundLeaseToken,
        requestContext: input.requestContext,
        dependencies,
      }),
      receipt.token,
    )
  }

  if (
    Date.parse(quote.expiresAt) <=
    validCheckoutDate(dependencies.now()).getTime()
  ) {
    throw checkoutError("sponsorship-unavailable")
  }
  assertCheckoutQuoteTerms(quote, {
    sponsorshipIntentId: preparedIntent.sponsorshipIntentId,
    provider: PROVIDER,
    providerAccountScope: PROVIDER_ACCOUNT_SCOPE,
    baseAmountUsdCents,
    chargedAmountMinor,
    chargedCurrency,
    conversionRate,
  })

  const productName = sponsorshipCheckoutProductName(
    subjectKind,
    beneficiary,
    requestedTerms.paymentMode,
    requestedTerms.recurrenceInterval,
  ).slice(0, 127)
  const paypalPlanId =
    requestedTerms.paymentMode === "recurring"
      ? (
          await dependencies.ensureBillingPlan({
            terms: {
              subjectKind,
              beneficiaryId,
              productName,
              recurrenceInterval: requestedTerms.recurrenceInterval!,
              baseAmountUsdCents,
              chargedAmountMinor,
              chargedCurrency,
              conversionRate,
              currencyRateSource: SPONSORSHIP_CURRENCY_RATE_SOURCE,
            },
            context: {
              requestId: input.requestContext.requestId,
              traceId: input.requestContext.traceId,
            },
          })
        ).planId
      : null

  if (
    Date.parse(quote.expiresAt) <=
    validCheckoutDate(dependencies.now()).getTime()
  ) {
    throw checkoutError("sponsorship-unavailable")
  }
  const requestExpiresAt = sponsorshipProviderRequestExpiresAt(
    dependencies.now(),
  )
  const template = createPayPalProviderRequestTemplate({
    operationId,
    providerIdempotencyKey: externalProviderRequestId(operationId),
    sponsorshipIntentId: preparedIntent.sponsorshipIntentId,
    paymentQuoteId: quote.paymentQuoteId,
    providerAccountScope: PROVIDER_ACCOUNT_SCOPE,
    customerEmail: emailDigest.normalizedEmail,
    productName,
    paymentMode: requestedTerms.paymentMode,
    recurrenceInterval: requestedTerms.recurrenceInterval,
    baseAmountUsdCents,
    chargedAmountMinor,
    chargedCurrency,
    conversionRate,
    currencyQuoteAt,
    currencyRateSource: SPONSORSHIP_CURRENCY_RATE_SOURCE,
    checkoutBaseUrl: input.host.checkoutBaseUrl,
    paypalPlanId,
    providerRequestExpiresAt: requestExpiresAt,
  })
  const sealed = sealPayPalProviderRequest(template, dependencies.crypto)
  const claims = buildPayPalProviderRequestTemplateClaims(
    template,
    sealed,
    emailDigest,
  )
  const begun = await dependencies.beginPayment({
    checkoutOperationId: operationId,
    sponsorshipIntentId: preparedIntent.sponsorshipIntentId,
    paymentQuoteId: quote.paymentQuoteId,
    provider: PROVIDER,
    providerAccountScope: PROVIDER_ACCOUNT_SCOPE,
    providerIdempotencyKey,
    checkoutReceiptDigest: receipt.digestRpcBytea,
    providerRequest: sealed,
    providerRequestClaims: claims,
    requestContext: input.requestContext,
  })
  assertCheckoutProviderTerms(quote, begun, {
    sponsorshipIntentId: preparedIntent.sponsorshipIntentId,
    provider: PROVIDER,
    providerAccountScope: PROVIDER_ACCOUNT_SCOPE,
    paymentMode: requestedTerms.paymentMode,
    baseAmountUsdCents,
    chargedAmountMinor,
    chargedCurrency,
    conversionRate,
  })
  if (begun.providerRequestExpiresAt !== sealed.expiresAt) {
    throw checkoutError("checkout-failed")
  }

  if (begun.replayed) {
    const resumed = await dependencies.resumeCheckout({
      ...recoveryScope,
      requestId: input.requestContext.requestId,
      traceId: input.requestContext.traceId,
    })
    assertResumedSponsorshipCheckout(resumed, {
      operationId,
      paymentAttemptId: begun.paymentAttemptId,
      provider: PROVIDER,
      providerAccountScope: PROVIDER_ACCOUNT_SCOPE,
      providerIdempotencyKey,
      now: dependencies.now(),
    })
    const opened = openResumedRequest({
      resumed,
      operationId,
      paymentAttemptId: begun.paymentAttemptId,
      sponsorshipIntentId: preparedIntent.sponsorshipIntentId,
      paymentQuoteId: quote.paymentQuoteId,
      emailDigest,
      crypto: dependencies.crypto,
    })
    return checkoutResult(
      await createAndSettleProviderObject({
        ...opened,
        recoveryLeaseToken: resumed.foregroundLeaseToken,
        requestContext: input.requestContext,
        dependencies,
      }),
      receipt.token,
    )
  }

  const request = openSealedPayPalProviderRequest(
    {
      ciphertext: sealed.ciphertext,
      ciphertextSha256: sealed.ciphertextSha256,
      encryptionKeyVersion: sealed.encryptionKeyVersion,
      fingerprint: sealed.fingerprint,
      schemaVersion: sealed.schemaVersion,
      expectedOperationId: operationId,
      expectedPaymentAttemptId: begun.paymentAttemptId,
      expectedSponsorshipIntentId: preparedIntent.sponsorshipIntentId,
      expectedPaymentQuoteId: quote.paymentQuoteId,
      expectedProviderAccountScope: PROVIDER_ACCOUNT_SCOPE,
      expectedProviderIdempotencyKey: externalProviderRequestId(operationId),
      expectedTemplateClaims: claims,
      expectedEmailDigest: emailDigest,
    },
    dependencies.crypto,
  )
  return checkoutResult(
    await createAndSettleProviderObject({
      request,
      sealed,
      recoveryLeaseToken: null,
      requestContext: input.requestContext,
      dependencies,
    }),
    receipt.token,
  )
}

function captureSealedMaterial(
  material: PayPalCaptureMaterial,
): SealedPayPalProviderRequest {
  if (material.providerRequestSchemaVersion !== 1) {
    throw checkoutError("checkout-failed")
  }
  return {
    schemaVersion: 1,
    fingerprint: material.providerRequestFingerprint,
    expiresAt: material.providerRequestExpiresAt,
    ciphertext: material.providerRequestCiphertext,
    encryptionKeyVersion: material.providerRequestEncryptionKeyVersion,
    ciphertextSha256: material.providerRequestCiphertextSha256,
  }
}

function encryptedCapturePayload(
  payload: unknown,
  crypto: SponsorshipCrypto,
): { payloadCiphertext: SupabaseRpcBytea; payloadSha256: SupabaseRpcBytea } {
  let serialized: Buffer
  try {
    const json = JSON.stringify(payload)
    if (typeof json !== "string") throw new Error("Invalid provider payload")
    serialized = Buffer.from(json, "utf8")
  } catch {
    throw checkoutError("checkout-failed")
  }
  try {
    const envelope = crypto.encryptSecretPayload(serialized)
    return {
      payloadCiphertext: envelope.ciphertextRpcBytea,
      payloadSha256: toSupabaseRpcBytea(sha256Digest(serialized)),
    }
  } finally {
    serialized.fill(0)
  }
}

export async function capturePayPalSponsorshipCheckoutV2(
  input: CapturePayPalSponsorshipInput,
  dependencies: CapturePayPalSponsorshipDependencies,
): Promise<CapturePayPalSponsorshipResult> {
  const operationId = requiredCheckoutUuid(input.operationId)
  let checkoutReceiptDigest: SupabaseRpcBytea
  try {
    checkoutReceiptDigest = toSupabaseRpcBytea(
      dependencies.crypto.digestOpaqueToken(input.checkoutReceipt),
    )
  } catch {
    throw checkoutError("invalid-request")
  }
  const recoveryScope: RecoverV2CheckoutInput = {
    checkoutReceiptDigest,
    operationId,
    provider: PROVIDER,
    providerAccountScope: PROVIDER_ACCOUNT_SCOPE,
    providerIdempotencyKey: databaseProviderIdempotencyKey(operationId),
  }
  const recovered = await dependencies.recoverCheckout(recoveryScope)
  if (!recovered) throw checkoutError("invalid-request")
  if (recovered.attemptStatus === "succeeded") {
    return {
      checkoutReceipt: input.checkoutReceipt,
      statusUrl: "/payments/success?provider=paypal",
      replayed: true,
    }
  }
  if (
    !recovered.paymentAttemptId ||
    recovered.attemptStatus !== "pending" ||
    recovered.paymentMode !== "one_time" ||
    !recovered.providerObjectAttached
  ) {
    throw checkoutError("sponsorship-unavailable")
  }

  const material = await dependencies.readCaptureMaterial({
    checkoutReceiptDigest,
    operationId,
  })
  if (!recovered.paymentQuoteId) throw checkoutError("checkout-failed")
  assertPayPalCaptureMaterialScope(material, {
    operationId,
    paymentAttemptId: recovered.paymentAttemptId,
    sponsorshipIntentId: recovered.sponsorshipIntentId,
    paymentQuoteId: recovered.paymentQuoteId,
  })
  const sealed = captureSealedMaterial(material)
  const request = openSealedPayPalProviderRequest(
    {
      ciphertext: sealed.ciphertext,
      ciphertextSha256: sealed.ciphertextSha256,
      encryptionKeyVersion: sealed.encryptionKeyVersion,
      fingerprint: sealed.fingerprint,
      schemaVersion: sealed.schemaVersion,
      expectedOperationId: operationId,
      expectedPaymentAttemptId: material.paymentAttemptId,
      expectedSponsorshipIntentId: material.sponsorshipIntentId,
      expectedPaymentQuoteId: material.paymentQuoteId,
      expectedProviderAccountScope: PROVIDER_ACCOUNT_SCOPE,
      expectedProviderIdempotencyKey: externalProviderRequestId(operationId),
    },
    dependencies.crypto,
  )
  const captured = await dependencies.captureOrder(
    material.providerObjectId,
    request,
  )
  const evidence = encryptedCapturePayload(
    captured.providerPayload,
    dependencies.crypto,
  )
  const observedAt = validCheckoutDate(dependencies.now()).toISOString()
  await dependencies.ingestCapture({
    paymentAttemptId: material.paymentAttemptId,
    providerAccountScope: PROVIDER_ACCOUNT_SCOPE,
    providerEventId: captured.captureId,
    providerObjectId: captured.captureId,
    parentOrderId: captured.orderId,
    redactedPayload: {
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      order_id: captured.orderId,
      capture_id: captured.captureId,
      status: captured.status,
      charged_amount_minor: captured.chargedAmountMinor,
      charged_currency: captured.chargedCurrency,
    },
    payloadCiphertext: evidence.payloadCiphertext,
    payloadSha256: evidence.payloadSha256,
    signatureVerifiedAt: observedAt,
    occurredAt: captured.occurredAt,
    baseAmountUsdCents: request.baseAmountUsdCents,
    chargedAmountMinor: captured.chargedAmountMinor,
    chargedCurrency: captured.chargedCurrency,
    conversionRate: request.conversionRate,
    requestContext: input.requestContext,
  })
  return {
    checkoutReceipt: input.checkoutReceipt,
    statusUrl: "/payments/success?provider=paypal",
    replayed: false,
  }
}

export const defaultPayPalCheckoutProviderDependencies = {
  createProviderObject: createPayPalSponsorshipProviderObject,
  captureOrder: capturePayPalSponsorshipOrder,
  ensureBillingPlan: ensurePayPalBillingPlan,
}
