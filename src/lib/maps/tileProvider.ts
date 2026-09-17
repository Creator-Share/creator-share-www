import { isAdvocateStagingEnvironmentEnabled } from "@/lib/advocates/host"

export type MapTileEnvironment = Readonly<Record<string, string | undefined>>

export interface MapTileProvider {
  attribution: string
  url: string
}

const OPENSTREETMAP_TILE_PROVIDER = Object.freeze({
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
})
const MAPTILER_KEY_PATTERN = /^[A-Za-z0-9_-]{8,256}$/

export function resolveMapTileProvider(
  style: "basic-v2" | "bright-v2",
  environment: MapTileEnvironment,
): MapTileProvider {
  const mapTilerKey = environment.NEXT_PUBLIC_MAPTILER_KEY
  if (
    isAdvocateStagingEnvironmentEnabled(environment) ||
    !mapTilerKey ||
    !MAPTILER_KEY_PATTERN.test(mapTilerKey)
  ) {
    return OPENSTREETMAP_TILE_PROVIDER
  }

  return Object.freeze({
    attribution: '&copy; <a href="https://www.maptiler.com/">MapTiler</a>',
    url: `https://api.maptiler.com/maps/${style}/{z}/{x}/{y}.png?key=${mapTilerKey}&lang=en`,
  })
}
