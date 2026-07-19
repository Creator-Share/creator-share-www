import { fileURLToPath } from "node:url"
import { resolve } from "node:path"

import Stripe from "stripe"

const STRIPE_API_VERSION = "2025-02-24.acacia"
const PROVIDER_TIMEOUT_MILLISECONDS = 15_000
const PAGE_LIMIT = 100
const MAXIMUM_PAGES_PER_STATUS = 10_000
const REGIONS = ["us", "uk"]
const LIVE_SUBSCRIPTION_STATUSES = ["active", "past_due", "trialing"]
const SECRET_ENVIRONMENT_KEYS = {
  us: "STRIPE_SECRET_KEY_US",
  uk: "STRIPE_SECRET_KEY_UK",
}
const ACCOUNT_ID_PATTERN = /^acct_[A-Za-z0-9]{8,251}$/
const SUBSCRIPTION_ID_PATTERN = /^sub_[A-Za-z0-9]{8,251}$/

export const STRIPE_PAYMENT_METHOD_INVENTORY_EXIT_CLEAR = 0
export const STRIPE_PAYMENT_METHOD_INVENTORY_EXIT_BLOCKED = 1
export const STRIPE_PAYMENT_METHOD_INVENTORY_EXIT_UNCERTAIN = 2

class InventoryUncertainty extends Error {
  constructor(reason) {
    super(reason)
    this.name = "InventoryUncertainty"
    this.reason = reason
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function emptyCounts() {
  return {
    subscriptions_scanned: 0,
    automatic_collection: 0,
    unsupported_collection: 0,
    default_payment_method_overrides: 0,
    default_source_overrides: 0,
    subscriptions_with_any_override: 0,
    portal_eligible: 0,
    blockers: 0,
  }
}

function addCounts(left, right) {
  const combined = emptyCounts()
  for (const key of Object.keys(combined)) {
    combined[key] = left[key] + right[key]
  }
  return combined
}

function safeProviderReference(value) {
  if (value === null) return false
  if (
    typeof value === "string" &&
    value.length >= 3 &&
    value.length <= 255 &&
    value === value.trim() &&
    !/[\r\n\0]/.test(value)
  ) {
    return true
  }
  if (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.length >= 3 &&
    value.id.length <= 255 &&
    value.id === value.id.trim() &&
    !/[\r\n\0]/.test(value.id)
  ) {
    return true
  }
  throw new InventoryUncertainty("malformed-provider-response")
}

function requireProviderReference(value) {
  if (!safeProviderReference(value)) {
    throw new InventoryUncertainty("malformed-provider-response")
  }
}

function requireCustomerReference(value) {
  if (isRecord(value) && value.deleted === true) {
    throw new InventoryUncertainty("malformed-provider-response")
  }
  requireProviderReference(value)
}

function requireLiveSubscription(value, expectedStatus, seenSubscriptionIds) {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !SUBSCRIPTION_ID_PATTERN.test(value.id) ||
    value.status !== expectedStatus ||
    (value.collection_method !== "charge_automatically" &&
      value.collection_method !== "send_invoice") ||
    !hasOwn(value, "default_payment_method") ||
    !hasOwn(value, "default_source") ||
    !hasOwn(value, "customer") ||
    seenSubscriptionIds.has(value.id)
  ) {
    throw new InventoryUncertainty("malformed-provider-response")
  }

  requireCustomerReference(value.customer)
  const hasDefaultPaymentMethod = safeProviderReference(
    value.default_payment_method,
  )
  const hasDefaultSource = safeProviderReference(value.default_source)
  seenSubscriptionIds.add(value.id)

  return {
    collectionMethod: value.collection_method,
    hasDefaultPaymentMethod,
    hasDefaultSource,
  }
}

function recordSubscription(counts, subscription) {
  counts.subscriptions_scanned += 1
  const hasOverride =
    subscription.hasDefaultPaymentMethod || subscription.hasDefaultSource
  const unsupportedCollection =
    subscription.collectionMethod !== "charge_automatically"

  if (unsupportedCollection) counts.unsupported_collection += 1
  else counts.automatic_collection += 1
  if (subscription.hasDefaultPaymentMethod) {
    counts.default_payment_method_overrides += 1
  }
  if (subscription.hasDefaultSource) counts.default_source_overrides += 1
  if (hasOverride) counts.subscriptions_with_any_override += 1

  if (hasOverride || unsupportedCollection) counts.blockers += 1
  else counts.portal_eligible += 1
}

async function scanStatus(operations, status, counts, seenSubscriptionIds) {
  let startingAfter
  for (let pageNumber = 1; ; pageNumber += 1) {
    if (pageNumber > MAXIMUM_PAGES_PER_STATUS) {
      throw new InventoryUncertainty("pagination-bound-exceeded")
    }

    let page
    try {
      page = await operations.listSubscriptions({
        status,
        limit: PAGE_LIMIT,
        ...(startingAfter === undefined
          ? {}
          : { starting_after: startingAfter }),
      })
    } catch {
      throw new InventoryUncertainty("provider-request-failed")
    }

    if (
      !isRecord(page) ||
      !Array.isArray(page.data) ||
      typeof page.has_more !== "boolean" ||
      (page.has_more && page.data.length === 0) ||
      page.data.length > PAGE_LIMIT
    ) {
      throw new InventoryUncertainty("malformed-provider-response")
    }

    for (const value of page.data) {
      recordSubscription(
        counts,
        requireLiveSubscription(value, status, seenSubscriptionIds),
      )
    }

    if (!page.has_more) return
    const last = page.data[page.data.length - 1]
    if (!isRecord(last) || typeof last.id !== "string") {
      throw new InventoryUncertainty("malformed-provider-response")
    }
    startingAfter = last.id
  }
}

async function auditRegion(region, operations) {
  let account
  try {
    account = await operations.retrieveAccount()
  } catch {
    throw new InventoryUncertainty("provider-request-failed")
  }
  if (
    !isRecord(account) ||
    typeof account.id !== "string" ||
    !ACCOUNT_ID_PATTERN.test(account.id)
  ) {
    throw new InventoryUncertainty("malformed-provider-response")
  }

  const counts = emptyCounts()
  const seenSubscriptionIds = new Set()
  for (const status of LIVE_SUBSCRIPTION_STATUSES) {
    await scanStatus(operations, status, counts, seenSubscriptionIds)
  }

  return {
    accountId: account.id,
    publicResult: {
      region,
      status: counts.blockers === 0 ? "clear" : "blocked",
      uncertainty_reason: null,
      counts,
    },
  }
}

function uncertainRegion(region, reason) {
  return {
    accountId: null,
    publicResult: {
      region,
      status: "uncertain",
      uncertainty_reason: reason,
      counts: null,
    },
  }
}

function validLiveSecret(value) {
  return (
    typeof value === "string" &&
    /^(?:sk|rk)_live_/.test(value) &&
    value.length >= 16 &&
    value.length <= 255 &&
    value === value.trim() &&
    !/[\s\0]/.test(value)
  )
}

export function createStripeReadOperations(_region, secretKey) {
  const stripe = new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION })
  const requestOptions = {
    maxNetworkRetries: 0,
    timeout: PROVIDER_TIMEOUT_MILLISECONDS,
  }
  return {
    retrieveAccount() {
      return stripe.accounts.retrieve({}, requestOptions)
    },
    listSubscriptions(parameters) {
      return stripe.subscriptions.list(parameters, requestOptions)
    },
  }
}

