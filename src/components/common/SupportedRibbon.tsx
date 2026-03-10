"use client"
import React from "react"
import { Box } from "@chakra-ui/react"

/**
 * Diagonal corner ribbon for the bottom-right of a child's image.
 * Renders inside a `position: relative` container with `overflow: hidden`.
 */
const SupportedRibbon: React.FC = () => {
  // Container size controls how far the ribbon intrudes into the image.
  // Smaller = more tucked into the corner.
  const size = 96
  const thickness = 30

  return (
    <Box
      position="absolute"
      bottom={0}
      right={0}
      w={`${size}px`}
      h={`${size}px`}
      overflow="hidden"
      zIndex={1}
      pointerEvents="none"
    >
      <Box
        position="absolute"
        style={{
          left: "50%",
          top: "50%",
          width: `${size * 1.6}px`,
          height: `${thickness}px`,
          lineHeight: `${thickness}px`,
          transform: "translate(-50%, -50%) rotate(-45deg)",
          background: "linear-gradient(135deg, #1C3C8C 0%, #0654C6 100%)",
          boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
          color: "#fff",
          fontSize: "9px",
          fontWeight: 700,
          textAlign: "center",
          letterSpacing: "0.06em",
          userSelect: "none",
        }}
      >
        ✓ Sponsored
      </Box>
    </Box>
  )
}

export default SupportedRibbon
