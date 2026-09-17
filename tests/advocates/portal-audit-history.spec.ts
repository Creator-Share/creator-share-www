import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import {
  advocateAuditAreaLabel,
  advocateAuditEventCopy,
  formatAdvocateAuditTimestamp,
} from "../../src/components/advocates/admin/AuditHistory"
import { buildAdvocatePortalNavigation } from "../../src/components/advocates/admin/PortalShell"
import type {
  AdvocateAuditAreaKey,
  AdvocateAuditEventKey,
} from "../../src/lib/advocates/admin/audit"

type AuditModule = typeof import("../../src/lib/advocates/admin/audit")
type PageModule =
  typeof import("../../src/app/(advocate-admin)/portal/[slug]/audit/page")
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
  resolve(process.cwd(), "tests/advocates/portal-audit-history.spec.ts"),
)
const audit = testRequire("../../src/lib/advocates/admin/audit") as AuditModule
nodeModule._load = originalModuleLoad

const ADVOCATE_ID = "11111111-1111-4111-8111-111111111111"
const FIRST_CURSOR = "a2222222-b222-4222-8222-222222222222"
const SECOND_CURSOR = "c3333333-d333-4333-8333-333333333333"

let pageSession: { portals: readonly unknown[] } | null = { portals: [] }
let pagePortal: Record<string, unknown> | null = null
let pageParsedQuery: { beforeCursor: string | null } | null = {
  beforeCursor: null,
}
let pageNoStoreCalls = 0
let pageCreateClientCalls = 0
const pageQueryValues: unknown[] = []
const pageRepositoryCalls: Array<{
  advocateId: string
  beforeCursor: string | null
}> = []

nodeModule._load = function mockedPageModuleLoad(
  this: unknown,
  request: string,
  parent: unknown,
  isMain: boolean,
) {
  if (request === "next/cache") {
    return {
      unstable_noStore() {
        pageNoStoreCalls += 1
      },
    }
  }
  if (request === "next/navigation") {
    return {
      notFound() {
        throw Object.freeze({ kind: "not_found" })
      },
      redirect(href: string) {
        throw Object.freeze({ kind: "redirect", href })
      },
    }
  }
  if (request === "@/components/advocates/admin/AuditHistory") {
    return { AuditHistory: () => null }
  }
  if (request === "@/lib/advocates/admin/access") {
    return {
      async loadAuthenticatedAdvocatePortalSession() {
        return pageSession
      },
      findAdvocatePortalAccessBySlug() {
        return pagePortal
      },
    }
  }
  if (request === "@/lib/advocates/admin/audit") {
    return {
      parseAdvocateAuditHistoryPageQuery(value: unknown) {
        pageQueryValues.push(value)
        return pageParsedQuery
      },
      createAdvocateAuditHistoryRepository() {
        return {
          async load(advocateId: string, beforeCursor: string | null) {
            pageRepositoryCalls.push({ advocateId, beforeCursor })
            return { schemaVersion: 1, nextCursor: null, entries: [] }
          },
        }
      },
    }
  }
  if (request === "@/utils/supabase/server") {
    return {
      async createClient() {
        pageCreateClientCalls += 1
        return {}
      },
    }
  }
  return originalModuleLoad.call(this, request, parent, isMain)
}
const auditPage = testRequire(
  resolve(
    process.cwd(),
    "src/app/(advocate-admin)/portal/[slug]/audit/page.tsx",
  ),
) as PageModule
nodeModule._load = originalModuleLoad

function resetPageHarness() {
  pageSession = { portals: [] }
  pagePortal = {
    advocateId: ADVOCATE_ID,
    slug: "hope",
    displayName: "Hope Creates",
    permissions: ["portal.audit.view", "portal.view"],
  }
  pageParsedQuery = { beforeCursor: null }
  pageNoStoreCalls = 0
  pageCreateClientCalls = 0
  pageQueryValues.length = 0
  pageRepositoryCalls.length = 0
}

const EVENT_AREAS: Readonly<
  Record<AdvocateAuditEventKey, readonly AdvocateAuditAreaKey[]>
