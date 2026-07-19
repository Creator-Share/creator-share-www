import { readFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { expect, test } from "@playwright/test"

const SCRIPT_PATH = resolve(
  process.cwd(),
  "scripts/audit-stripe-payment-methods.mjs",
)
const LIVE_ENVIRONMENT = {
  STRIPE_SECRET_KEY_US: "sk_live_us_inventory_secret_123456789",
  STRIPE_SECRET_KEY_UK: "sk_live_uk_inventory_secret_987654321",
}

type InventoryModule =
  typeof import("../../scripts/audit-stripe-payment-methods.mjs")
const nativeImport = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<InventoryModule>
let inventory: InventoryModule

test.beforeAll(async () => {
  inventory = await nativeImport(pathToFileURL(SCRIPT_PATH).href)
})

interface SubscriptionFixture {
  id: string
  customer: string | { id: string; deleted?: boolean } | null
  status: string
  collection_method: string
  default_payment_method: string | null
  default_source: string | null
}

interface OperationCall {
  operation: "retrieveAccount" | "listSubscriptions"
  parameters?: Record<string, unknown>
}

function subscription(
  sequence: number,
  status: "active" | "past_due" | "trialing",
  overrides: Partial<SubscriptionFixture> = {},
): SubscriptionFixture {
  return {
    id: `sub_inventory${String(sequence).padStart(12, "0")}`,
    customer: `cus_inventory${String(sequence).padStart(12, "0")}`,
    status,
    collection_method: "charge_automatically",
    default_payment_method: null,
    default_source: null,
    ...overrides,
  }
}

function fakeOperations(options: {
  accountId: string
  subscriptions?: SubscriptionFixture[]
  pageSize?: number
  failure?: Error
  malformedPage?: unknown
}) {
  const calls: OperationCall[] = []
  const subscriptions = options.subscriptions ?? []
  return {
    calls,
    value: {
      async retrieveAccount() {
        calls.push({ operation: "retrieveAccount" })
        if (options.failure) throw options.failure
        return { id: options.accountId }
      },
      async listSubscriptions(parameters: Record<string, unknown>) {
        calls.push({ operation: "listSubscriptions", parameters })
        if (options.failure) throw options.failure
        if (options.malformedPage !== undefined) return options.malformedPage

        const status = String(parameters.status)
        const matching = subscriptions.filter(
          (candidate) => candidate.status === status,
        )
        const startingAfter = parameters.starting_after
        const start =
          typeof startingAfter === "string"
            ? matching.findIndex(
                (candidate) => candidate.id === startingAfter,
              ) + 1
            : 0
        const pageSize = options.pageSize ?? 100
        const data = matching.slice(start, start + pageSize)
        return {
          data,
          has_more: start + data.length < matching.length,
        }
      },
    },
  }
}

function configuredFactory(
  operations: Record<"us" | "uk", ReturnType<typeof fakeOperations>>,
  receivedSecrets: string[],
) {
  return (region: "us" | "uk", secret: string) => {
    receivedSecrets.push(secret)
    return operations[region].value
  }
}

test.describe("Stripe payment method inventory", () => {
  test("audits both live regional accounts and emits aggregate-only clear evidence", async () => {
    const operations = {
      us: fakeOperations({
        accountId: "acct_usinventory123456",
        subscriptions: [subscription(1, "active"), subscription(2, "past_due")],
      }),
      uk: fakeOperations({
        accountId: "acct_ukinventory123456",
        subscriptions: [subscription(3, "trialing")],
      }),
    }
    const receivedSecrets: string[] = []

    const result = await inventory.runStripePaymentMethodInventory({
      environment: LIVE_ENVIRONMENT,
      createOperations: configuredFactory(operations, receivedSecrets),
    })

    expect(result.exitCode).toBe(
      inventory.STRIPE_PAYMENT_METHOD_INVENTORY_EXIT_CLEAR,
    )
    expect(result.report.status).toBe("clear")
    expect(result.report.totals).toEqual({
      subscriptions_scanned: 3,
      automatic_collection: 3,
      unsupported_collection: 0,
      default_payment_method_overrides: 0,
      default_source_overrides: 0,
      subscriptions_with_any_override: 0,
      portal_eligible: 3,
      blockers: 0,
    })
    expect(receivedSecrets).toEqual([
      LIVE_ENVIRONMENT.STRIPE_SECRET_KEY_US,
      LIVE_ENVIRONMENT.STRIPE_SECRET_KEY_UK,
    ])
    for (const region of [operations.us, operations.uk]) {
      expect(region.calls[0]).toEqual({ operation: "retrieveAccount" })
      expect(
        region.calls
          .filter((call) => call.operation === "listSubscriptions")
          .map((call) => call.parameters?.status),
      ).toEqual(["active", "past_due", "trialing"])
    }

    const serialized = inventory.serializeStripePaymentMethodInventoryReport(
      result.report,
    )
    for (const forbidden of ["sk_live_", "acct_", "sub_", "cus_", "pm_"]) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  test("counts override and collection blockers once per subscription", async () => {
    const operations = {
      us: fakeOperations({
        accountId: "acct_usinventory123456",
        subscriptions: [
          subscription(10, "active", {
            default_payment_method: "pm_override000000001",
          }),
          subscription(11, "active", {
            default_source: "card_override00000002",
          }),
          subscription(12, "active", {
            default_payment_method: "pm_override000000003",
            default_source: "card_override00000004",
          }),
          subscription(13, "past_due", {
            collection_method: "send_invoice",
          }),
          subscription(14, "trialing"),
        ],
      }),
      uk: fakeOperations({ accountId: "acct_ukinventory123456" }),
    }

    const result = await inventory.runStripePaymentMethodInventory({
      environment: LIVE_ENVIRONMENT,
      createOperations: configuredFactory(operations, []),
    })

    expect(result.exitCode).toBe(
      inventory.STRIPE_PAYMENT_METHOD_INVENTORY_EXIT_BLOCKED,
    )
    expect(result.report.status).toBe("blocked")
    expect(result.report.totals).toEqual({
      subscriptions_scanned: 5,
      automatic_collection: 4,
      unsupported_collection: 1,
      default_payment_method_overrides: 2,
      default_source_overrides: 2,
      subscriptions_with_any_override: 3,
      portal_eligible: 1,
      blockers: 4,
    })
    const serialized = inventory.serializeStripePaymentMethodInventoryReport(
      result.report,
    )
    for (const forbidden of [
      "sk_live_",
      "acct_",
      "sub_",
      "cus_",
      "pm_",
      "card_",
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  test("redacts provider failures and makes incomplete evidence uncertain", async () => {
    const secret = LIVE_ENVIRONMENT.STRIPE_SECRET_KEY_US
    const operations = {
      us: fakeOperations({
        accountId: "acct_usinventory123456",
        failure: new Error(
          `request failed ${secret} acct_private123 sub_private123`,
        ),
      }),
      uk: fakeOperations({
        accountId: "acct_ukinventory123456",
        subscriptions: [subscription(20, "active")],
      }),
    }

    const result = await inventory.runStripePaymentMethodInventory({
      environment: LIVE_ENVIRONMENT,
      createOperations: configuredFactory(operations, []),
    })
    const serialized = inventory.serializeStripePaymentMethodInventoryReport(
      result.report,
    )

    expect(result.exitCode).toBe(
      inventory.STRIPE_PAYMENT_METHOD_INVENTORY_EXIT_UNCERTAIN,
    )
    expect(result.report.status).toBe("uncertain")
    expect(result.report.totals).toBeNull()
    expect(result.report.regions[0]).toEqual({
      region: "us",
      status: "uncertain",
      uncertainty_reason: "provider-request-failed",
      counts: null,
    })
    expect(serialized).not.toContain(secret)
    expect(serialized).not.toContain("acct_private123")
    expect(serialized).not.toContain("sub_private123")
    expect(serialized).not.toContain("request failed")
  })

  test("fails uncertain for malformed pagination without looping", async () => {
    const operations = {
      us: fakeOperations({
        accountId: "acct_usinventory123456",
        malformedPage: { data: [], has_more: true },
      }),
      uk: fakeOperations({ accountId: "acct_ukinventory123456" }),
    }

    const result = await inventory.runStripePaymentMethodInventory({
      environment: LIVE_ENVIRONMENT,
      createOperations: configuredFactory(operations, []),
    })

    expect(result.exitCode).toBe(
      inventory.STRIPE_PAYMENT_METHOD_INVENTORY_EXIT_UNCERTAIN,
    )
    expect(result.report.regions[0].uncertainty_reason).toBe(
      "malformed-provider-response",
    )
    expect(operations.us.calls).toHaveLength(2)
  })

  test("treats a missing or deleted live subscription customer as provider uncertainty", async () => {
    for (const customer of [
      null,
      { id: "cus_deletedinventory123", deleted: true },
    ]) {
      const operations = {
        us: fakeOperations({
          accountId: "acct_usinventory123456",
          subscriptions: [subscription(25, "active", { customer })],
        }),
        uk: fakeOperations({ accountId: "acct_ukinventory123456" }),
      }

      const result = await inventory.runStripePaymentMethodInventory({
        environment: LIVE_ENVIRONMENT,
        createOperations: configuredFactory(operations, []),
      })

      expect(result.exitCode).toBe(
        inventory.STRIPE_PAYMENT_METHOD_INVENTORY_EXIT_UNCERTAIN,
      )
      expect(result.report.regions[0].uncertainty_reason).toBe(
        "malformed-provider-response",
      )
    }
  })

  test("uses forward pagination and rejects duplicate provider rows", async () => {
    const operations = {
      us: fakeOperations({
        accountId: "acct_usinventory123456",
        subscriptions: [subscription(30, "active"), subscription(31, "active")],
        pageSize: 1,
      }),
      uk: fakeOperations({ accountId: "acct_ukinventory123456" }),
    }

    const result = await inventory.runStripePaymentMethodInventory({
      environment: LIVE_ENVIRONMENT,
      createOperations: configuredFactory(operations, []),
    })

    expect(result.exitCode).toBe(
      inventory.STRIPE_PAYMENT_METHOD_INVENTORY_EXIT_CLEAR,
    )
    const activeCalls = operations.us.calls.filter(
      (call) =>
        call.operation === "listSubscriptions" &&
        call.parameters?.status === "active",
    )
    expect(activeCalls).toHaveLength(2)
    expect(activeCalls[1].parameters).toMatchObject({
      starting_after: "sub_inventory000000000030",
    })

    const duplicate = subscription(40, "active")
    const duplicateOperations = {
      us: fakeOperations({
        accountId: "acct_usinventory123456",
        subscriptions: [duplicate, duplicate],
      }),
      uk: fakeOperations({ accountId: "acct_ukinventory123456" }),
    }
    const duplicateResult = await inventory.runStripePaymentMethodInventory({
      environment: LIVE_ENVIRONMENT,
      createOperations: configuredFactory(duplicateOperations, []),
    })
    expect(duplicateResult.exitCode).toBe(
      inventory.STRIPE_PAYMENT_METHOD_INVENTORY_EXIT_UNCERTAIN,
    )
    expect(duplicateResult.report.regions[0].uncertainty_reason).toBe(
      "malformed-provider-response",
    )
  })

  test("requires two distinct live credentials and two distinct Stripe accounts", async () => {
    let factoryCalls = 0
    const sameSecret = await inventory.runStripePaymentMethodInventory({
      environment: {
        STRIPE_SECRET_KEY_US: LIVE_ENVIRONMENT.STRIPE_SECRET_KEY_US,
        STRIPE_SECRET_KEY_UK: LIVE_ENVIRONMENT.STRIPE_SECRET_KEY_US,
      },
      createOperations() {
        factoryCalls += 1
        throw new Error("must not run")
      },
    })
    expect(sameSecret.exitCode).toBe(
      inventory.STRIPE_PAYMENT_METHOD_INVENTORY_EXIT_UNCERTAIN,
    )
    expect(factoryCalls).toBe(0)
    expect(
      sameSecret.report.regions.map((region) => region.uncertainty_reason),
    ).toEqual([
      "regional-configuration-ambiguous",
      "regional-configuration-ambiguous",
    ])

    const operations = {
      us: fakeOperations({ accountId: "acct_sameinventory12345" }),
      uk: fakeOperations({ accountId: "acct_sameinventory12345" }),
    }
    const sameAccount = await inventory.runStripePaymentMethodInventory({
      environment: LIVE_ENVIRONMENT,
      createOperations: configuredFactory(operations, []),
    })
    expect(sameAccount.exitCode).toBe(
      inventory.STRIPE_PAYMENT_METHOD_INVENTORY_EXIT_UNCERTAIN,
    )
    expect(
      sameAccount.report.regions.map((region) => region.uncertainty_reason),
    ).toEqual([
      "regional-account-identity-ambiguous",
      "regional-account-identity-ambiguous",
    ])
  })

  test("the command exits uncertain without live keys and prints no secret material", () => {
    const childEnvironment = {
      ...process.env,
      STRIPE_SECRET_KEY_US: "",
      STRIPE_SECRET_KEY_UK: "sk_test_not_live",
    } as NodeJS.ProcessEnv & Record<string, string | undefined>
    delete childEnvironment.FORCE_COLOR
    delete childEnvironment.NO_COLOR
    const invocation = spawnSync(
      "yarn",
      ["-s", "audit:stripe-payment-methods"],
      {
        cwd: process.cwd(),
        env: childEnvironment,
        encoding: "utf8",
      },
    )

    expect(invocation.status).toBe(
      inventory.STRIPE_PAYMENT_METHOD_INVENTORY_EXIT_UNCERTAIN,
    )
    expect(invocation.stderr).toBe("")
    const report = JSON.parse(invocation.stdout) as Record<string, unknown>
    expect(report.status).toBe("uncertain")
    expect(invocation.stdout).not.toContain("sk_test_not_live")
  })

  test("the provider adapter is statically read only", async () => {
    const source = await readFile(SCRIPT_PATH, "utf8")

    expect(source).toContain("stripe.accounts.retrieve(")
    expect(source).toContain("stripe.subscriptions.list(")
    expect(source).not.toMatch(/stripe\.[A-Za-z]+\.(?:create|update|del)\(/)
    expect(source).not.toContain("console.")
    expect(source).not.toContain("error.message")
    expect(source).not.toContain("error.stack")
  })
})
