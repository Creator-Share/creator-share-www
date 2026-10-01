import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"
import { readFileSync } from "node:fs"

import { expect, test } from "@playwright/test"

type PublicCatalogModule =
  typeof import("../../src/lib/advocates/publicCatalog")
type PublicCatalogRepositoryModule =
  typeof import("../../src/lib/advocates/publicCatalogRepository")
type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown

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
  resolve(process.cwd(), "tests/advocates/public-catalog.spec.ts"),
)
const publicCatalog = testRequire(
  "../../src/lib/advocates/publicCatalog",
) as PublicCatalogModule
nodeModule._load = originalModuleLoad

nodeModule._load = function mockedRepositoryModuleLoad(
  this: unknown,
  request: string,
  parent: unknown,
  isMain: boolean,
) {
  if (request === "server-only") return {}
  return originalModuleLoad.call(this, request, parent, isMain)
}
const publicCatalogRepository = testRequire(
  "../../src/lib/advocates/publicCatalogRepository",
) as PublicCatalogRepositoryModule
nodeModule._load = originalModuleLoad

const {
  encodePublicCatalogCursor,
  isPublicBeneficiaryId,
  isPublicBeneficiaryUsername,
  parsePublicBeneficiary,
  parsePublicBeneficiaryActivities,
  parsePublicBeneficiaryMedia,
  parsePublicCatalogPage,
  parsePublicCatalogRequest,
  PublicCatalogRequestError,
  PublicCatalogShapeError,
} = publicCatalog
const { createServiceRolePublicCatalogRepository } = publicCatalogRepository
const paginationHookSource = readFileSync(
  resolve(process.cwd(), "src/hooks/useBeneficiaryPagination.ts"),
  "utf8",
)

const HOSTNAME = "alice.creatorshare.com"
const BENEFICIARY_ID = "11111111-1111-4111-8111-111111111111"
const ACTIVITY_ID = "22222222-2222-4222-8222-222222222222"
const MEDIA_ID = "33333333-3333-4333-8333-333333333333"
const ACTIVITY_MEDIA_ID = "44444444-4444-4444-8444-444444444444"
const DOCUMENT_ID = "55555555-5555-4555-8555-555555555555"
const ACTIVITY_DOCUMENT_ID = "66666666-6666-4666-8666-666666666666"
const CREATED_AT = "2026-07-18T12:00:00Z"

function validItem() {
  return {
    id: BENEFICIARY_ID,
    created_at: CREATED_AT,
    name: "Ada",
    username: "ada",
    gender: "Girl",
    birth_date: "2017-01-01",
    biography: "Biography",
    budget_goal: 3333,
    budget_raised: 0,
    status: "New",
    country: "Tanzania",
    location_str: "Arusha",
    location_geo: { type: "Point", coordinates: [36.68, -3.37] },
    video_url: "",
    introduction: "Introduction",
    active_subscriptions: 0,
    metadata: {
      birth_date_is_estimate: false,
      birth_date_precision: "month",
      private_value: "must not survive",
    },
    beneficiary_type: "CHILD_LABORER",
    goal_fulfilled_at: null,
    sort_weight: 12,
    is_featured: true,
    advocate_display_order: 2,
    unexpected_private_field: "must not survive",
  }
}

function validMedia(
  id: string,
  parentId: string,
  type: "IMAGE" | "VIDEO" | "DOCUMENT" = "IMAGE",
  extension = "jpg",
) {
  return {
    id,
    created_at: CREATED_AT,
    extension,
    parent_id: parentId,
    type,
    weight: 1,
  }
}

function validMediaProjection() {
  return {
    items: [validMedia(MEDIA_ID, BENEFICIARY_ID)],
    hasMore: false,
  }
}

function validActivitiesProjection() {
  return {
    items: [
      {
        id: ACTIVITY_ID,
        created_at: CREATED_AT,
        description: "School supplies arrived.",
        beneficiary_id: BENEFICIARY_ID,
        title: "A good day",
        activity_type: "UPDATE",
        media: [validMedia(ACTIVITY_MEDIA_ID, ACTIVITY_ID)],
      },
    ],
    hasMore: false,
  }
}

