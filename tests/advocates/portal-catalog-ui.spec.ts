import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

import { buildAdvocatePortalNavigation } from "../../src/components/advocates/admin/PortalShell"

test.describe("advocate catalog administrative UI contract", () => {
  test("adds a live catalog link only for members with catalog permission", () => {
    const navigation = buildAdvocatePortalNavigation({
      slug: "hope",
      permissions: ["portal.beneficiaries.manage", "portal.view"],
    })
    expect(navigation.at(-1)).toEqual(
      expect.objectContaining({
        section: "catalog",
        href: "/portal/hope/catalog",
        availability: "available",
      }),
    )

    const viewerNavigation = buildAdvocatePortalNavigation({
      slug: "hope",
      permissions: ["portal.view"],
    })
    expect(viewerNavigation.some((item) => item.section === "catalog")).toBe(
      false,
    )
  })

  test("loads the safe actor-aware catalog behind exact permission", () => {
    const pageSource = readFileSync(
      resolve(
        process.cwd(),
        "src/app/(advocate-admin)/portal/[slug]/catalog/page.tsx",
      ),
      "utf8",
    )

    expect(pageSource).toContain('"portal.beneficiaries.manage"')
    expect(pageSource).toContain("notFound()")
    expect(pageSource).toContain("loadAdvocateCatalogAdministration")
    expect(pageSource).toContain("createServiceRoleClient()")
    expect(pageSource).toContain("advocateId: portal.advocateId")
    expect(pageSource).toContain("actorUserId: session.user.id")
    expect(pageSource).toContain("advocateVersion: catalog.advocateVersion")
    expect(pageSource).toContain("actorUserId: session.user.id")
    expect(pageSource).toContain("mode: catalog.mode")
    expect(pageSource).toContain("selections: catalog.selections")
    expect(pageSource).toContain(
      "viewModel.advocateId}:${viewModel.actorUserId}",
    )
    expect(pageSource).not.toContain("createAdvocateAdminSettingsRepository")
    expect(pageSource).not.toMatch(
      /sponsor_email|sponsor_identity_id|contact_email|visitor_id|provider_customer_id/i,
    )
  })

  test("renders all approved modes, ordered choices, and stale safety controls", () => {
    const clientSource = readFileSync(
      resolve(
        process.cwd(),
        "src/components/advocates/admin/CatalogSettingsClient.tsx",
      ),
      "utf8",
    )

    for (const text of [
      "Show every eligible child",
      "Show every child and feature chosen children",
      "Show only chosen children",
      "Move up",
      "Move down",
      "Feature this child",
      "Find a child to add",
      "Remove every unavailable child before saving",
      "Reload latest settings",
      "Discard unsaved catalog changes?",
      "Stay on this page",
      "Discard changes",
      "Reset to saved catalog",
      "Recovered unsaved catalog changes from this browser tab",
      "This browser is blocking tab recovery",
      "version_conflict",
      "eligibility_changed",
      "no_change",
    ]) {
      expect(clientSource).toContain(text)
    }
    expect(clientSource).toContain("settings.selectionLimit")
    expect(clientSource).toContain(
      "visibleChoices = matchingChoices.slice(0, 100)",
    )
    expect(clientSource).toContain('window.addEventListener("beforeunload"')
    expect(clientSource).toContain(
      'document.addEventListener("click", blockClientNavigation, true)',
    )
    expect(clientSource).toContain('role="alertdialog"')
    expect(clientSource).toContain("aria-label={`Remove ${choiceLabel}`}")
    expect(clientSource).toContain("aria-label={`Feature ${choiceLabel}`}")
    expect(clientSource).toContain("catalogAnnouncement")
    expect(clientSource).toContain('navigationType !== "traverse"')
    expect(clientSource).toContain("event.preventDefault()")
    expect(clientSource).toContain("parseAdvocateCatalogDraft")
    expect(clientSource).toContain("window.sessionStorage.setItem")
    expect(clientSource).toContain("isAppleWebKitBrowser")
    expect(clientSource).toContain('window.addEventListener("pagehide"')
    expect(clientSource).toContain(
      'document.addEventListener("visibilitychange"',
    )
    expect(clientSource).toContain(
      "window.location.assign(pendingNavigation.href)",
    )
    expect(clientSource).not.toContain("precommitHandler")
    expect(clientSource).toContain("dialog.showModal()")
    expect(clientSource).toContain("maxLength={500}")
    expect(clientSource).toContain('type="text"')
    expect(clientSource).not.toContain("<textarea")
    expect(clientSource).toContain('aria-live="polite"')
    expect(clientSource).toContain('credentials: "same-origin"')
    expect(clientSource).toContain('redirect: "error"')
    expect(clientSource).not.toMatch(
      /sponsor_email|sponsor_identity_id|contact_email|visitor_id|provider_customer_id/i,
    )
  })
})
