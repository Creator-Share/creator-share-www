"use client"
import React from "react"
import { Box } from "@chakra-ui/react"

interface SupportedCheckBadgeProps {
  size?: "sm" | "lg"
}

const SupportedCheckBadge: React.FC<SupportedCheckBadgeProps> = ({
  size = "sm",
}) => {
  const isLarge = size === "lg"
  const dimension = isLarge ? 64 : 42
  const offset = isLarge ? 12 : 8
  const petalCount = 11
  const petalStep = 360 / petalCount
  const petals = Array.from({ length: petalCount })

  return (
    <Box
      position="absolute"
      right={`${offset}px`}
      bottom={`${offset}px`}
      width={`${dimension}px`}
      height={`${dimension}px`}
      filter="drop-shadow(0 7px 14px rgba(15, 23, 42, 0.24))"
      zIndex={10}
      pointerEvents="none"
      role="img"
      aria-label="Receiving support"
    >
      <svg
        viewBox="0 0 120 120"
        width="100%"
        height="100%"
        role="img"
        aria-hidden="true"
      >
        <g opacity="0.38">
          {petals.map((_, index) => (
            <path
              key={`outer-${index}`}
              d="M60 10 C70 18 77 35 60 54 C43 35 50 18 60 10Z"
              transform={`rotate(${index * petalStep + petalStep / 2} 60 60)`}
              fill="#2b7ff9"
            />
          ))}
        </g>
        <g opacity="1">
          {petals.map((_, index) => (
            <path
              key={`inner-${index}`}
              d="M60 18 C70 27 76 43 60 62 C44 43 50 27 60 18Z"
              transform={`rotate(${index * petalStep} 60 60)`}
              fill="#1f73ea"
            />
          ))}
        </g>
        <circle cx="60" cy="60" r="29" fill="#2b7ff9" />
        <circle
          cx="60"
          cy="60"
          r="26.75"
          fill="none"
          stroke="white"
          strokeWidth="4.5"
        />
        <path
          d="M48 60.4 56.2 68.4 73 51"
          fill="none"
          stroke="white"
          strokeWidth="7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </Box>
  )
}

export default SupportedCheckBadge
