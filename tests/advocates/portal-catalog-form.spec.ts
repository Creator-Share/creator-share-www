import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

import {
  advocateCatalogFingerprint,
  isValidAdvocateCatalogConfiguration,
  MAX_ADVOCATE_CATALOG_SELECTIONS,
  moveAdvocateCatalogSelection,
  normalizeAdvocateCatalogSelections,
  parseAdvocateCatalogDraft,
  parseAdvocateCatalogSaveResponse,
  selectionsForAdvocateCatalogMode,
} from "../../src/lib/advocates/admin/catalogForm"

type CatalogModule = typeof import("../../src/lib/advocates/admin/catalog")
type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown

const ACTOR_ID = "11111111-1111-4111-8111-111111111111"
const ADVOCATE_ID = "22222222-2222-4222-8222-222222222222"
const FIRST_ID = "33333333-3333-4333-8333-333333333333"
const SECOND_ID = "44444444-4444-4444-8444-444444444444"
const REQUEST_ID = "55555555-5555-4555-8555-555555555555"
const TRACE_ID = "66666666-6666-4666-8666-666666666666"

const nodeModule = Module as unknown as { _load: NodeModuleLoader }
const originalModuleLoad = nodeModule._load
nodeModule._load = function mockedModuleLoad(
  this: unknown,
  request: string,
  parent: unknown,
  isMain: boolean,
) {
  if (request === "server-only") return {}
  return originalModuleLoad.call(this, request, parent, isMain)
}
const testRequire = createRequire(
  resolve(process.cwd(), "tests/advocates/portal-catalog-form.spec.ts"),
)
const catalog = testRequire(
  resolve(process.cwd(), "src/lib/advocates/admin/catalog.ts"),
) as CatalogModule
nodeModule._load = originalModuleLoad

function choices() {
  return [
    {
      id: FIRST_ID,
      name: "Alice",
      username: "alice",
      status: "New",
      eligible: true,
      blocked_reason: null,
    },
    {
      id: SECOND_ID,
      name: null,
      username: null,
      status: null,
      eligible: false,
      blocked_reason: "unavailable",
    },
  ]
}

function updateBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    expectedVersion: 7,
    mode: "selected",
    beneficiaryIds: [FIRST_ID, SECOND_ID],
    featuredBeneficiaryIds: [SECOND_ID],
    changeReason: "Feature Bea and preserve the requested catalog order.",
    ...overrides,
  })
}

