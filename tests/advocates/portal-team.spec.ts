import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

import {
  parseAdvocateTeam,
  parseAdvocateTeamMemberMutation,
} from "../../src/lib/advocates/admin/teamContracts"

type TeamModule = typeof import("../../src/lib/advocates/admin/team")
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
  resolve(process.cwd(), "tests/advocates/portal-team.spec.ts"),
)
const teamModule = testRequire(
  "../../src/lib/advocates/admin/team",
) as TeamModule
nodeModule._load = originalModuleLoad

const ADVOCATE_ID = "11111111-1111-4111-8111-111111111111"
const OWNER_MEMBERSHIP_ID = "22222222-2222-4222-8222-222222222222"
const DELEGATE_MEMBERSHIP_ID = "33333333-3333-4333-8333-333333333333"

const OWNER_ROW = Object.freeze({
  membership_id: OWNER_MEMBERSHIP_ID,
  member_display_name: "Aubrey F.",
  membership_status: "active",
  role_keys: ["administrator", "owner"],
  membership_version: 4,
  is_owner: true,
  membership_created_at: "2026-07-18T01:00:00+00:00",
  membership_updated_at: "2026-07-18T02:00:00+00:00",
})

const DELEGATE_ROW = Object.freeze({
  membership_id: DELEGATE_MEMBERSHIP_ID,
  member_display_name: "Alex R.",
  membership_status: "suspended",
  role_keys: ["analytics_viewer", "brand_editor"],
  membership_version: "7",
  is_owner: false,
  membership_created_at: "2026-07-18T03:00:00+00:00",
  membership_updated_at: "2026-07-18T04:00:00+00:00",
})

test.describe("advocate team projection boundary", () => {
  test("parses only the exact privacy-limited team projection", () => {
    const team = parseAdvocateTeam([OWNER_ROW, DELEGATE_ROW])

    expect(team).toEqual([
      {
        membershipId: OWNER_MEMBERSHIP_ID,
        displayName: "Aubrey F.",
        status: "active",
        roleKeys: ["administrator", "owner"],
        version: 4,
        isOwner: true,
        createdAt: "2026-07-18T01:00:00+00:00",
        updatedAt: "2026-07-18T02:00:00+00:00",
      },
      {
        membershipId: DELEGATE_MEMBERSHIP_ID,
        displayName: "Alex R.",
        status: "suspended",
        roleKeys: ["analytics_viewer", "brand_editor"],
        version: 7,
        isOwner: false,
        createdAt: "2026-07-18T03:00:00+00:00",
        updatedAt: "2026-07-18T04:00:00+00:00",
      },
    ])
    expect(Object.isFrozen(team)).toBe(true)
    expect(Object.isFrozen(team?.[0])).toBe(true)
    expect(Object.isFrozen(team?.[0].roleKeys)).toBe(true)
    expect(JSON.stringify(team)).not.toMatch(
      /email|user_id|sponsor|contact|visitor|provider/i,
    )
  })

  test("rejects extra identity fields and malformed lifecycle or role rows", () => {
    const invalidRows = [
      { ...DELEGATE_ROW, email: "must-not-cross@example.com" },
      { ...DELEGATE_ROW, user_id: OWNER_MEMBERSHIP_ID },
      { ...DELEGATE_ROW, membership_id: "not-a-uuid" },
      { ...DELEGATE_ROW, member_display_name: " Alex R." },
      { ...DELEGATE_ROW, member_display_name: "A\nR" },
      { ...DELEGATE_ROW, membership_status: "invited" },
      {
        ...DELEGATE_ROW,
        role_keys: ["brand_editor", "analytics_viewer"],
      },
      {
        ...DELEGATE_ROW,
        role_keys: ["brand_editor", "brand_editor"],
      },
      { ...DELEGATE_ROW, role_keys: ["owner"], is_owner: false },
      { ...DELEGATE_ROW, role_keys: ["unknown"] },
      { ...DELEGATE_ROW, membership_version: 0 },
      { ...DELEGATE_ROW, membership_version: Number.MAX_SAFE_INTEGER + 1 },
      {
        ...DELEGATE_ROW,
        membership_updated_at: "2026-07-17T04:00:00+00:00",
      },
      { ...OWNER_ROW, membership_status: "suspended" },
      { ...OWNER_ROW, role_keys: ["administrator"], is_owner: true },
    ]
    for (const row of invalidRows) {
      expect(parseAdvocateTeam([row])).toBeNull()
    }
    expect(parseAdvocateTeam([{ ...DELEGATE_ROW, role_keys: [] }])).toEqual([
      expect.objectContaining({
        membershipId: DELEGATE_MEMBERSHIP_ID,
        isOwner: false,
        roleKeys: [],
      }),
    ])
    expect(parseAdvocateTeam([DELEGATE_ROW, DELEGATE_ROW])).toBeNull()
    expect(parseAdvocateTeam(new Array(1_001).fill(DELEGATE_ROW))).toBeNull()
  })

  test("accepts exact role and status mutations and normalizes role order", () => {
    expect(
      parseAdvocateTeamMemberMutation(
        JSON.stringify({
          action: "replace_roles",
          expectedVersion: 7,
          roleKeys: ["brand_editor", "administrator"],
          reason: "Align access with current responsibilities.",
        }),
      ),
    ).toEqual({
      action: "replace_roles",
      expectedVersion: 7,
      roleKeys: ["administrator", "brand_editor"],
      reason: "Align access with current responsibilities.",
    })
    expect(
      parseAdvocateTeamMemberMutation(
        JSON.stringify({
          action: "change_status",
          expectedVersion: 7,
          status: "revoked",
          reason: "The delegate no longer works with this advocate.",
        }),
      ),
    ).toEqual({
      action: "change_status",
      expectedVersion: 7,
      status: "revoked",
      reason: "The delegate no longer works with this advocate.",
    })
  })

  test("rejects ambiguous, owner, duplicate, oversized, and reasonless mutations", () => {
    const base = {
      action: "replace_roles",
      expectedVersion: 7,
      roleKeys: ["brand_editor"],
      reason: "Update access.",
    }
    for (const value of [
      {},
      { ...base, unexpected: true },
      { ...base, expectedVersion: 0 },
      { ...base, roleKeys: [] },
      { ...base, roleKeys: ["owner"] },
      { ...base, roleKeys: ["brand_editor", "brand_editor"] },
      { ...base, roleKeys: ["unknown"] },
      { ...base, reason: "" },
      { ...base, reason: " padded " },
      {
        action: "change_status",
        expectedVersion: 7,
        status: "invited",
        reason: "No such lifecycle.",
      },
    ]) {
      expect(parseAdvocateTeamMemberMutation(JSON.stringify(value))).toBeNull()
    }
    expect(
      parseAdvocateTeamMemberMutation(
        JSON.stringify({ ...base, reason: "a".repeat(8_300) }),
      ),
    ).toBeNull()
  })
})