> = Object.freeze({
  "portal.created": ["ownership", "portal_lifecycle", "portal_profile"],
  "portal.settings.updated": ["portal_profile"],
  "portal.lifecycle.updated": ["portal_lifecycle"],
  "portal.ownership.transferred": ["ownership"],
  "branding.updated": ["about", "colors", "logo", "opening_header"],
  "catalog.updated": ["catalog_mode", "catalog_order", "catalog_selection"],
  "public_metrics.updated": ["public_metric_selection"],
  "team.invitation.issued": ["invitation"],
  "team.invitation.revoked": ["invitation"],
  "team.invitation.accepted": ["invitation"],
  "team.member.roles_updated": ["member_roles"],
  "team.member.access_updated": ["member_access"],
  "domain.provisioning.requested": [
    "dns",
    "payment_readiness",
    "provider_readiness",
    "tls",
  ],
  "domain.publication.completed": [
    "dns",
    "payment_readiness",
    "provider_readiness",
    "publication",
    "tls",
  ],
  "domain.publication.needs_attention": [
    "dns",
    "payment_readiness",
    "provider_readiness",
    "publication",
    "tls",
  ],
  "domain.deactivated": [
    "dns",
    "payment_readiness",
    "provider_readiness",
    "publication",
    "tls",
  ],
})

function entry(overrides: Record<string, unknown> = {}) {
  return {
    cursor: FIRST_CURSOR,
    occurred_at: "2026-07-19T16:05:06Z",
    event_key: "portal.created",
    actor_kind: "portal_member",
    actor_display_name: "Avery P.",
    areas: EVENT_AREAS["portal.created"],
    ...overrides,
  }
}

function page(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    next_cursor: null,
    entries: [
      entry(),
      entry({
        cursor: SECOND_CURSOR,
        occurred_at: "2026-07-19T15:04:03Z",
        event_key: "branding.updated",
        actor_kind: "creator_share_staff",
        actor_display_name: "Creator Share staff",
        areas: EVENT_AREAS["branding.updated"],
      }),
    ],
    ...overrides,
  }
}

function cursorFor(index: number): string {
  return `40000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`
}

function fullPage() {
  const entries = Array.from(
    { length: audit.ADVOCATE_AUDIT_HISTORY_PAGE_SIZE },
    (_, index) =>
      entry({
        cursor: cursorFor(index + 1),
        occurred_at: `2026-07-19T15:04:${(59 - index)
          .toString()
          .padStart(2, "0")}Z`,
        event_key: "portal.settings.updated",
        areas: EVENT_AREAS["portal.settings.updated"],
      }),
  )
  return {
    schema_version: 1,
    next_cursor: entries.at(-1)?.cursor ?? null,
    entries,
  }
}

