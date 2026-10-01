"use client"

import { usePublicSite } from "@/components/advocates/PublicSiteProvider"

/**
 * Consumes the site exactly as the production surfaces do: opening header and
 * About Us as sanitized rich text, plus the logo and its alt text.
 */
export function BrandedSurface() {
  const site = usePublicSite()

  return (
    <main>
      <h1>{site.displayName}</h1>
      {site.logoUrl === null ? null : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={site.logoUrl} alt={site.logoAltText ?? ""} />
      )}
      <section aria-label="Opening header">
        <div dangerouslySetInnerHTML={{ __html: site.openingHeaderHtml }} />
      </section>
      <section aria-label="About Us">
        <div dangerouslySetInnerHTML={{ __html: site.aboutBiographyHtml }} />
      </section>
    </main>
  )
}
