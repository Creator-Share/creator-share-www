import { permanentRedirect } from "next/navigation"

type SponsorshipCatalogRedirectProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function SponsorshipCatalogRedirect({
  searchParams,
}: SponsorshipCatalogRedirectProps) {
  const destination = new URL("http://creator-share.invalid")

  for (const [name, value] of Object.entries(await searchParams)) {
    if (Array.isArray(value)) {
      for (const item of value) destination.searchParams.append(name, item)
    } else if (value !== undefined) {
      destination.searchParams.append(name, value)
    }
  }

  permanentRedirect(`/${destination.search}`)
}
