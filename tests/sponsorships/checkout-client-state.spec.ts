import { expect, test } from "@playwright/test"

import {
  clearCheckoutClientState,
  loadOrCreateCheckoutOperation,
  persistCheckoutReceipt,
  readCheckoutReceipt,
  type CheckoutOperationScope,
  type CheckoutStorage,
} from "../../src/lib/sponsorships/checkout/clientState"

const NOW = new Date("2026-07-18T10:00:00.000Z")
const FIRST_ID = "11111111-1111-4111-8111-111111111111"
const SECOND_ID = "22222222-2222-4222-8222-222222222222"
const RECEIPT = Buffer.alloc(32, 7).toString("base64url")

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

const scope: CheckoutOperationScope = {
  provider: "stripe",
  subject: "standard",
  beneficiaryId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  partnershipProject: null,
  paymentType: "subscription",
  baseAmountUsdCents: 3333,
  currency: "USD",
}

test.describe("sponsorship checkout client retry state", () => {
  test("reuses one exact recent operation across a lost response", () => {
    const storage = new MemoryStorage()
    const first = loadOrCreateCheckoutOperation({
      storage,
      scope,
      now: NOW,
      createOperationId: () => FIRST_ID,
    })
    const replay = loadOrCreateCheckoutOperation({
      storage,
      scope: { ...scope },
      now: new Date(NOW.getTime() + 5 * 60 * 1000),
      createOperationId: () => SECOND_ID,
    })

    expect(replay).toEqual(first)
    expect(replay.operationId).toBe(FIRST_ID)
  })

  test("creates a new operation when any provider term changes", () => {
    const mutations: CheckoutOperationScope[] = [
      { ...scope, provider: "paypal" },
      {
        ...scope,
        subject: "blind",
        beneficiaryId: null,
        partnershipProject: null,
      },
      {
        ...scope,
        subject: "partnership",
        beneficiaryId: null,
        partnershipProject: "education",
      },
      {
        ...scope,
        beneficiaryId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      },
      { ...scope, paymentType: "one_time" },
      { ...scope, baseAmountUsdCents: 4500 },
      { ...scope, currency: "GBP" },
    ]

    for (const changedScope of mutations) {
      const storage = new MemoryStorage()
      loadOrCreateCheckoutOperation({
        storage,
        scope,
        now: NOW,
        createOperationId: () => FIRST_ID,
      })
      expect(
        loadOrCreateCheckoutOperation({
          storage,
          scope: changedScope,
          now: NOW,
          createOperationId: () => SECOND_ID,
        }).operationId,
      ).toBe(SECOND_ID)
    }
  })

  test("expires stale or malformed retry state instead of adopting it", () => {
    const storage = new MemoryStorage()
    loadOrCreateCheckoutOperation({
      storage,
      scope,
      now: new Date(NOW.getTime() - 61 * 60 * 1000),
      createOperationId: () => FIRST_ID,
    })

    expect(
      loadOrCreateCheckoutOperation({
        storage,
        scope,
        now: NOW,
        createOperationId: () => SECOND_ID,
      }).operationId,
    ).toBe(SECOND_ID)

    for (const malformed of [
      "not-json",
      JSON.stringify({ version: 1, operationId: "not-a-uuid" }),
      JSON.stringify({
        version: 1,
        operationId: FIRST_ID,
        createdAt: NOW.toISOString(),
        scope: { ...scope, currency: "usd" },
      }),
    ]) {
      const malformedStorage = new MemoryStorage()
      malformedStorage.values.set(
        "creator-share:sponsorship-checkout-operation:v1",
        malformed,
      )
      expect(
        loadOrCreateCheckoutOperation({
          storage: malformedStorage,
          scope,
          now: NOW,
          createOperationId: () => SECOND_ID,
        }).operationId,
      ).toBe(SECOND_ID)
    }
  })

  test("stores and reads only a canonical opaque receipt", () => {
    const storage = new MemoryStorage()
    expect(
      persistCheckoutReceipt({
        storage,
        operationId: FIRST_ID,
        receipt: RECEIPT,
        now: NOW,
      }),
    ).toBe(true)
    expect(readCheckoutReceipt({ storage, now: NOW })).toEqual({
      receipt: RECEIPT,
      operationId: FIRST_ID,
      storedAt: NOW.toISOString(),
    })

    expect(
      persistCheckoutReceipt({
        storage,
        operationId: FIRST_ID,
        receipt: "cs_test_session_should_not_be_stored_here",
        now: NOW,
      }),
    ).toBe(false)
  })

  test("fails safely when tab storage is unavailable", () => {
    const deniedStorage: CheckoutStorage = {
      getItem() {
        throw new Error("denied")
      },
      setItem() {
        throw new Error("denied")
      },
      removeItem() {
        throw new Error("denied")
      },
    }

    expect(
      loadOrCreateCheckoutOperation({
        storage: deniedStorage,
        scope,
        now: NOW,
        createOperationId: () => FIRST_ID,
      }).operationId,
    ).toBe(FIRST_ID)
    expect(
      persistCheckoutReceipt({
        storage: deniedStorage,
        operationId: FIRST_ID,
        receipt: RECEIPT,
        now: NOW,
      }),
    ).toBe(false)
    expect(readCheckoutReceipt({ storage: deniedStorage, now: NOW })).toBeNull()
    expect(() => clearCheckoutClientState(deniedStorage)).not.toThrow()
  })

  test("clears operation and receipt together only after terminal handling", () => {
    const storage = new MemoryStorage()
    loadOrCreateCheckoutOperation({
      storage,
      scope,
      now: NOW,
      createOperationId: () => FIRST_ID,
    })
    persistCheckoutReceipt({
      storage,
      operationId: FIRST_ID,
      receipt: RECEIPT,
      now: NOW,
    })

    expect(storage.values.size).toBe(2)
    clearCheckoutClientState(storage)
    expect(storage.values.size).toBe(0)
  })
})
