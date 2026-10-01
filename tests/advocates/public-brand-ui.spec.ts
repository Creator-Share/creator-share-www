import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

const homeHeroSource = readFileSync(
  resolve(process.cwd(), "src/components/HomeHero.tsx"),
  "utf8",
)
const aboutUsSource = readFileSync(
  resolve(process.cwd(), "src/components/AboutUsModal.tsx"),
  "utf8",
)
const navbarSource = readFileSync(
  resolve(process.cwd(), "src/components/PageNavbar.tsx"),
  "utf8",
)
const rootLayoutSource = readFileSync(
  resolve(process.cwd(), "src/app/layout.tsx"),
  "utf8",
)

test.describe("public advocate brand UI boundary", () => {
  test("preserves the primary site presentation and copy", () => {
    expect(homeHeroSource).toContain(': "#2b7ff9"')
    expect(homeHeroSource).toContain(': "#FFB700"')
    expect(homeHeroSource).toContain("One child at a time,")
    expect(homeHeroSource).toContain("love is")
    expect(homeHeroSource).toContain("thousands of lives")

    expect(aboutUsSource).toContain('"bg-[#2b7ff9] text-white px-10 py-6"')
    expect(aboutUsSource).toContain("The Creator Share Foundation")
    expect(aboutUsSource).toContain("UK Registered Charity 1169474")
    expect(aboutUsSource).toContain("Visit Our Tanzania Website")
    expect(aboutUsSource).toContain("Follow Us")
    expect(navbarSource).toContain('aria-label="Toggle Menu"')
    expect(navbarSource).toContain(
      'className="fixed top-0 left-0 right-0 bg-[#2B7FF9]',
    )
  })

  test("applies advocate colors and limits the opening header to all opportunities", () => {
    expect(homeHeroSource).toContain(
      'import { usePublicSite } from "@/components/advocates/PublicSiteProvider"',
    )
    expect(homeHeroSource).toMatch(
      /isAdvocateSite\s*&&\s*displayedKey\s*===\s*"ALL"\s*\?\s*publicSite\.openingHeaderHtml\.trim\(\)/,
    )
    expect(homeHeroSource).toContain('? "var(--public-site-accent)"')
    expect(homeHeroSource).toContain(
      "<AllOpportunitiesHeading underlineColor={accentColor} />",
    )
    expect(homeHeroSource).toContain(
      "<AllOpportunitiesDescription linkColor={primaryInkColor} />",
    )
    expect(homeHeroSource).toContain("var(--public-site-primary-ink)")
    expect(homeHeroSource).toContain("color={primaryColor}")
    expect(homeHeroSource).toContain("__html: advocateOpeningHeaderHtml")
    expect(homeHeroSource).toContain('<Heading as="h1" className="sr-only">')
    expect(homeHeroSource.match(/dangerouslySetInnerHTML/g)).toHaveLength(1)
  })

  test("renders advocate identity, biography, and Creator Share trust context", () => {
    expect(aboutUsSource).toContain("publicSite.logoUrl ?")
    expect(aboutUsSource).toContain(
      "publicSite.logoAltText || publicSite.displayName",
    )
    expect(aboutUsSource).toContain("{publicSite.displayName}")
    expect(aboutUsSource).toContain("publicSite.aboutBiographyHtml ?")
    expect(aboutUsSource).toContain("__html: publicSite.aboutBiographyHtml")
    expect(aboutUsSource).toContain("var(--public-site-primary)")
    expect(aboutUsSource).toContain("var(--public-site-primary-ink)")
    expect(aboutUsSource).toContain("var(--public-site-accent)")
    expect(aboutUsSource).toContain("createPublicSiteCssVariables(publicSite)")
    expect(aboutUsSource).toContain("Trusted sponsorship platform")
    expect(aboutUsSource).toContain(
      "Sponsorships on this site are administered by Creator",
    )
    expect(aboutUsSource.match(/dangerouslySetInnerHTML/g)).toHaveLength(1)
    expect(aboutUsSource).toContain("Creator Share Centers")
    expect(aboutUsSource).toContain("Creator Share Support")
    expect(aboutUsSource).toContain(
      'flex={isAdvocateSite ? "0 0 auto" : undefined}',
    )
    expect(aboutUsSource).toContain("overflow-x-auto")
  })

  test("uses a modal focus boundary for advocate mobile navigation only", () => {
    expect(navbarSource).toContain('publicSite.kind === "advocate" ? (')
    expect(navbarSource).toContain("initialFocusEl")
    expect(navbarSource).toContain("finalFocusEl")
    expect(navbarSource).toContain("closeOnInteractOutside={false}")
    expect(navbarSource).toContain("closeOnEscape={true}")
    expect(navbarSource).toContain("trapFocus={true}")
    expect(navbarSource).toContain("restoreFocus={true}")
    expect(navbarSource).toContain("aria-expanded={isOpen}")
    expect(navbarSource).toContain('aria-controls="advocate-mobile-navigation"')
    expect(navbarSource).toContain("<DialogCloseTrigger")
    expect(navbarSource).toContain("Creator Share FAQ")
    expect(navbarSource).toContain("with Creator Share")
    expect(navbarSource).toMatch(
      /publicSite\.kind === "advocate" && !isMobile[\s\S]*setIsOpen\(false\)/,
    )
  })

  test("keeps primary account and administrator controls off advocate sites", () => {
    expect(navbarSource).toContain(
      'if (publicSite.kind === "primary") fetchUser()',
    )
    expect(navbarSource).toContain(
      'if (publicSite.kind === "primary" && user?.id)',
    )
    expect(navbarSource).toContain(
      'mounted && publicSite.kind === "primary" && isOpen',
    )
    expect(navbarSource).toContain("mounted && user ? (")
    expect(navbarSource).not.toMatch(
      /publicSite\.kind === "advocate"[\s\S]{0,200}(?:Sign In|Logout|Admin Dashboard|My Account)/,
    )
  })

  test("does not mount the navigation and authentication wrapper in payment shells", () => {
    expect(rootLayoutSource).toMatch(
      /site\.kind === "payment"[\s\S]*?\{children\}[\s\S]*?: \([\s\S]*?<PageWrapper>/,
    )
    expect(rootLayoutSource).not.toMatch(
      /<PageWrapper>\{site\.kind === "payment"/,
    )
  })

  test("renders only the sanitized public DTO without a browser sanitizer or raw fields", () => {
    for (const source of [homeHeroSource, aboutUsSource, navbarSource]) {
      expect(source).not.toMatch(/sanitize-html|sanitizeAdvocateRichText/)
      expect(source).not.toMatch(
        /opening_header_html|about_biography_html|logo_storage_path/,
      )
      expect(source).not.toContain("createClient(")
    }
  })
})