test.describe("public catalog request boundary", () => {
  test("normalizes allowlisted filters and preserves literal search punctuation", () => {
    const request = parsePublicCatalogRequest(
      new URLSearchParams({
        beneficiary_type: "SPECIAL_NEEDS,CHILD_LABORER,SPECIAL_NEEDS",
        gender: "Girl",
        status: "Partially Funded,New",
        ageRange: "12,4",
        search: "  25%, (Ada)  ",
        limit: "12",
      }),
      HOSTNAME,
    )

    expect(request).toEqual({
      filters: {
        beneficiaryTypes: ["CHILD_LABORER", "SPECIAL_NEEDS"],
        gender: "Girl",
        statuses: ["New", "Partially Funded"],
        minimumAge: 4,
        maximumAge: 12,
        search: "25%, (Ada)",
        limit: 12,
      },
      cursor: null,
    })
  })

  for (const [field, value] of [
    ["beneficiary_type", "CHILD_LABORER,UNKNOWN"],
    ["gender", "Anyone"],
    ["status", 'New") OR true'],
    ["ageRange", "0,999"],
    ["limit", "61"],
    ["cursor", "not-json"],
  ] as const) {
    test(`rejects an invalid ${field} value`, () => {
      expect(() =>
        parsePublicCatalogRequest(
          new URLSearchParams({ [field]: value }),
          HOSTNAME,
        ),
      ).toThrow(PublicCatalogRequestError)
    })
  }

  test("rejects nonpublic administrative statuses before the RPC", () => {
    expect(() =>
      parsePublicCatalogRequest(
        new URLSearchParams({ status: "Draft" }),
        HOSTNAME,
      ),
    ).toThrow(PublicCatalogRequestError)
  })

  test("keeps request control characters strict", () => {
    expect(() =>
      parsePublicCatalogRequest(
        new URLSearchParams({ search: "Ada\nAnother value" }),
        HOSTNAME,
      ),
    ).toThrow(PublicCatalogRequestError)
  })

  test("binds an opaque cursor to the exact host and normalized filters", () => {
    const first = parsePublicCatalogRequest(
      new URLSearchParams({ status: "New", limit: "3" }),
      HOSTNAME,
    )
    const cursor = encodePublicCatalogCursor(HOSTNAME, first.filters, {
      featureBucket: 0,
      displayOrder: 2,
      createdAt: CREATED_AT,
      id: BENEFICIARY_ID,
    })

    expect(
      parsePublicCatalogRequest(
        new URLSearchParams({ status: "New", limit: "3", cursor }),
        HOSTNAME,
      ).cursor,
    ).toEqual({
      featureBucket: 0,
      displayOrder: 2,
      createdAt: CREATED_AT,
      id: BENEFICIARY_ID,
    })
    expect(() =>
      parsePublicCatalogRequest(
        new URLSearchParams({ status: "New", limit: "3", cursor }),
        "bob.creatorshare.com",
      ),
    ).toThrow(PublicCatalogRequestError)
    expect(() =>
      parsePublicCatalogRequest(
        new URLSearchParams({ status: "Partially Funded", limit: "3", cursor }),
        HOSTNAME,
      ),
    ).toThrow(PublicCatalogRequestError)
  })
})

