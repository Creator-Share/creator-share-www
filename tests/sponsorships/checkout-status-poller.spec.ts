import { expect, test } from "@playwright/test"

import {
  CHECKOUT_STATUS_POLL_DELAYS_MS,
  clearTerminalCheckoutClientState,
  pollCheckoutStatus,
  resolvePaymentReturnMode,
} from "../../src/lib/sponsorships/checkout/checkoutStatusPoller"
import {
  loadOrCreateCheckoutOperation,
  persistCheckoutReceipt,
  type CheckoutStorage,
} from "../../src/lib/sponsorships/checkout/clientState"

const receipt = {
  provider: "paypal" as const,
  receipt: Buffer.alloc(32, 3).toString("base64url"),
  operationId: "11111111-1111-4111-8111-111111111111",
  storedAt: "2026-07-18T12:00:00.000Z",
}

class MemoryStorage implements CheckoutStorage {
  readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

test.describe("payment return classification", () => {
  test("uses every v2 opaque receipt before any legacy provider callback", () => {
    expect(
      resolvePaymentReturnMode({
        receipt,
        providerMarker: "paypal",
        stripeSessionId: null,
        paypalSubscriptionId: "I-RETURNED",
        paypalToken: "provider-token",
        paypalEnabled: true,
      }),
    ).toEqual({ kind: "opaque", receipt })

    const stripeReceipt = { ...receipt, provider: "stripe" as const }
    expect(
      resolvePaymentReturnMode({
        receipt: stripeReceipt,
        providerMarker: null,
        stripeSessionId: "cs_legacy_value",
        paypalSubscriptionId: null,
        paypalToken: null,
        paypalEnabled: true,
      }),
    ).toEqual({ kind: "opaque", receipt: stripeReceipt })
  })

  test("fails a marked v2 PayPal return closed when tab storage is missing", () => {
    expect(
      resolvePaymentReturnMode({
        receipt: null,
        providerMarker: "paypal",
        stripeSessionId: "cs_attacker_supplied_legacy_session",
        paypalSubscriptionId: "I-V2-SUBSCRIPTION",
        paypalToken: "v2-token",
        paypalEnabled: true,
      }),
    ).toEqual({ kind: "v2_paypal_receipt_missing" })
  })

  test("preserves unmarked legacy PayPal verification during warm drain", () => {
    expect(
      resolvePaymentReturnMode({
        receipt: null,
        providerMarker: null,
        stripeSessionId: null,
        paypalSubscriptionId: "I-LEGACY-SUBSCRIPTION",
        paypalToken: null,
        paypalEnabled: true,
      }),
    ).toEqual({
      kind: "legacy_paypal",
      subscriptionId: "I-LEGACY-SUBSCRIPTION",
      token: null,
    })
  })
})

test.describe("opaque checkout status polling", () => {
  test("waits beyond one worker schedule with a bounded request count", () => {
    const totalDelay = CHECKOUT_STATUS_POLL_DELAYS_MS.reduce(
      (total, delay) => total + delay,
      0,
    )
    expect(totalDelay).toBe(87_000)
    expect(CHECKOUT_STATUS_POLL_DELAYS_MS.length + 1).toBeLessThanOrEqual(12)
  })

  test("survives transient reads and stops on signed terminal success", async () => {
    let reads = 0
    const waits: number[] = []
    const progress: string[] = []
    const result = await pollCheckoutStatus({
      async readStatus() {
        reads += 1
        if (reads === 1) throw new Error("temporary outage")
        if (reads === 2) return { status: "pending", terminal: false }
        return { status: "succeeded", terminal: true }
      },
      async wait(milliseconds) {
        waits.push(milliseconds)
      },
      onProgress(status) {
        progress.push(status)
      },
      isCancelled: () => false,
      delays: [100, 200, 300],
    })

    expect(result).toBe("succeeded")
    expect(reads).toBe(3)
    expect(waits).toEqual([100, 200])
    expect(progress).toEqual(["processing"])
  })

  test("returns unknown only after the complete bounded schedule", async () => {
    let reads = 0
    const waits: number[] = []
    const result = await pollCheckoutStatus({
      async readStatus() {
        reads += 1
        return { status: "unknown", terminal: false }
      },
      async wait(milliseconds) {
        waits.push(milliseconds)
      },
      onProgress() {},
      isCancelled: () => false,
      delays: [100, 200],
    })

    expect(result).toBe("unknown")
    expect(reads).toBe(3)
    expect(waits).toEqual([100, 200])
  })

  test("clears both local operation and receipt on either terminal result", () => {
    for (const terminalStatus of ["succeeded", "failed"] as const) {
      const storage = new MemoryStorage()
      loadOrCreateCheckoutOperation({
        storage,
        scope: {
          provider: "paypal",
          subject: "standard",
          beneficiaryId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          partnershipProject: null,
          paymentType: "subscription",
          baseAmountUsdCents: 3333,
          currency: "USD",
        },
        now: new Date(receipt.storedAt),
        createOperationId: () => receipt.operationId,
      })
      persistCheckoutReceipt({
        storage,
        provider: "paypal",
        operationId: receipt.operationId,
        receipt: receipt.receipt,
        now: new Date(receipt.storedAt),
      })
      expect(storage.values.size).toBe(2)
      expect(clearTerminalCheckoutClientState(storage, terminalStatus)).toBe(
        true,
      )
      expect(storage.values.size).toBe(0)
    }
  })
})