test.describe("advocate team repository", () => {
  test("uses only purpose-built RPCs and exact audit context", async () => {
    const calls: Array<{ name: string; args: unknown }> = []
    const client = {
      async rpc(name: string, args: unknown) {
        calls.push({ name, args })
        if (name === "get_advocate_team") {
          return { data: [OWNER_ROW, DELEGATE_ROW], error: null }
        }
        return { data: 8, error: null }
      },
    }
    const repository = teamModule.createAdvocateTeamRepository(client as never)

    await expect(
      repository.load({ advocateId: ADVOCATE_ID }),
    ).resolves.toHaveLength(2)
    await expect(
      repository.replaceRoles({
        advocateId: ADVOCATE_ID,
        membershipId: DELEGATE_MEMBERSHIP_ID,
        expectedVersion: 7,
        roleKeys: ["administrator", "brand_editor"],
        reason: "Align access with current responsibilities.",
        context: {
          requestId: "request-1",
          traceId: "trace-1",
          sessionId: null,
        },
      }),
    ).resolves.toBe(8)
    await expect(
      repository.changeStatus({
        advocateId: ADVOCATE_ID,
        membershipId: DELEGATE_MEMBERSHIP_ID,
        expectedVersion: 8,
        status: "suspended",
        reason: "Pause access during a role transition.",
        context: {
          requestId: "request-2",
          traceId: null,
          sessionId: null,
        },
      }),
    ).resolves.toBe(8)

    expect(calls).toEqual([
      {
        name: "get_advocate_team",
        args: { target_advocate_id: ADVOCATE_ID },
      },
      {
        name: "replace_advocate_member_roles",
        args: {
          target_advocate_id: ADVOCATE_ID,
          target_membership_id: DELEGATE_MEMBERSHIP_ID,
          expected_membership_version: 7,
          target_role_keys: ["administrator", "brand_editor"],
          change_reason: "Align access with current responsibilities.",
          request_id: "request-1",
          trace_id: "trace-1",
          session_id: null,
        },
      },
      {
        name: "change_advocate_member_status",
        args: {
          target_advocate_id: ADVOCATE_ID,
          target_membership_id: DELEGATE_MEMBERSHIP_ID,
          expected_membership_version: 8,
          target_status: "suspended",
          change_reason: "Pause access during a role transition.",
          request_id: "request-2",
          trace_id: null,
          session_id: null,
        },
      },
    ])
  })

  test("fails closed on malformed projections, versions, and database errors", async () => {
    const malformed = teamModule.createAdvocateTeamRepository({
      async rpc() {
        return { data: [{ email: "must-not-cross@example.com" }], error: null }
      },
    } as never)
    await expect(
      malformed.load({ advocateId: ADVOCATE_ID }),
    ).rejects.toMatchObject({
      name: "AdvocateTeamRepositoryError",
      stage: "shape",
    })

    const badVersion = teamModule.createAdvocateTeamRepository({
      async rpc() {
        return { data: 0, error: null }
      },
    } as never)
    await expect(
      badVersion.changeStatus({
        advocateId: ADVOCATE_ID,
        membershipId: DELEGATE_MEMBERSHIP_ID,
        expectedVersion: 7,
        status: "suspended",
        reason: "Pause access.",
        context: { requestId: "request", traceId: null, sessionId: null },
      }),
    ).rejects.toMatchObject({ stage: "shape" })

    const denied = teamModule.createAdvocateTeamRepository({
      async rpc() {
        return { data: null, error: { code: "42501" } }
      },
    } as never)
    await expect(
      denied.load({ advocateId: ADVOCATE_ID }),
    ).rejects.toMatchObject({
      stage: "load",
      postgresCode: "42501",
    })
  })
})