test.describe("purpose-specific public beneficiary projections", () => {
  test("allowlists the beneficiary profile and accepts stored multiline text", () => {
    const source = validItem()
    source.biography = "First paragraph.\n\nSecond paragraph."
    source.introduction = "A short line.\r\nA second line.\tIndented."

    const beneficiary = parsePublicBeneficiary(source)

    expect(beneficiary?.id).toBe(BENEFICIARY_ID)
    expect(beneficiary?.biography).toBe("First paragraph.\n\nSecond paragraph.")
    expect(beneficiary?.introduction).toBe(
      "A short line.\r\nA second line.\tIndented.",
    )
    expect(JSON.stringify(beneficiary)).not.toContain(
      "unexpected_private_field",
    )
    expect(JSON.stringify(beneficiary)).not.toContain("private_value")

    source.biography = "Invalid\u000btext"
    expect(() => parsePublicBeneficiary(source)).toThrow(
      PublicCatalogShapeError,
    )
  })

  test("accepts bounded legacy types and rejects private statuses or malformed usernames", () => {
    for (const beneficiaryType of [
      "FAMILY",
      "STREET_INVOLVED",
      null,
    ] as const) {
      expect(
        parsePublicBeneficiary({
          ...validItem(),
          beneficiary_type: beneficiaryType,
        })?.beneficiary_type,
      ).toBe(beneficiaryType)
    }

    for (const malformed of [
      { ...validItem(), beneficiary_type: "street-involved" },
      { ...validItem(), username: "u".repeat(161) },
      { ...validItem(), username: " padded-username" },
      { ...validItem(), username: "control\nusername" },
      { ...validItem(), username: "path/username" },
      { ...validItem(), username: "query?username" },
      { ...validItem(), username: "fragment#username" },
      { ...validItem(), username: "." },
      { ...validItem(), username: ".." },
      { ...validItem(), username: "checkout" },
      { ...validItem(), username: "CHECKOUT" },
      { ...validItem(), username: "padded\u00a0" },
      { ...validItem(), username: "\ufeffpadded" },
      { ...validItem(), username: "control\u0085username" },
      { ...validItem(), username: "😀".repeat(100) },
      { ...validItem(), name: "Unsafe\u0085name" },
      { ...validItem(), biography: "😀".repeat(25_001) },
      { ...validItem(), country: "Unsafe\ncountry" },
      { ...validItem(), location_str: "Unsafe\nlocation" },
      { ...validItem(), video_url: "Unsafe\u0001video" },
      { ...validItem(), introduction: "Unsafe\u0085introduction" },
      { ...validItem(), status: "Draft" },
      { ...validItem(), status: "Archived" },
    ]) {
      expect(() => parsePublicBeneficiary(malformed)).toThrow(
        PublicCatalogShapeError,
      )
    }
  })

  test("parses complete direct media and rejects truncation or cross-parent data", () => {
    const source = validMediaProjection()
    source.items.push(
      validMedia(DOCUMENT_ID, BENEFICIARY_ID, "DOCUMENT", "pdf"),
    )

    expect(
      parsePublicBeneficiaryMedia(source, BENEFICIARY_ID)?.map(
        (media) => media.type,
      ),
    ).toEqual(["IMAGE", "DOCUMENT"])

    expect(() =>
      parsePublicBeneficiaryMedia({ ...source, hasMore: true }, BENEFICIARY_ID),
    ).toThrow(PublicCatalogShapeError)
    expect(() =>
      parsePublicBeneficiaryMedia(
        {
          ...source,
          items: [validMedia(MEDIA_ID, ACTIVITY_ID)],
        },
        BENEFICIARY_ID,
      ),
    ).toThrow(PublicCatalogShapeError)
    expect(() =>
      parsePublicBeneficiaryMedia(
        {
          ...source,
          items: [validMedia(MEDIA_ID, BENEFICIARY_ID, "IMAGE", "bad/ext")],
        },
        BENEFICIARY_ID,
      ),
    ).toThrow(PublicCatalogShapeError)
    expect(() =>
      parsePublicBeneficiaryMedia(
        {
          items: Array(501).fill(validMedia(MEDIA_ID, BENEFICIARY_ID)),
          hasMore: false,
        },
        BENEFICIARY_ID,
      ),
    ).toThrow(PublicCatalogShapeError)
  })

  test("parses complete activity history with multiline and document data", () => {
    const source = validActivitiesProjection()
    source.items[0].description = "Update one.\nUpdate two."
    source.items[0].title = "A title\nwith a deliberate line break"
    source.items[0].media.push(
      validMedia(ACTIVITY_DOCUMENT_ID, ACTIVITY_ID, "DOCUMENT", "pdf"),
    )

    const activities = parsePublicBeneficiaryActivities(source, BENEFICIARY_ID)

    expect(activities?.[0]?.description).toBe("Update one.\nUpdate two.")
    expect(activities?.[0]?.title).toBe("A title\nwith a deliberate line break")
    expect(activities?.[0]?.media.map((media) => media.type)).toEqual([
      "IMAGE",
      "DOCUMENT",
    ])
  })

  test("rejects malformed, truncated, or excessively large activity projections", () => {
    const withPrivateField = validActivitiesProjection()
    withPrivateField.items[0] = {
      ...withPrivateField.items[0],
      user_id: "55555555-5555-4555-8555-555555555555",
    } as (typeof withPrivateField.items)[number]
    expect(() =>
      parsePublicBeneficiaryActivities(withPrivateField, BENEFICIARY_ID),
    ).toThrow(PublicCatalogShapeError)

    expect(() =>
      parsePublicBeneficiaryActivities(
        { ...validActivitiesProjection(), hasMore: true },
        BENEFICIARY_ID,
      ),
    ).toThrow(PublicCatalogShapeError)

    const excessive = validActivitiesProjection()
    excessive.items = Array(101).fill(excessive.items[0])
    expect(() =>
      parsePublicBeneficiaryActivities(excessive, BENEFICIARY_ID),
    ).toThrow(PublicCatalogShapeError)

    const excessiveMedia = validActivitiesProjection()
    excessiveMedia.items = [
      {
        ...excessiveMedia.items[0],
        media: Array(251).fill(validMedia(ACTIVITY_MEDIA_ID, ACTIVITY_ID)),
      },
      {
        ...excessiveMedia.items[0],
        id: "77777777-7777-4777-8777-777777777777",
        media: Array(250).fill(
          validMedia(
            "88888888-8888-4888-8888-888888888888",
            "77777777-7777-4777-8777-777777777777",
          ),
        ),
      },
    ]
    expect(() =>
      parsePublicBeneficiaryActivities(excessiveMedia, BENEFICIARY_ID),
    ).toThrow(PublicCatalogShapeError)

    for (const malformed of [
      { title: "Unsafe\u0085title" },
      { description: "😀".repeat(25_001) },
      { activity_type: "PRIVATE" },
      {
        media: [validMedia(ACTIVITY_MEDIA_ID, ACTIVITY_ID, "IMAGE", "bad/ext")],
      },
    ]) {
      const source = validActivitiesProjection()
      source.items[0] = { ...source.items[0], ...malformed }
      expect(() =>
        parsePublicBeneficiaryActivities(source, BENEFICIARY_ID),
      ).toThrow(PublicCatalogShapeError)
    }
  })

  test("validates route identifiers before they reach typed RPCs", () => {
    expect(isPublicBeneficiaryUsername("ada")).toBe(true)
    expect(isPublicBeneficiaryUsername("u".repeat(160))).toBe(true)
    expect(isPublicBeneficiaryUsername("u".repeat(161))).toBe(false)
    expect(isPublicBeneficiaryUsername(" ada ")).toBe(false)
    expect(isPublicBeneficiaryUsername("line\nbreak")).toBe(false)
    expect(isPublicBeneficiaryUsername("path/segment")).toBe(false)
    expect(isPublicBeneficiaryUsername("query?value")).toBe(false)
    expect(isPublicBeneficiaryUsername("fragment#value")).toBe(false)
    expect(isPublicBeneficiaryUsername(".")).toBe(false)
    expect(isPublicBeneficiaryUsername("..")).toBe(false)
    expect(isPublicBeneficiaryUsername("checkout")).toBe(false)
    expect(isPublicBeneficiaryUsername("CHECKOUT")).toBe(false)
    expect(isPublicBeneficiaryUsername("padded\u00a0")).toBe(false)
    expect(isPublicBeneficiaryUsername("\ufeffpadded")).toBe(false)
    expect(isPublicBeneficiaryUsername("control\u0085value")).toBe(false)
    expect(isPublicBeneficiaryUsername("😀".repeat(100))).toBe(false)
    expect(isPublicBeneficiaryId(BENEFICIARY_ID)).toBe(true)
    expect(isPublicBeneficiaryId("not-a-uuid")).toBe(false)
  })

  test("treats null as a generic missing projection", () => {
    expect(parsePublicBeneficiary(null)).toBeNull()
    expect(parsePublicBeneficiaryMedia(null, BENEFICIARY_ID)).toBeNull()
    expect(parsePublicBeneficiaryActivities(null, BENEFICIARY_ID)).toBeNull()
  })
})

