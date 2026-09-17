import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

import { buildAdvocateDomainStatusPresentation } from "../../src/components/advocates/admin/DomainStatus"
import { advocatePortalDisplayHostname } from "../../src/components/advocates/admin/PortalShell"

function portal(
  overrides: Partial<
    Parameters<typeof buildAdvocateDomainStatusPresentation>[0]
  > = {},
): Parameters<typeof buildAdvocateDomainStatusPresentation>[0] {
  return {
    canonicalHostname: "hope.creatorshare.com",
    displayName: "Hope Creates",
    domainStatus: "active",
    publicationStatus: "active",
    relationshipStatus: "active",
    ...overrides,
  }
}

test.describe("advocate domain status administrative UI contract", () => {
  test("presents only safe tenant-facing readiness states", () => {
    expect(buildAdvocateDomainStatusPresentation(portal())).toEqual({
      hostname: "hope.creatorshare.com",
      domainStatusLabel: "Active",
      publicationStatusLabel: "Active",
      summary: "The public portal is available on this domain.",
      publicHref: "https://hope.creatorshare.com",
    })
    expect(
      buildAdvocateDomainStatusPresentation(
        portal({ canonicalHostname: "canary.creatorshare.com" }),
        {
          NEXT_PUBLIC_BASE_URL: "https://advocate-staging.creatorshare.com",
        },
      ),
    ).toEqual(
      expect.objectContaining({
        hostname: "canary.advocate-staging.creatorshare.com",
        publicHref: "https://canary.advocate-staging.creatorshare.com",
      }),
    )
    expect(
      buildAdvocateDomainStatusPresentation(portal(), {
        NEXT_PUBLIC_BASE_URL: "https://advocate-staging.creatorshare.com",
      }),
    ).toEqual(
      expect.objectContaining({
        hostname: "Unavailable in this environment",
        publicHref: null,
      }),
    )

    expect(
      buildAdvocateDomainStatusPresentation(
        portal({
          domainStatus: "verifying",
          publicationStatus: "provisioning",
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        domainStatusLabel: "Verifying",
        summary: "Automated readiness checks are in progress.",
        publicHref: null,
      }),
    )

    expect(
      buildAdvocateDomainStatusPresentation(
        portal({ canonicalHostname: null, domainStatus: null }),
      ),
    ).toEqual(
      expect.objectContaining({
        hostname: "Not yet assigned",
        domainStatusLabel: "Not yet assigned",
        summary: "A Creator Share subdomain has not been assigned yet.",
        publicHref: null,
      }),
    )
  })

  test("keeps every nonpublic lifecycle state fail closed", () => {
    const cases = [
      {
        overrides: { domainStatus: "pending" as const },
        summary: "Automated domain setup has not started yet.",
      },
      {
        overrides: { domainStatus: "provisioning" as const },
        summary: "Automated domain setup is in progress.",
      },
      {
        overrides: { domainStatus: "failed" as const },
        summary:
          "Creator Share must review domain setup before publication can continue.",
      },
      {
        overrides: { domainStatus: "redirecting" as const },
        summary:
          "This domain is being retired and is not the active public destination.",
      },
      {
        overrides: { domainStatus: "disabled" as const },
        summary: "This domain is disabled and cannot serve the public portal.",
      },
      {
        overrides: { relationshipStatus: "suspended" as const },
        summary:
          "This portal relationship is suspended, so its public domain is unavailable.",
      },
      {
        overrides: { relationshipStatus: "archived" as const },
        summary:
          "This portal is archived and its public domain is unavailable.",
      },
      {
        overrides: { relationshipStatus: "invited" as const },
        summary:
          "This portal relationship is not active, so its public domain is unavailable.",
      },
    ]

    for (const item of cases) {
      const status = buildAdvocateDomainStatusPresentation(
        portal(item.overrides),
      )
      expect(status.summary).toBe(item.summary)
      expect(status.publicHref).toBeNull()
    }

    expect(
      buildAdvocateDomainStatusPresentation(
        portal({ domainStatus: "active", publicationStatus: "draft" }),
      ),
    ).toEqual(
      expect.objectContaining({
        summary:
          "The domain is ready. The public portal remains unavailable until publication is approved.",
        publicHref: null,
      }),
    )
  })

  test("guards the page before rendering the existing access projection", () => {
    const pageSource = readFileSync(
      resolve(
        process.cwd(),
        "src/app/(advocate-admin)/portal/[slug]/domain/page.tsx",
      ),
      "utf8",
    )
    const componentSource = readFileSync(
      resolve(process.cwd(), "src/components/advocates/admin/DomainStatus.tsx"),
      "utf8",
    )

    expect(pageSource).toContain('dynamic = "force-dynamic"')
    expect(pageSource).toContain("revalidate = 0")
    expect(pageSource).toContain("noStore()")
    expect(pageSource).toContain('permissions.includes("portal.domains.view")')
    expect(pageSource.lastIndexOf("portal.domains.view")).toBeLessThan(
      pageSource.lastIndexOf("<DomainStatus"),
    )
    expect(pageSource).not.toContain("createClient")
    expect(pageSource).not.toContain(".from(")
    expect(`${pageSource}\n${componentSource}`).not.toMatch(
      /cloudflare|vercel|stripe|paypal|provider[_ -]?(?:id|error|job)|canary|raw error|credential|secret/i,
    )
    expect(componentSource).toContain(
      'aria-labelledby="advocate-domain-heading"',
    )
    expect(componentSource).not.toContain('"use client"')
  })

  test("uses the fail-closed display hostname on portal overview surfaces", () => {
    const stagingEnvironment = {
      NEXT_PUBLIC_BASE_URL: "https://advocate-staging.creatorshare.com",
    }
    expect(
      advocatePortalDisplayHostname(
        "canary.creatorshare.com",
        stagingEnvironment,
      ),
    ).toBe("canary.advocate-staging.creatorshare.com")
    expect(
      advocatePortalDisplayHostname(
        "hope.creatorshare.com",
        stagingEnvironment,
      ),
    ).toBe("Unavailable in this environment")
    expect(
      advocatePortalDisplayHostname("hope.creatorshare.com", {
        NEXT_PUBLIC_BASE_URL: "https://creatorshare.com",
      }),
    ).toBe("hope.creatorshare.com")

    for (const pagePath of [
      "src/app/(advocate-admin)/portal/page.tsx",
      "src/app/(advocate-admin)/portal/[slug]/page.tsx",
    ]) {
      const source = readFileSync(resolve(process.cwd(), pagePath), "utf8")
      expect(source).toContain("advocatePortalDisplayHostname")
      expect(source).not.toMatch(
        /\{portal\.canonicalHostname\s*\?\?\s*["'](?:Domain n|N)ot yet assigned["']\}/,
      )
    }
  })
})
