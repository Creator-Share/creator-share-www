import type { CSSProperties } from "react"

import {
  CREATOR_SHARE_ACCENT_COLOR,
  CREATOR_SHARE_PRIMARY_COLOR,
  type PublicSite,
} from "./publicSite"

const HEX_COLOR_PATTERN = /^#[0-9A-F]{6}$/
const BLACK = "#000000"
const WHITE = "#FFFFFF"

export interface PublicSiteTheme {
  primaryColor: string
  primaryForegroundColor: string
  accentColor: string
  accentForegroundColor: string
}

export type PublicSiteCssVariables = CSSProperties & {
  "--public-site-primary": string
  "--public-site-primary-foreground": string
  "--public-site-accent": string
  "--public-site-accent-foreground": string
}

export function normalizePublicSiteColor(value: unknown): string | null {
  if (typeof value !== "string") return null

  const normalized = value.toUpperCase()
  return HEX_COLOR_PATTERN.test(normalized) ? normalized : null
}

function linearRgbChannel(channel: number): number {
  const srgb = channel / 255
  return srgb <= 0.04045 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4)
}

export function relativeLuminance(hexColor: string): number {
  const normalized = normalizePublicSiteColor(hexColor)
  if (normalized === null) return 0

  const red = linearRgbChannel(Number.parseInt(normalized.slice(1, 3), 16))
  const green = linearRgbChannel(Number.parseInt(normalized.slice(3, 5), 16))
  const blue = linearRgbChannel(Number.parseInt(normalized.slice(5, 7), 16))
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

export function contrastRatio(left: string, right: string): number {
  const leftLuminance = relativeLuminance(left)
  const rightLuminance = relativeLuminance(right)
  const lighter = Math.max(leftLuminance, rightLuminance)
  const darker = Math.min(leftLuminance, rightLuminance)
  return (lighter + 0.05) / (darker + 0.05)
}

/**
 * Black and white cannot both fail WCAG AA contrast against the same solid
 * background. Selecting the stronger candidate therefore provides at least
 * 4.5 to 1 contrast for ordinary text without trusting tenant input.
 */
export function deriveAccessibleForegroundColor(background: string): string {
  const normalized = normalizePublicSiteColor(background)
  if (normalized === null) return WHITE

  return contrastRatio(normalized, BLACK) >= contrastRatio(normalized, WHITE)
    ? BLACK
    : WHITE
}

export function resolvePublicSiteTheme(
  site: Pick<PublicSite, "primaryColor" | "accentColor">,
): PublicSiteTheme {
  const primaryColor =
    normalizePublicSiteColor(site.primaryColor) ?? CREATOR_SHARE_PRIMARY_COLOR
  const accentColor =
    normalizePublicSiteColor(site.accentColor) ?? CREATOR_SHARE_ACCENT_COLOR

  return Object.freeze({
    primaryColor,
    primaryForegroundColor: deriveAccessibleForegroundColor(primaryColor),
    accentColor,
    accentForegroundColor: deriveAccessibleForegroundColor(accentColor),
  })
}

export function createPublicSiteCssVariables(
  site: Pick<PublicSite, "primaryColor" | "accentColor">,
): PublicSiteCssVariables {
  const theme = resolvePublicSiteTheme(site)
  return {
    "--public-site-primary": theme.primaryColor,
    "--public-site-primary-foreground": theme.primaryForegroundColor,
    "--public-site-accent": theme.accentColor,
    "--public-site-accent-foreground": theme.accentForegroundColor,
  }
}