test.describe("purpose-specific public beneficiary repository", () => {
  test("uses only the narrow host-gated service RPC for each route", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = []
    const client = {
      async rpc(name: string, args: Record<string, unknown>) {
        calls.push({ name, args })
        return { data: {}, error: null }
      },
    }
    const repository = createServiceRolePublicCatalogRepository(client as never)

    await repository.loadPrimaryBeneficiaryByUsername("ada")
    await repository.loadAdvocateBeneficiaryByUsername(HOSTNAME, "ada")
    await repository.loadPrimaryBeneficiaryMediaById(BENEFICIARY_ID)
    await repository.loadAdvocateBeneficiaryMediaById(HOSTNAME, BENEFICIARY_ID)
    await repository.loadPrimaryBeneficiaryActivitiesById(BENEFICIARY_ID)
    await repository.loadAdvocateBeneficiaryActivitiesById(
      HOSTNAME,
      BENEFICIARY_ID,
    )

    expect(calls).toEqual([
      {
        name: "read_primary_public_beneficiary_by_username",
        args: { target_username: "ada" },
      },
      {
        name: "read_public_advocate_beneficiary_by_username",
        args: { target_hostname: HOSTNAME, target_username: "ada" },
      },
      {
        name: "read_primary_public_beneficiary_media_by_id",
        args: { target_beneficiary_id: BENEFICIARY_ID },
      },
      {
        name: "read_public_advocate_beneficiary_media_by_id",
        args: {
          target_hostname: HOSTNAME,
          target_beneficiary_id: BENEFICIARY_ID,
        },
      },
      {
        name: "read_primary_public_beneficiary_activities_by_id",
        args: { target_beneficiary_id: BENEFICIARY_ID },
      },
      {
        name: "read_public_advocate_beneficiary_activities_by_id",
        args: {
          target_hostname: HOSTNAME,
          target_beneficiary_id: BENEFICIARY_ID,
        },
      },
    ])
  })
})