test.describe("advocate catalog form boundary", () => {
  test("normalizes only exact unique ordered selection objects", () => {
    const value = [
      { beneficiaryId: FIRST_ID, isFeatured: false },
      { beneficiaryId: SECOND_ID, isFeatured: true },
    ]
    const normalized = normalizeAdvocateCatalogSelections(value)
    expect(normalized).toEqual(value)
    expect(Object.isFrozen(normalized)).toBe(true)
    expect(Object.isFrozen(normalized?.[0])).toBe(true)

    for (const invalid of [
      [{ beneficiaryId: "bad", isFeatured: false }],
      [{ beneficiaryId: FIRST_ID, isFeatured: "yes" }],
      [{ beneficiaryId: FIRST_ID, isFeatured: false, displayOrder: 0 }],
      [
        { beneficiaryId: FIRST_ID, isFeatured: false },
        { beneficiaryId: FIRST_ID, isFeatured: true },
      ],
      Array.from(
        { length: MAX_ADVOCATE_CATALOG_SELECTIONS + 1 },
        (_, index) => ({
          beneficiaryId: `${index}`,
          isFeatured: false,
        }),
      ),
    ]) {
      expect(normalizeAdvocateCatalogSelections(invalid)).toBeNull()
    }
  })

  test("enforces all three exact catalog mode invariants", () => {
    const selected = [
      { beneficiaryId: FIRST_ID, isFeatured: false },
      { beneficiaryId: SECOND_ID, isFeatured: true },
    ]
    expect(isValidAdvocateCatalogConfiguration("all", [])).toBe(true)
    expect(isValidAdvocateCatalogConfiguration("all", selected)).toBe(false)
    expect(isValidAdvocateCatalogConfiguration("all_featured", [])).toBe(false)
    expect(isValidAdvocateCatalogConfiguration("all_featured", selected)).toBe(
      false,
    )
    expect(
      isValidAdvocateCatalogConfiguration("all_featured", [
        { beneficiaryId: FIRST_ID, isFeatured: true },
      ]),
    ).toBe(true)
    expect(isValidAdvocateCatalogConfiguration("selected", [])).toBe(false)
    expect(isValidAdvocateCatalogConfiguration("selected", selected)).toBe(true)

    expect(selectionsForAdvocateCatalogMode("all", selected)).toEqual([])
    expect(selectionsForAdvocateCatalogMode("all_featured", selected)).toEqual([
      { beneficiaryId: FIRST_ID, isFeatured: true },
      { beneficiaryId: SECOND_ID, isFeatured: true },
    ])
    expect(selectionsForAdvocateCatalogMode("selected", selected)).toEqual(
      selected,
    )
  })

  test("restores only an exact actor and catalog-bound draft", () => {
    const savedSelections = [
      { beneficiaryId: FIRST_ID, isFeatured: false },
      { beneficiaryId: SECOND_ID, isFeatured: true },
    ] as const
    const savedFingerprint = advocateCatalogFingerprint(
      "selected",
      savedSelections,
    )
    const expected = {
      advocateId: ADVOCATE_ID,
      actorUserId: ACTOR_ID,
      advocateVersion: 7,
      savedFingerprint,
      allowedBeneficiaryIds: new Set([FIRST_ID, SECOND_ID]),
      selectionLimit: MAX_ADVOCATE_CATALOG_SELECTIONS,
    }
    const validDraft = {
      schemaVersion: 2,
      advocateId: ADVOCATE_ID,
      actorUserId: ACTOR_ID,
      advocateVersion: 7,
      savedFingerprint,
      mode: "selected",
      selections: [{ beneficiaryId: FIRST_ID, isFeatured: true }],
      changeReason: "Finish this catalog update after returning.",
    }

    expect(parseAdvocateCatalogDraft(validDraft, expected)).toEqual(validDraft)
    expect(
      parseAdvocateCatalogDraft(
        { ...validDraft, advocateVersion: 6 },
        expected,
      ),
    ).toEqual(validDraft)
    expect(
      parseAdvocateCatalogDraft(
        { ...validDraft, selections: [], changeReason: "Choose a child next" },
        expected,
      ),
    ).toEqual({
      ...validDraft,
      selections: [],
      changeReason: "Choose a child next",
    })

    for (const invalid of [
      { ...validDraft, schemaVersion: 1 },
      {
        ...validDraft,
        advocateId: "77777777-7777-4777-8777-777777777777",
      },
      {
        ...validDraft,
        actorUserId: "88888888-8888-4888-8888-888888888888",
      },
      { ...validDraft, advocateVersion: -1 },
      { ...validDraft, advocateVersion: 7.5 },
      { ...validDraft, savedFingerprint: "stale" },
      { ...validDraft, extra: true },
      {
        ...validDraft,
        selections: [
          {
            beneficiaryId: "77777777-7777-4777-8777-777777777777",
            isFeatured: false,
          },
        ],
      },
      {
        ...validDraft,
        mode: "all",
        selections: [{ beneficiaryId: FIRST_ID, isFeatured: false }],
      },
      {
        ...validDraft,
        selections: savedSelections,
        changeReason: "Not actually dirty",
      },
      { ...validDraft, changeReason: "unsafe\u0000reason" },
    ]) {
      expect(parseAdvocateCatalogDraft(invalid, expected)).toBeNull()
    }
  })

  test("moves ordered selections without crossing list boundaries", () => {
    const selected = [
      { beneficiaryId: FIRST_ID, isFeatured: false },
      { beneficiaryId: SECOND_ID, isFeatured: true },
    ] as const
    expect(moveAdvocateCatalogSelection(selected, SECOND_ID, "up")).toEqual([
      selected[1],
      selected[0],
    ])
    expect(moveAdvocateCatalogSelection(selected, FIRST_ID, "down")).toEqual([
      selected[1],
      selected[0],
    ])
    expect(moveAdvocateCatalogSelection(selected, FIRST_ID, "up")).toBe(
      selected,
    )
    expect(moveAdvocateCatalogSelection(selected, "missing", "down")).toBe(
      selected,
    )
    expect(advocateCatalogFingerprint("selected", selected)).not.toBe(
      advocateCatalogFingerprint("selected", [...selected].reverse()),
    )
  })

  test("strictly parses save responses with one exact version increment", () => {
    expect(
      parseAdvocateCatalogSaveResponse(
        { ok: true, requestId: REQUEST_ID, advocateVersion: 8 },
        7,
      ),
    ).toEqual({ ok: true, requestId: REQUEST_ID, advocateVersion: 8 })
    expect(
      parseAdvocateCatalogSaveResponse(
        { ok: false, requestId: REQUEST_ID, code: "version_conflict" },
        7,
      ),
    ).toEqual({
      ok: false,
      requestId: REQUEST_ID,
      code: "version_conflict",
    })

    for (const value of [
      { ok: true, requestId: REQUEST_ID, advocateVersion: 7 },
      { ok: true, requestId: REQUEST_ID, advocateVersion: 9 },
      {
        ok: true,
        requestId: REQUEST_ID,
        advocateVersion: 8,
        sponsorEmail: "must-not-cross@example.com",
      },
      {
        ok: false,
        requestId: REQUEST_ID,
        code: "forbidden",
        details: "tenant internals",
      },
      { ok: true, requestId: "bad", advocateVersion: 8 },
    ]) {
      expect(parseAdvocateCatalogSaveResponse(value, 7)).toBeNull()
    }
  })
})

