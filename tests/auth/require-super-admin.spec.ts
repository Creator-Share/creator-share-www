import type { SupabaseClient } from "@supabase/supabase-js"
import { expect, test } from "@playwright/test"

import { requireSuperAdmin } from "@/utils/auth/requireSuperAdmin"

/**
 * The super administrator gate.
 *
 * A mutation sweep found that the role-name comparison was unasserted:
 * replacing `name === "SUPER_ADMIN"` with a check that the name is merely
 * non-empty passed the entire suite. Several specs reference this helper, but
 * none of them exercised a user who holds a role that is not SUPER_ADMIN,
 * which is the only case that separates the two.
 *
 * This gate is the sole authorization on the administrative media and storage
 * write paths, so widening it admits any advocate portal member or tenant
 * editor to endpoints that mutate platform-wide records.
 */

const SUPER_ADMIN = { id: "11111111-1111-4111-8111-111111111111" }

interface RoleRow {
  roles: { name: string }
}

/** A Supabase client narrow enough for this gate and no wider. */
function client(options: {
  user?: { id: string } | null
  roles?: RoleRow[] | null
  roleError?: { code: string } | null
}): SupabaseClient {
  const { user = SUPER_ADMIN, roles = null, roleError = null } = options
  return {
    auth: {
      async getUser() {
        return { data: { user }, error: null }
      },
    },
    from() {
      return {
        select() {
          return {
            // The gate awaits the filter directly rather than a row accessor.
            eq: async () => ({ data: roles, error: roleError }),
          }
        },
      }
    },
  } as unknown as SupabaseClient
}

const role = (name: string): RoleRow => ({ roles: { name } })

test.describe("super administrator gate", () => {
  test("refuses an unauthenticated caller", async () => {
    const result = await requireSuperAdmin(client({ user: null }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(401)
  })

  test("refuses a user holding roles that are not SUPER_ADMIN", async () => {
    // The decisive case. A gate that merely checks a role exists would admit
    // every one of these, and each is a real role in this platform.
    for (const held of [
      "ADVOCATE_OWNER",
      "ADVOCATE_ADMINISTRATOR",
      "BRAND_EDITOR",
      "CATALOG_CURATOR",
      "ANALYTICS_VIEWER",
      "AUDIT_VIEWER",
      "USER",
    ]) {
      const result = await requireSuperAdmin(client({ roles: [role(held)] }))
      expect(result.ok, `${held} must not pass the super admin gate`).toBe(
        false,
      )
      if (!result.ok) expect(result.response.status).toBe(403)
    }
  })

  test("refuses a near miss on the role name", async () => {
    for (const held of [
      "super_admin",
      "Super_Admin",
      "SUPER_ADMINISTRATOR",
      "NOT_SUPER_ADMIN",
      "",
    ]) {
      const result = await requireSuperAdmin(client({ roles: [role(held)] }))
      expect(result.ok, `${JSON.stringify(held)} must not pass`).toBe(false)
    }
  })

  test("refuses a caller with no roles, and a failed role lookup", async () => {
    expect((await requireSuperAdmin(client({ roles: [] }))).ok).toBe(false)
    expect((await requireSuperAdmin(client({ roles: null }))).ok).toBe(false)
    expect(
      (
        await requireSuperAdmin(
          client({
            roles: [role("SUPER_ADMIN")],
            roleError: { code: "08006" },
          }),
        )
      ).ok,
    ).toBe(false)
  })

  test("admits an exact super administrator", async () => {
    // Without this the refusals above would be satisfied by a gate that
    // rejects everyone.
    const result = await requireSuperAdmin(
      client({ roles: [role("ADVOCATE_OWNER"), role("SUPER_ADMIN")] }),
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.user.id).toBe(SUPER_ADMIN.id)
  })
})