test.describe("host-aware beneficiary deep routes", () => {
  const routePaths = [
    "src/app/api/beneficiaries/get/username/[username]/route.ts",
    "src/app/api/beneficiaries/images/[id]/route.ts",
    "src/app/api/beneficiaries/[id]/activities/route.ts",
  ]

  for (const routePath of routePaths) {
    test(`${routePath} resolves the exact site before serving its projection`, () => {
      const source = readFileSync(resolve(process.cwd(), routePath), "utf8")
      expect(source).toContain("resolvePublicSiteRequest")
      expect(source).toContain("createServiceRolePublicCatalogRepository")
      expect(source).toContain(
        '"Cache-Control": "private, no-store, max-age=0"',
      )
      expect(source).toContain('Vary: "Host"')
      expect(source).not.toContain('.from("public_')
      expect(source).not.toContain("error.message")
      expect(source).not.toContain("Bundle")
    })
  }

  test("each route loads and parses only the projection it returns", () => {
    const usernameRoute = readFileSync(
      resolve(process.cwd(), routePaths[0]),
      "utf8",
    )
    const mediaRoute = readFileSync(
      resolve(process.cwd(), routePaths[1]),
      "utf8",
    )
    const activitiesRoute = readFileSync(
      resolve(process.cwd(), routePaths[2]),
      "utf8",
    )

    expect(usernameRoute).toContain("loadAdvocateBeneficiaryByUsername")
    expect(usernameRoute).toContain("loadPrimaryBeneficiaryByUsername")
    expect(usernameRoute).toContain("parsePublicBeneficiary")
    expect(usernameRoute).not.toContain("BeneficiaryMedia")
    expect(usernameRoute).not.toContain("BeneficiaryActivities")

    expect(mediaRoute).toContain("loadAdvocateBeneficiaryMediaById")
    expect(mediaRoute).toContain("loadPrimaryBeneficiaryMediaById")
    expect(mediaRoute).toContain("parsePublicBeneficiaryMedia")
    expect(mediaRoute).not.toContain("BeneficiaryActivities")

    expect(activitiesRoute).toContain("loadAdvocateBeneficiaryActivitiesById")
    expect(activitiesRoute).toContain("loadPrimaryBeneficiaryActivitiesById")
    expect(activitiesRoute).toContain("parsePublicBeneficiaryActivities")
    expect(activitiesRoute).not.toContain("BeneficiaryMediaById")
  })

  test("keeps document handling explicit in the existing public route shapes", () => {
    const imageRoute = readFileSync(
      resolve(process.cwd(), "src/app/api/beneficiaries/images/[id]/route.ts"),
      "utf8",
    )
    const activityRoute = readFileSync(
      resolve(
        process.cwd(),
        "src/app/api/beneficiaries/[id]/activities/route.ts",
      ),
      "utf8",
    )

    expect(imageRoute).toContain("return json(existingMedia)")
    expect(activityRoute).toContain('if (media.type === "IMAGE")')
    expect(activityRoute).toContain('if (media.type === "VIDEO")')
    expect(activityRoute).not.toContain('media.type === "DOCUMENT"')
    expect(activityRoute).not.toContain("filterExistingMediaRows")
  })

  test("preserves primary discovery behavior without scrambling advocate ordering", () => {
    expect(paginationHookSource).toContain(
      'if (publicSite.kind === "primary") shuffle(people)',
    )
    expect(paginationHookSource).toContain(
      'if (publicSite.kind === "advocate" && !isAdminMode) return',
    )
  })

  test("preserves the superadmin waiting filter for open sponsorships", () => {
    const routeSource = readFileSync(
      resolve(process.cwd(), "src/app/api/beneficiaries/get/route.ts"),
      "utf8",
    )
    expect(routeSource).toContain(
      "and(budget_goal.eq.-1,status.not.in.(Draft,Archived))",
    )
    expect(routeSource).toContain('(status) => status !== "Budget Fulfilled"')
  })
})

