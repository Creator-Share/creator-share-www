"use client"
import React from "react"
import { Box } from "@chakra-ui/react"

interface SupportedRibbonProps {
  /** "sm" = story-strip thumbnail (default), "lg" = child details modal image */
  size?: "sm" | "lg"
}

/**
 * Diagonal "✓ Sponsored" banner for the bottom-right corner of a child's image.
 *
 * Parent MUST have `position: relative` AND `overflow: hidden`.
 *
 * This component positions the ribbon band directly — no inner overflow wrapper —
 * so the parent's single clip boundary produces clean straight edges.
 * With a centered double-overflow wrapper the ribbon would be clipped by two
 * perpendicular edges simultaneously, creating the notched "weird edges."
 *
 * Geometry guarantee: for both sizes the ribbon is wide enough that each end
 * exits through exactly one edge of the parent (right or bottom), never a corner.
 */
const SupportedRibbon: React.FC<SupportedRibbonProps> = ({ size = "sm" }) => {
  const isLarge = size === "lg"

  // Band dimensions — wide enough that both ends sit outside the parent clip area.
  const width = isLarge ? 260 : 160
  const height = isLarge ? 42 : 26

  // Negative right tucks the ribbon into the bottom-right corner while keeping
  // enough of the band visible so the text is fully readable.
  const right = isLarge ? -70 : -40
  const bottom = isLarge ? 38 : 24

  return (
    <Box
      position="absolute"
      pointerEvents="none"
      zIndex={10}
      style={{
        right: `${right}px`,
        bottom: `${bottom}px`,
        width: `${width}px`,
        height: `${height}px`,
        lineHeight: `${height}px`,
        transform: "rotate(-45deg)",
        background: "linear-gradient(135deg, #1a6fe0 0%, #2b7ff9 100%)",
        boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
        color: "#fff",
        fontSize: isLarge ? "13px" : "9px",
        fontWeight: 700,
        textAlign: "center",
        letterSpacing: "0.06em",
        userSelect: "none",
      }}
    >
      ✓ Sponsored
    </Box>
  )
}

export default SupportedRibbon