test.describe("advocate audit history projection", () => {
  test("parses and freezes only the exact privacy safe page contract", () => {
    const parsed = audit.parseAdvocateAuditHistoryPage(page())

    expect(parsed).toEqual({
      schemaVersion: 1,
      nextCursor: null,
      entries: [
        {
          cursor: FIRST_CURSOR,
          occurredAt: "2026-07-19T16:05:06Z",
          eventKey: "portal.created",
          actorKind: "portal_member",
          actorDisplayName: "Avery P.",
          areas: ["ownership", "portal_lifecycle", "portal_profile"],
        },
        expect.objectContaining({
          cursor: SECOND_CURSOR,
          eventKey: "branding.updated",
          actorKind: "creator_share_staff",
          actorDisplayName: "Creator Share staff",
        }),
      ],
    })
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed?.entries)).toBe(true)
    expect(Object.isFrozen(parsed?.entries[0])).toBe(true)
    expect(Object.isFrozen(parsed?.entries[0]?.areas)).toBe(true)
    expect(JSON.stringify(parsed)).not.toMatch(
      /email|contact|payment|amount|reason|secret|provider|request|trace|session|network|ip_address|user_agent|record_pk/i,
    )
  })

  test("accepts every approved event only with its exact sorted area family", () => {
    for (const eventKey of audit.ADVOCATE_AUDIT_EVENT_KEYS) {
      const parsed = audit.parseAdvocateAuditHistoryPage(
        page({
          entries: [
            entry({
              event_key: eventKey,
              areas: EVENT_AREAS[eventKey],
            }),
          ],
        }),
      )
      expect(parsed?.entries[0]?.eventKey).toBe(eventKey)

      const areas = EVENT_AREAS[eventKey]
      const invalidAreaSets = [
        areas.slice(1),
        [...areas, "portal_profile"],
        areas.length > 1
          ? [...areas].reverse()
          : [areas[0] === "about" ? "colors" : "about"],
      ]
      for (const invalidAreas of invalidAreaSets) {
        expect(
          audit.parseAdvocateAuditHistoryPage(
            page({
              entries: [entry({ event_key: eventKey, areas: invalidAreas })],
            }),
          ),
        ).toBeNull()
      }
    }
  })

  test("rejects unknown keys, smuggled fields, malformed time, and duplicate cursors", () => {
    const invalid = [
      { ...page(), reason: "must not cross" },
      page({ entries: [{ ...entry(), email: "hidden@example.com" }] }),
      page({ schema_version: 2 }),
      page({ entries: [entry({ cursor: FIRST_CURSOR.toUpperCase() })] }),
      page({ entries: [entry({ occurred_at: "2026-07-19T16:05:06.000Z" })] }),
      page({ entries: [entry({ occurred_at: "2026-02-31T16:05:06Z" })] }),
      page({ entries: [entry({ event_key: "payment.updated" })] }),
      page({ entries: [entry({ actor_kind: "sponsor" })] }),
      page({ entries: [entry(), entry({ cursor: FIRST_CURSOR })] }),
    ]
    for (const value of invalid) {
      expect(audit.parseAdvocateAuditHistoryPage(value)).toBeNull()
    }
  })

  test("preserves stable ledger order when concurrent event timestamps invert", () => {
    const parsed = audit.parseAdvocateAuditHistoryPage(
      page({
        entries: [
          entry({ occurred_at: "2026-07-19T15:05:06Z" }),
          entry({
            cursor: SECOND_CURSOR,
            occurred_at: "2026-07-19T17:05:06Z",
          }),
        ],
      }),
    )

    expect(parsed?.entries.map((value) => value.cursor)).toEqual([
      FIRST_CURSOR,
      SECOND_CURSOR,
    ])
  })

  test("pairs actor kinds with bounded noncontact display labels", () => {
    expect(
      audit.parseAdvocateAuditHistoryPage(
        page({
          entries: [
            entry({
              actor_kind: "automation",
              actor_display_name: "Creator Share automation",
            }),
          ],
        }),
      )?.entries[0],
    ).toMatchObject({
      actorKind: "automation",
      actorDisplayName: "Creator Share automation",
    })
    expect(
      audit.parseAdvocateAuditHistoryPage(
        page({
          entries: [entry({ actor_display_name: "Portal team member" })],
        }),
      )?.entries[0]?.actorDisplayName,
    ).toBe("Portal team member")
    expect(
      audit.parseAdvocateAuditHistoryPage(
        page({
          entries: [entry({ actor_display_name: "Mary-Jane O." })],
        }),
      )?.entries[0]?.actorDisplayName,
    ).toBe("Mary-Jane O.")
    expect(
      audit.parseAdvocateAuditHistoryPage(
        page({
          entries: [entry({ actor_display_name: "Abcdefghijklmnopqrstuv X." })],
        }),
      )?.entries[0]?.actorDisplayName,
    ).toBe("Abcdefghijklmnopqrstuv X.")

    const invalidLabels = [
      "Creator Share staff",
      "Creator Share staff A.",
      "Creator Share automation A.",
      "person@example.com",
      "https://example.com/person",
      "www.example.com",
      "<strong>Avery P.</strong>",
      "[Avery P.](https://example.com)",
      "22222222-2222-4222-8222-222222222222",
      "aZ9qP2mR8xT4vN7kL5wB3cD1",
      "Abcdefghijklmnopqrstuvwx",
      "Abcdefghijklmnopqrstuvw X.",
      "Avery 123",
      "Mary--Jane O.",
      "Mary' O.",
      "Avery p.",
      " Avery P.",
      `Avery\u202eP.`,
    ]
    for (const actorDisplayName of invalidLabels) {
      expect(
        audit.parseAdvocateAuditHistoryPage(
          page({ entries: [entry({ actor_display_name: actorDisplayName })] }),
        ),
      ).toBeNull()
    }

    for (const [actorKind, actorDisplayName] of [
      ["creator_share_staff", "Avery P."],
      ["creator_share_staff", "Creator Share automation"],
      ["automation", "Avery P."],
      ["automation", "Creator Share staff"],
    ]) {
      expect(
        audit.parseAdvocateAuditHistoryPage(
          page({
            entries: [
              entry({
                actor_kind: actorKind,
                actor_display_name: actorDisplayName,
              }),
            ],
          }),
        ),
      ).toBeNull()
    }
  })

  test("enforces opaque full-page continuation cursor semantics", () => {
    const valid = fullPage()
    const parsed = audit.parseAdvocateAuditHistoryPage(valid)
    expect(parsed?.entries).toHaveLength(50)
    expect(parsed?.nextCursor).toBe(valid.entries.at(-1)?.cursor)

    expect(
      audit.parseAdvocateAuditHistoryPage(page({ next_cursor: FIRST_CURSOR })),
    ).toBeNull()
    expect(
      audit.parseAdvocateAuditHistoryPage({
        ...valid,
        next_cursor: FIRST_CURSOR,
      }),
    ).toBeNull()
    expect(
      audit.parseAdvocateAuditHistoryPage({
        ...valid,
        entries: [...valid.entries, entry()],
      }),
    ).toBeNull()
  })

  test("strictly accepts only an absent or canonical before cursor", () => {
    expect(audit.parseAdvocateAuditHistoryPageQuery({})).toEqual({
      beforeCursor: null,
    })
    expect(
      audit.parseAdvocateAuditHistoryPageQuery({ before: FIRST_CURSOR }),
    ).toEqual({ beforeCursor: FIRST_CURSOR })

    for (const value of [
      { before: FIRST_CURSOR.toUpperCase() },
      { before: [FIRST_CURSOR] },
      { before: "not-a-cursor" },
      { before: FIRST_CURSOR, search: "Avery" },
      { export: "csv" },
      null,
    ]) {
      expect(audit.parseAdvocateAuditHistoryPageQuery(value)).toBeNull()
    }
  })
})