test.describe("public catalog response boundary", () => {
  test("returns only allowlisted beneficiary fields and seals the next cursor", () => {
    const request = parsePublicCatalogRequest(
      new URLSearchParams({ limit: "3" }),
      HOSTNAME,
    )
    const page = parsePublicCatalogPage(
      {
        items: [validItem()],
        totalCount: 8,
        pageInfo: {
          limit: 3,
          hasMore: true,
          nextCursor: {
            featureBucket: 0,
            displayOrder: 2,
            createdAt: CREATED_AT,
            id: BENEFICIARY_ID,
          },
        },
      },
      HOSTNAME,
      request.filters,
    )

    expect(page?.people).toHaveLength(1)
    const serialized = JSON.stringify(page)
    expect(serialized).not.toContain("unexpected_private_field")
    expect(serialized).not.toContain("private_value")
    expect(page?.pageInfo.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  test("treats null as an unavailable tenant without inventing primary data", () => {
    const request = parsePublicCatalogRequest(new URLSearchParams(), HOSTNAME)
    expect(parsePublicCatalogPage(null, HOSTNAME, request.filters)).toBeNull()
  })

  test("fails closed on malformed page and cursor shapes", () => {
    const request = parsePublicCatalogRequest(new URLSearchParams(), HOSTNAME)
    expect(() =>
      parsePublicCatalogPage(
        {
          items: [validItem()],
          totalCount: 1,
          pageInfo: { limit: 9, hasMore: false, nextCursor: {} },
        },
        HOSTNAME,
        request.filters,
      ),
    ).toThrow(PublicCatalogShapeError)
  })
})
