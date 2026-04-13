/**
 * Liquid-glass card style variants.
 *
 * The glass effect lives as a pointer-events:none gradient overlay
 * positioned absolutely over the card's photo. The outer card wrapper
 * keeps a clean minimal border and drop shadow — it is NOT where the
 * shine lives.
 *
 * Usage in card components:
 *
 *   // Outer card wrapper:
 *   style={{ border: glassStyle.border, boxShadow: glassStyle.boxShadow }}
 *
 *   // Inside the image Box (position:relative, overflow:hidden):
 *   <div
 *     style={{
 *       position: "absolute", inset: 0, zIndex: 2,
 *       pointerEvents: "none",
 *       background: glassStyle.imageOverlay,
 *     }}
 *   />
 */

export type GlassVariantId = 1 | 2 | 3 | 4 | 5

export interface GlassVariant {
  id: GlassVariantId
  name: string
  description: string
  swatchTop: string
  swatchBottom: string
  /** CSS gradient(s) for the transparent overlay on top of the photo. */
  imageOverlay: string
  /** Outer card border (applied to border CSS property). */
  border: string
  /** Outer card box-shadow. */
  boxShadow: string
  /** Selected-state overrides. */
  selected: {
    imageOverlay: string
    border: string
    boxShadow: string
  }
}

// Shared clean drop shadow base — used by all variants.
const DROP = "0 2px 8px rgba(0,0,0,0.07), 0 6px 24px rgba(0,0,0,0.05)"

export const GLASS_VARIANTS: GlassVariant[] = [
  {
    id: 1,
    name: "Rim",
    description: "Crisp 1px white edge at the top of the photo — nothing more",
    swatchTop: "rgba(255,255,255,0.95)",
    swatchBottom: "rgba(255,255,255,0)",
    imageOverlay:
      // Hard bright line at y=0, fully transparent by ~28px.
      "linear-gradient(to bottom, rgba(255,255,255,0.62) 0px, rgba(255,255,255,0.28) 2px, rgba(255,255,255,0.06) 14px, transparent 32px)",
    border: "1px solid rgba(0,0,0,0.07)",
    boxShadow: DROP,
    selected: {
      imageOverlay:
        "linear-gradient(to bottom, rgba(255,255,255,0.72) 0px, rgba(255,255,255,0.30) 2px, rgba(255,255,255,0.06) 14px, transparent 32px)",
      border: "1.5px solid rgba(43,127,249,0.32)",
      boxShadow: `0 0 0 2px rgba(43,127,249,0.14), ${DROP}`,
    },
  },
  {
    id: 2,
    name: "Lens",
    description: "Centered oval glow — light coming straight down from above",
    swatchTop: "rgba(255,255,255,0.80)",
    swatchBottom: "rgba(255,255,255,0)",
    imageOverlay:
      // Oval radial centered on top edge, fades to nothing by mid-image.
      "radial-gradient(ellipse 85% 55% at 50% 0%, rgba(255,255,255,0.44) 0%, rgba(255,255,255,0.14) 38%, transparent 68%)",
    border: "1px solid rgba(0,0,0,0.07)",
    boxShadow: DROP,
    selected: {
      imageOverlay:
        "radial-gradient(ellipse 85% 55% at 50% 0%, rgba(255,255,255,0.54) 0%, rgba(255,255,255,0.18) 38%, transparent 68%)",
      border: "1.5px solid rgba(43,127,249,0.32)",
      boxShadow: `0 0 0 2px rgba(43,127,249,0.14), ${DROP}`,
    },
  },
  {
    id: 3,
    name: "Sweep",
    description: "Diagonal streak from upper-left — single directional light source",
    swatchTop: "rgba(255,255,255,0.75)",
    swatchBottom: "rgba(255,255,255,0)",
    imageOverlay:
      // Angled beam from top-left, fades out before reaching center.
      "linear-gradient(138deg, rgba(255,255,255,0.52) 0%, rgba(255,255,255,0.18) 22%, rgba(255,255,255,0.04) 40%, transparent 56%)",
    border: "1px solid rgba(0,0,0,0.07)",
    boxShadow: DROP,
    selected: {
      imageOverlay:
        "linear-gradient(138deg, rgba(255,255,255,0.62) 0%, rgba(255,255,255,0.22) 22%, rgba(255,255,255,0.05) 40%, transparent 56%)",
      border: "1.5px solid rgba(43,127,249,0.32)",
      boxShadow: `0 0 0 2px rgba(43,127,249,0.14), ${DROP}`,
    },
  },
  {
    id: 4,
    name: "Diffuse",
    description: "Soft wide veil from top — like frosted glass with even scatter",
    swatchTop: "rgba(255,255,255,0.60)",
    swatchBottom: "rgba(255,255,255,0)",
    imageOverlay:
      // Wider, gentler spread over the top 55% of the image.
      "linear-gradient(to bottom, rgba(255,255,255,0.30) 0%, rgba(255,255,255,0.14) 28%, rgba(255,255,255,0.04) 52%, transparent 72%)",
    border: "1px solid rgba(0,0,0,0.07)",
    boxShadow: DROP,
    selected: {
      imageOverlay:
        "linear-gradient(to bottom, rgba(255,255,255,0.38) 0%, rgba(255,255,255,0.16) 28%, rgba(255,255,255,0.05) 52%, transparent 72%)",
      border: "1.5px solid rgba(43,127,249,0.32)",
      boxShadow: `0 0 0 2px rgba(43,127,249,0.14), ${DROP}`,
    },
  },
  {
    id: 5,
    name: "Specular",
    description: "Two offset radial hot-spots — realistic studio dual-fill reflection",
    swatchTop: "rgba(255,255,255,0.72)",
    swatchBottom: "rgba(255,255,255,0)",
    imageOverlay:
      // Primary hot-spot left-of-center, secondary smaller one on the right.
      [
        "radial-gradient(ellipse 52% 38% at 30% 0%, rgba(255,255,255,0.52) 0%, transparent 100%)",
        "radial-gradient(ellipse 36% 26% at 74% 0%, rgba(255,255,255,0.26) 0%, transparent 100%)",
      ].join(", "),
    border: "1px solid rgba(0,0,0,0.07)",
    boxShadow: DROP,
    selected: {
      imageOverlay:
        [
          "radial-gradient(ellipse 52% 38% at 30% 0%, rgba(255,255,255,0.62) 0%, transparent 100%)",
          "radial-gradient(ellipse 36% 26% at 74% 0%, rgba(255,255,255,0.32) 0%, transparent 100%)",
        ].join(", "),
      border: "1.5px solid rgba(43,127,249,0.32)",
      boxShadow: `0 0 0 2px rgba(43,127,249,0.14), ${DROP}`,
    },
  },
]

export const DEFAULT_VARIANT_ID: GlassVariantId = 1

export function getGlassVariant(id: GlassVariantId): GlassVariant {
  return GLASS_VARIANTS.find((v) => v.id === id) ?? GLASS_VARIANTS[0]
}

export interface CardGlassStyle {
  border: string
  boxShadow: string
  imageOverlay: string
}

export function cardGlassStyle(
  variantId: GlassVariantId,
  isSelected: boolean,
): CardGlassStyle {
  const v = getGlassVariant(variantId)
  if (isSelected) {
    return {
      border: v.selected.border,
      boxShadow: v.selected.boxShadow,
      imageOverlay: v.selected.imageOverlay,
    }
  }
  return {
    border: v.border,
    boxShadow: v.boxShadow,
    imageOverlay: v.imageOverlay,
  }
}