test.describe("advocate audit history repository", () => {
  test("calls only the authenticated fixed-size audit RPC", async () => {
    const calls: Array<{ name: string; args: unknown }> = []
    const repository = audit.createAdvocateAuditHistoryRepository({
      async rpc(name: string, args: unknown) {
        calls.push({ name, args })
        return { data: page(), error: null }
      },
    } as never)

    await expect(
      repository.load(ADVOCATE_ID, FIRST_CURSOR),
    ).resolves.toMatchObject({ schemaVersion: 1 })
    expect(calls).toEqual([
      {
        name: "get_advocate_audit_history_page",
        args: {
          target_advocate_id: ADVOCATE_ID,
          before_cursor: FIRST_CURSOR,
          page_size: 50,
        },
      },
    ])
  })

  test("fails closed with opaque typed query and shape errors", async () => {
    const queryFailure = audit.createAdvocateAuditHistoryRepository({
      async rpc() {
        return {
          data: null,
          error: { code: "42501", message: "provider secret must not escape" },
        }
      },
    } as never)
    const queryError = await queryFailure
      .load(ADVOCATE_ID, null)
      .catch((error) => error)
    expect(queryError).toMatchObject({
      name: "AdvocateAuditHistoryRepositoryError",
      stage: "query",
      message: "advocate_audit_history_unavailable",
    })
    expect(JSON.stringify(queryError)).not.toMatch(/42501|provider secret/i)

    const transportFailure = audit.createAdvocateAuditHistoryRepository({
      async rpc() {
        throw new Error("network credential must not escape")
      },
    } as never)
    const transportError = await transportFailure
      .load(ADVOCATE_ID, null)
      .catch((error) => error)
    expect(transportError).toMatchObject({
      name: "AdvocateAuditHistoryRepositoryError",
      stage: "query",
      message: "advocate_audit_history_unavailable",
    })
    expect(JSON.stringify(transportError)).not.toMatch(/network credential/i)

    const shapeFailure = audit.createAdvocateAuditHistoryRepository({
      async rpc() {
        return { data: { contact_email: "hidden@example.com" }, error: null }
      },
    } as never)
    await expect(shapeFailure.load(ADVOCATE_ID, null)).rejects.toMatchObject({
      name: "AdvocateAuditHistoryRepositoryError",
      stage: "shape",
      message: "advocate_audit_history_unavailable",
    })

    let rpcCalls = 0
    const invalidInput = audit.createAdvocateAuditHistoryRepository({
      async rpc() {
        rpcCalls += 1
        return { data: page(), error: null }
      },
    } as never)
    await expect(invalidInput.load("not-a-uuid", null)).rejects.toMatchObject({
      stage: "shape",
    })
    await expect(
      invalidInput.load(ADVOCATE_ID, "not-a-cursor"),
    ).rejects.toMatchObject({ stage: "shape" })
    expect(rpcCalls).toBe(0)
  })
})

