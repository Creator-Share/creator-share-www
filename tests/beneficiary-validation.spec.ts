import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

import {
  beneficiaryUpdateRequiresStoredRow,
  findInvalidPublicActivityProjectionField,
  findInvalidPublicBeneficiaryProjectionField,
  isValidBeneficiaryUsername,
  isValidPublicMediaExtension,
  MAX_BENEFICIARY_USERNAME_LENGTH,
  prepareLegacyPreservingBeneficiaryUpdate,
  resolveBeneficiaryTypeWrite,
  resolveBeneficiaryUsernameWrite,
} from "../src/config/beneficiaryValidation"

test.describe("beneficiary username boundary", () => {
  test("accepts canonical values through the shared maximum", () => {
    expect(isValidBeneficiaryUsername("portal-child")).toBe(true)
    expect(isValidBeneficiaryUsername("child.name")).toBe(true)
    expect(
      isValidBeneficiaryUsername("a".repeat(MAX_BENEFICIARY_USERNAME_LENGTH)),
    ).toBe(true)
  })

  test("rejects values outside the URI-safe public username grammar", () => {
    for (const value of [
      "",
      "a".repeat(MAX_BENEFICIARY_USERNAME_LENGTH + 1),
      " padded",
      "padded ",
      "line\nbreak",
      "null\u0000byte",
      "internal space",
      "path/segment",
      "query?value",
      "fragment#value",
      "percent%value",
      ".",
      "..",
      "checkout",
      "CHECKOUT",
      "padded\u00a0",
      "\ufeffpadded",
      "control\u0085value",
      "😀".repeat(100),
      null,
      123,
      {},
    ]) {
      expect(isValidBeneficiaryUsername(value)).toBe(false)
    }
  })

  test("uses the shared boundary for administrative writes and public reads", () => {
    const createRoute = readFileSync(
      resolve(process.cwd(), "src/app/api/admin/beneficiaries/create/route.ts"),
      "utf8",
    )
    const updateRoute = readFileSync(
      resolve(
        process.cwd(),
        "src/app/api/admin/beneficiaries/update/[id]/route.ts",
      ),
      "utf8",
    )
    const publicCatalog = readFileSync(
      resolve(process.cwd(), "src/lib/advocates/publicCatalog.ts"),
      "utf8",
    )

    expect(createRoute).toContain("isValidBeneficiaryUsername,")
    expect(createRoute).toContain('from "@/config/beneficiaryValidation"')
    expect(createRoute).toContain(
      "if (!isValidBeneficiaryUsername(normalizedUsername))",
    )
    expect(createRoute).toContain("username: normalizedUsername")
    expect(updateRoute).toContain("EDITABLE_BENEFICIARY_FIELDS")
    expect(updateRoute).toContain("beneficiaryUpdateRequiresStoredRow")
    expect(updateRoute).toContain("prepareLegacyPreservingBeneficiaryUpdate")
    expect(updateRoute.match(/\.maybeSingle\(\)/g)).toHaveLength(1)
    expect(updateRoute).toContain(".update(data)")
    expect(updateRoute).not.toContain(".update(body)")
    expect(publicCatalog).toContain("MAX_BENEFICIARY_USERNAME_LENGTH")
    expect(publicCatalog).toContain("isValidBeneficiaryUsername(value)")
  })

  test("preserves unchanged legacy fields without allowing new invalid assignments", () => {
    expect(
      resolveBeneficiaryUsernameWrite("path/legacy", "path/legacy"),
    ).toEqual({ action: "preserve" })
    expect(resolveBeneficiaryUsernameWrite("path/new", "path/legacy")).toEqual({
      action: "reject",
    })
    expect(
      resolveBeneficiaryUsernameWrite(" safe-child ", "path/legacy"),
    ).toEqual({ action: "write", value: "safe-child" })

    expect(resolveBeneficiaryTypeWrite("FAMILY", "FAMILY")).toEqual({
      action: "preserve",
    })
    expect(resolveBeneficiaryTypeWrite("TOTALLY_MADE_UP", "FAMILY")).toEqual({
      action: "reject",
    })
    expect(resolveBeneficiaryTypeWrite("IN_OUR_CARE", "FAMILY")).toEqual({
      action: "write",
      value: "IN_OUR_CARE",
    })

    const storedLegacyBeneficiary = {
      name: "Legacy Child",
      username: "path/legacy",
      beneficiary_type: "FAMILY",
    }
    const unrelatedEdit = {
      name: "Updated Legacy Child",
      username: "path/legacy",
      beneficiary_type: "FAMILY",
    }
    expect(beneficiaryUpdateRequiresStoredRow(unrelatedEdit)).toBe(true)
    expect(
      prepareLegacyPreservingBeneficiaryUpdate(
        unrelatedEdit,
        storedLegacyBeneficiary,
      ),
    ).toEqual({ ok: true, data: { name: "Updated Legacy Child" } })
    expect(
      prepareLegacyPreservingBeneficiaryUpdate(
        {
          username: "path/legacy",
          beneficiary_type: "FAMILY",
        },
        storedLegacyBeneficiary,
      ),
    ).toEqual({ ok: true, data: {} })
    expect(
      prepareLegacyPreservingBeneficiaryUpdate(
        { beneficiary_type: "TOTALLY_MADE_UP" },
        storedLegacyBeneficiary,
      ),
    ).toEqual({ ok: false, field: "beneficiary_type" })
  })

  test("aligns beneficiary, activity, and media write shapes with public reads", () => {
    expect(
      findInvalidPublicBeneficiaryProjectionField({
        name: "Safe Child",
        username: "safe-child",
        biography: "First paragraph.\n\nSecond paragraph.",
        country: "Tanzania",
        location_str: "Arusha",
        video_url: "https://example.test/video",
        introduction: null,
        beneficiary_type: "IN_OUR_CARE",
      }),
    ).toBeNull()
    expect(
      findInvalidPublicBeneficiaryProjectionField({ name: "Unsafe\u0085Name" }),
    ).toBe("name")
    expect(
      findInvalidPublicBeneficiaryProjectionField({
        biography: "😀".repeat(25_001),
      }),
    ).toBe("biography")
    expect(
      findInvalidPublicBeneficiaryProjectionField({
        beneficiary_type: "lowercase-type",
      }),
    ).toBe("beneficiary_type")

    expect(
      findInvalidPublicActivityProjectionField({
        title: "A title",
        description: "A description\nwith a second line.",
        activity_type: "UPDATE",
      }),
    ).toBeNull()
    expect(
      findInvalidPublicActivityProjectionField({ title: "Unsafe\u0001title" }),
    ).toBe("title")
    expect(
      findInvalidPublicActivityProjectionField({ activity_type: "PRIVATE" }),
    ).toBe("activity_type")

    expect(isValidPublicMediaExtension("webp")).toBe(true)
    expect(isValidPublicMediaExtension("bad/ext")).toBe(false)
    expect(isValidPublicMediaExtension("x".repeat(33))).toBe(false)
  })

  test("guards every administrative public projection write path", () => {
    for (const route of [
      "src/app/api/admin/beneficiaries/images/create/route.ts",
      "src/app/api/admin/beneficiaries/video/create/route.ts",
      "src/app/api/admin/activities/media/create/route.ts",
    ]) {
      expect(readFileSync(resolve(process.cwd(), route), "utf8")).toContain(
        "isValidPublicMediaExtension",
      )
    }
    for (const route of [
      "src/app/api/admin/activities/create/route.ts",
      "src/app/api/admin/activities/update/route.ts",
    ]) {
      expect(readFileSync(resolve(process.cwd(), route), "utf8")).toContain(
        "findInvalidPublicActivityProjectionField",
      )
    }
  })
})