export async function runStripePaymentMethodInventory(options = {}) {
  const environment = options.environment ?? process.env
  const operationsFactory =
    options.createOperations ?? createStripeReadOperations
  const configuredSecrets = Object.fromEntries(
    REGIONS.map((region) => [
      region,
      environment[SECRET_ENVIRONMENT_KEYS[region]],
    ]),
  )

  let outcomes
  if (
    validLiveSecret(configuredSecrets.us) &&
    validLiveSecret(configuredSecrets.uk) &&
    configuredSecrets.us === configuredSecrets.uk
  ) {
    outcomes = REGIONS.map((region) =>
      uncertainRegion(region, "regional-configuration-ambiguous"),
    )
  } else {
    outcomes = await Promise.all(
      REGIONS.map(async (region) => {
        const secret = configuredSecrets[region]
        if (!validLiveSecret(secret)) {
          return uncertainRegion(region, "live-secret-key-missing-or-invalid")
        }

        let operations
        try {
          operations = operationsFactory(region, secret)
        } catch {
          return uncertainRegion(region, "provider-client-unavailable")
        }
        try {
          return await auditRegion(region, operations)
        } catch (error) {
          return uncertainRegion(
            region,
            error instanceof InventoryUncertainty
              ? error.reason
              : "provider-request-failed",
          )
        }
      }),
    )
  }

  if (
    outcomes.every((outcome) => outcome.accountId !== null) &&
    outcomes[0].accountId === outcomes[1].accountId
  ) {
    outcomes = REGIONS.map((region) =>
      uncertainRegion(region, "regional-account-identity-ambiguous"),
    )
  }

  const regions = outcomes.map((outcome) => outcome.publicResult)
  const uncertain = regions.some((region) => region.status === "uncertain")
  const totals = uncertain
    ? null
    : regions.reduce(
        (sum, region) => addCounts(sum, region.counts),
        emptyCounts(),
      )
  const status = uncertain
    ? "uncertain"
    : totals.blockers > 0
      ? "blocked"
      : "clear"
  const exitCode =
    status === "uncertain"
      ? STRIPE_PAYMENT_METHOD_INVENTORY_EXIT_UNCERTAIN
      : status === "blocked"
        ? STRIPE_PAYMENT_METHOD_INVENTORY_EXIT_BLOCKED
        : STRIPE_PAYMENT_METHOD_INVENTORY_EXIT_CLEAR

  return {
    exitCode,
    report: {
      schema_version: "stripe_payment_method_inventory_v1",
      status,
      regions,
      totals,
    },
  }
}

export function serializeStripePaymentMethodInventoryReport(report) {
  return `${JSON.stringify(report, null, 2)}\n`
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null
if (invokedPath === fileURLToPath(import.meta.url)) {
  runStripePaymentMethodInventory()
    .then((result) => {
      process.stdout.write(
        serializeStripePaymentMethodInventoryReport(result.report),
      )
      process.exitCode = result.exitCode
    })
    .catch(() => {
      const report = {
        schema_version: "stripe_payment_method_inventory_v1",
        status: "uncertain",
        regions: REGIONS.map((region) => ({
          region,
          status: "uncertain",
          uncertainty_reason: "unexpected-runtime-failure",
          counts: null,
        })),
        totals: null,
      }
      process.stdout.write(serializeStripePaymentMethodInventoryReport(report))
      process.exitCode = STRIPE_PAYMENT_METHOD_INVENTORY_EXIT_UNCERTAIN
    })
}