test.describe("advocate audit history page authorization", () => {
  test.beforeEach(() => resetPageHarness())

  function loadPage(
    searchParams: Record<string, string | string[] | undefined> = {},
  ) {
    return auditPage.default({
      params: Promise.resolve({ slug: "hope" }),
      searchParams: Promise.resolve(searchParams),
    })
  }

  test("redirects a signed-out visitor before resolving portal data", async () => {
    pageSession = null

    await expect(loadPage()).rejects.toEqual({
      kind: "redirect",
      href: "/login",
    })
    expect(pageNoStoreCalls).toBe(1)
    expect(pageQueryValues).toHaveLength(0)
    expect(pageCreateClientCalls).toBe(0)
    expect(pageRepositoryCalls).toHaveLength(0)
  })

  test("conceals inaccessible portals and missing audit permission", async () => {
    pagePortal = null
    await expect(loadPage()).rejects.toEqual({ kind: "not_found" })

    resetPageHarness()
    pagePortal = {
      advocateId: ADVOCATE_ID,
      slug: "hope",
      displayName: "Hope Creates",
      permissions: ["portal.view"],
    }
    await expect(loadPage()).rejects.toEqual({ kind: "not_found" })

    expect(pageNoStoreCalls).toBe(1)
    expect(pageQueryValues).toHaveLength(0)
    expect(pageCreateClientCalls).toBe(0)
    expect(pageRepositoryCalls).toHaveLength(0)
  })

  test("fails a malformed cursor closed before opening a data client", async () => {
    pageParsedQuery = null

    await expect(loadPage({ before: "malformed" })).rejects.toEqual({
      kind: "not_found",
    })
    expect(pageQueryValues).toEqual([{ before: "malformed" }])
    expect(pageCreateClientCalls).toBe(0)
    expect(pageRepositoryCalls).toHaveLength(0)
  })

  test("loads one authorized fixed page with the parsed opaque cursor", async () => {
    pageParsedQuery = { beforeCursor: FIRST_CURSOR }

    await expect(loadPage({ before: FIRST_CURSOR })).resolves.toBeDefined()
    expect(pageNoStoreCalls).toBe(1)
    expect(pageQueryValues).toEqual([{ before: FIRST_CURSOR }])
    expect(pageCreateClientCalls).toBe(1)
    expect(pageRepositoryCalls).toEqual([
      { advocateId: ADVOCATE_ID, beforeCursor: FIRST_CURSOR },
    ])
  })
})