test.describe("advocate catalog server boundary", () => {
  test("accepts only the fixed sponsor-free administration projection", () => {
    expect(
      catalog.parseAdvocateCatalogAdministration({
        advocate_version: 7,
        beneficiary_mode: "selected",
        beneficiary_selections: [
          { beneficiary_id: FIRST_ID, is_featured: false },
          { beneficiary_id: SECOND_ID, is_featured: true },
        ],
        beneficiaries: choices(),
        selection_limit: 1_000,
      }),
    ).toEqual({
      advocateVersion: 7,
      mode: "selected",
      selections: [
        { beneficiaryId: FIRST_ID, isFeatured: false },
        { beneficiaryId: SECOND_ID, isFeatured: true },
      ],
      beneficiaries: [
        {
          id: FIRST_ID,
          name: "Alice",
          username: "alice",
          status: "New",
          eligible: true,
          blockedReason: null,
        },
        {
          id: SECOND_ID,
          name: null,
          username: null,
          status: null,
          eligible: false,
          blockedReason: "unavailable",
        },
      ],
      selectionLimit: 1_000,
    })

    const invalid = [
      {
        advocate_version: 7,
        beneficiary_mode: "selected",
        beneficiary_selections: [
          { beneficiary_id: FIRST_ID, is_featured: false },
          { beneficiary_id: SECOND_ID, is_featured: true },
        ],
        beneficiaries: choices(),
        selection_limit: 999,
      },
      {
        advocate_version: 7,
        beneficiary_mode: "selected",
        beneficiary_selections: [
          { beneficiary_id: FIRST_ID, is_featured: false },
          { beneficiary_id: SECOND_ID, is_featured: true },
        ],
        beneficiaries: choices(),
        selection_limit: 1_000,
        sponsor_email: "must-not-cross@example.com",
      },
      {
        advocate_version: 7,
        beneficiary_mode: "selected",
        beneficiary_selections: [
          { beneficiary_id: FIRST_ID, is_featured: false },
          { beneficiary_id: SECOND_ID, is_featured: true },
        ],
        beneficiaries: [choices()[0], choices()[0]],
        selection_limit: 1_000,
      },
      {
        advocate_version: 7,
        beneficiary_mode: "selected",
        beneficiary_selections: [
          { beneficiary_id: FIRST_ID, is_featured: false },
        ],
        beneficiaries: [{ ...choices()[0], sponsor_identity_id: ADVOCATE_ID }],
        selection_limit: 1_000,
      },
      {
        advocate_version: 7,
        beneficiary_mode: "selected",
        beneficiary_selections: [
          { beneficiary_id: FIRST_ID, is_featured: false },
        ],
        beneficiaries: [{ ...choices()[0], username: "checkout" }],
        selection_limit: 1_000,
      },
      {
        advocate_version: 7,
        beneficiary_mode: "selected",
        beneficiary_selections: [
          { beneficiary_id: FIRST_ID, is_featured: false },
          { beneficiary_id: SECOND_ID, is_featured: true },
        ],
        beneficiaries: [
          choices()[0],
          {
            id: SECOND_ID,
            name: "Private former selection",
            username: "private-former-selection",
            status: "Archived",
            eligible: false,
            blocked_reason: "not_sponsorable",
          },
        ],
        selection_limit: 1_000,
      },
    ]
    for (const value of invalid) {
      expect(catalog.parseAdvocateCatalogAdministration(value)).toBeNull()
    }
  })

  test("strictly parses ordered mode updates and rejects shape smuggling", () => {
    expect(catalog.parseAdvocateCatalogUpdateInput(updateBody())).toEqual({
      expectedVersion: 7,
      mode: "selected",
      beneficiaryIds: [FIRST_ID, SECOND_ID],
      featuredBeneficiaryIds: [SECOND_ID],
      changeReason: "Feature Bea and preserve the requested catalog order.",
    })
    expect(
      catalog.parseAdvocateCatalogUpdateInput(
        updateBody({
          mode: "all",
          beneficiaryIds: [],
          featuredBeneficiaryIds: [],
        }),
      ),
    ).toMatchObject({ mode: "all", beneficiaryIds: [] })
    expect(
      catalog.parseAdvocateCatalogUpdateInput(
        updateBody({
          mode: "all_featured",
          beneficiaryIds: [FIRST_ID, SECOND_ID],
          featuredBeneficiaryIds: [FIRST_ID, SECOND_ID],
        }),
      ),
    ).toMatchObject({ mode: "all_featured" })

    for (const invalid of [
      updateBody({ unexpected: true }),
      updateBody({ expectedVersion: 0 }),
      updateBody({ mode: "featured" }),
      updateBody({ beneficiaryIds: [FIRST_ID, FIRST_ID] }),
      updateBody({ featuredBeneficiaryIds: [ADVOCATE_ID] }),
      updateBody({
        mode: "all",
        beneficiaryIds: [FIRST_ID],
        featuredBeneficiaryIds: [],
      }),
      updateBody({
        mode: "all_featured",
        beneficiaryIds: [FIRST_ID],
        featuredBeneficiaryIds: [],
      }),
      updateBody({
        mode: "selected",
        beneficiaryIds: [],
        featuredBeneficiaryIds: [],
      }),
      updateBody({ changeReason: "   " }),
      updateBody({ changeReason: "x".repeat(501) }),
      updateBody({ changeReason: "bad\nreason" }),
      "[]",
      "not-json",
    ]) {
      expect(catalog.parseAdvocateCatalogUpdateInput(invalid)).toBeNull()
    }
  })

  test("bounds and strictly decodes the streamed request", async () => {
    await expect(
      catalog.readBoundedAdvocateCatalogBody(
        new Request("https://creatorshare.com/api/portal/hope/catalog", {
          method: "POST",
          body: updateBody(),
        }),
      ),
    ).resolves.toBe(updateBody())

    const oversized = "x".repeat(catalog.MAX_ADVOCATE_CATALOG_BODY_BYTES + 1)
    await expect(
      catalog.readBoundedAdvocateCatalogBody(
        new Request("https://creatorshare.com/api/portal/hope/catalog", {
          method: "POST",
          body: oversized,
        }),
      ),
    ).resolves.toBeNull()
    await expect(
      catalog.readBoundedAdvocateCatalogBody(
        new Request("https://creatorshare.com/api/portal/hope/catalog", {
          method: "POST",
          body: Uint8Array.from([0xc3, 0x28]),
        }),
      ),
    ).resolves.toBeNull()
  })

  test("maps only static database outcomes", () => {
    expect(
      catalog.classifyAdvocateCatalogUpdateFailure(
        "22023",
        "Advocate beneficiary configuration is unchanged",
      ),
    ).toEqual({ status: 409, code: "no_change" })
    expect(
      catalog.classifyAdvocateCatalogUpdateFailure("22023", "other"),
    ).toEqual({ status: 400, code: "invalid_request" })
    expect(
      catalog.classifyAdvocateCatalogUpdateFailure("42501", "secret"),
    ).toEqual({ status: 403, code: "forbidden" })
    expect(
      catalog.classifyAdvocateCatalogUpdateFailure("23514", "secret"),
    ).toEqual({ status: 409, code: "eligibility_changed" })
    expect(
      catalog.classifyAdvocateCatalogUpdateFailure("40001", "secret"),
    ).toEqual({ status: 409, code: "version_conflict" })
    expect(
      catalog.classifyAdvocateCatalogUpdateFailure("XX000", "secret"),
    ).toEqual({ status: 500, code: "catalog_update_failed" })
  })

  test("uses only the actor-aware service read and replacement RPCs", async () => {
    const calls: Array<{ name: string; input: unknown }> = []
    const client = {
      async rpc(name: string, input: unknown) {
        calls.push({ name, input })
        if (name === "read_advocate_catalog_administration") {
          return {
            data: {
              advocate_version: 7,
              beneficiary_mode: "selected",
              beneficiary_selections: [
                { beneficiary_id: FIRST_ID, is_featured: false },
                { beneficiary_id: SECOND_ID, is_featured: true },
              ],
              beneficiaries: choices(),
              selection_limit: 1_000,
            },
            error: null,
          }
        }
        return { data: 8, error: null }
      },
    }

    await expect(
      catalog.loadAdvocateCatalogAdministration(client as never, {
        advocateId: ADVOCATE_ID,
        actorUserId: ACTOR_ID,
      }),
    ).resolves.toMatchObject({ selectionLimit: 1_000 })
    const input = catalog.parseAdvocateCatalogUpdateInput(updateBody())
    expect(input).not.toBeNull()
    if (input === null) return
    await expect(
      catalog.replaceAdvocateCatalogConfiguration(client as never, {
        advocateId: ADVOCATE_ID,
        actorUserId: ACTOR_ID,
        input,
        requestId: REQUEST_ID,
        traceId: TRACE_ID,
        sessionId: null,
        clientIp: null,
        userAgent: null,
      }),
    ).resolves.toBe(8)

    expect(calls).toEqual([
      {
        name: "read_advocate_catalog_administration",
        input: {
          target_advocate_id: ADVOCATE_ID,
          acting_user_id: ACTOR_ID,
        },
      },
      {
        name: "replace_advocate_beneficiary_configuration",
        input: {
          target_advocate_id: ADVOCATE_ID,
          acting_user_id: ACTOR_ID,
          expected_advocate_version: 7,
          target_beneficiary_mode: "selected",
          target_beneficiary_ids: [FIRST_ID, SECOND_ID],
          target_featured_beneficiary_ids: [SECOND_ID],
          change_reason:
            "Feature Bea and preserve the requested catalog order.",
          request_id: REQUEST_ID,
          trace_id: TRACE_ID,
          session_id: null,
          client_ip: null,
          user_agent: null,
        },
      },
    ])
  })
})