test.describe("advocate audit history administrative UI", () => {
  test("maps event and area keys to fixed semantic copy", () => {
    expect(advocateAuditEventCopy("portal.created")).toEqual({
      title: "Portal created",
      summary: "Creator Share created this advocate portal.",
    })
    expect(
      advocateAuditEventCopy("domain.publication.needs_attention"),
    ).toEqual({
      title: "Domain publication needs attention",
      summary:
        "The portal domain needs attention before publication can finish.",
    })
    expect(advocateAuditAreaLabel("payment_readiness")).toBe(
      "Payment readiness",
    )
    expect(formatAdvocateAuditTimestamp("2026-07-19T16:05:06Z")).toBe(
      "July 19, 2026 at 4:05 PM UTC",
    )
  })

  test("renders an accessible ordered list and relies on React text escaping", () => {
    const componentSource = readFileSync(
      resolve(process.cwd(), "src/components/advocates/admin/AuditHistory.tsx"),
      "utf8",
    )
    const unsafeLabel = "<img src=x onerror=alert(1)>"
    const escaped = renderToStaticMarkup(
      createElement("span", null, unsafeLabel),
    )

    expect(componentSource).toContain("<ol")
    expect(componentSource).toContain("<article")
    expect(componentSource).toContain("<time dateTime={entry.occurredAt}>")
    expect(componentSource).toContain("{entry.actorDisplayName}")
    expect(componentSource).not.toContain("dangerouslySetInnerHTML")
    expect(escaped).toContain("&lt;img src=x onerror=alert(1)&gt;")
    expect(escaped).not.toContain("<img src=x")
  })

  test("provides empty, refresh, and opaque older-page states without controls or export", () => {
    const componentSource = readFileSync(
      resolve(process.cwd(), "src/components/advocates/admin/AuditHistory.tsx"),
      "utf8",
    )

    expect(componentSource).toContain(
      "No privacy-safe activity has been recorded for this portal yet.",
    )
    expect(componentSource).toContain("Refresh history")
    expect(componentSource).toContain("page.nextCursor ?")
    expect(componentSource).toContain("audit?before=${page.nextCursor}")
    expect(componentSource).toContain('rel="next"')
    expect(componentSource).toContain("View older activity")
    for (const omitted of [
      "Sponsor details",
      "contact data",
      "payment values",
      "change reasons",
      "secrets",
      "provider internals",
      "network forensics",
    ]) {
      expect(componentSource).toContain(omitted)
    }
    expect(componentSource).toContain(
      "This privacy-safe history begins with the release that introduced this",
    )
    expect(componentSource).not.toMatch(
      /<input|<select|<textarea|download=|searchParams/i,
    )
  })

  test("enables audit navigation only for members with audit permission", () => {
    const authorized = buildAdvocatePortalNavigation({
      slug: "hope",
      permissions: ["portal.audit.view", "portal.view"],
    })
    expect(authorized.at(-1)).toEqual(
      expect.objectContaining({
        section: "audit",
        href: "/portal/hope/audit",
        availability: "available",
      }),
    )

    const unauthorized = buildAdvocatePortalNavigation({
      slug: "hope",
      permissions: ["portal.view"],
    })
    expect(unauthorized.some((item) => item.section === "audit")).toBe(false)
  })

  test("gates a dynamic no-store page and fails malformed cursors closed", () => {
    const pageSource = readFileSync(
      resolve(
        process.cwd(),
        "src/app/(advocate-admin)/portal/[slug]/audit/page.tsx",
      ),
      "utf8",
    )
    const componentSource = readFileSync(
      resolve(process.cwd(), "src/components/advocates/admin/AuditHistory.tsx"),
      "utf8",
    )

    expect(pageSource).toContain('dynamic = "force-dynamic"')
    expect(pageSource).toContain("revalidate = 0")
    expect(pageSource).toContain("noStore()")
    expect(pageSource).toContain('redirect("/login")')
    expect(pageSource).toContain('permissions.includes("portal.audit.view")')
    expect(pageSource.lastIndexOf("portal.audit.view")).toBeLessThan(
      pageSource.lastIndexOf("createAdvocateAuditHistoryRepository"),
    )
    expect(pageSource).toContain("if (query === null) notFound()")
    expect(componentSource).not.toContain('"use client"')
    expect(`${pageSource}\n${componentSource}`).not.toMatch(
      /sponsor_email|contact_email|payment_amount|change_reason|provider_event|request_id|trace_id|session_id|ip_address|user_agent|before_data|after_data/i,
    )
  })
})
