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
  const dimension = isLarge ? 56 : 36
  const offset = isLarge ? 6 : 4
  const outerPetals = Array.from({ length: 12 })
  const innerPetals = Array.from({ length: 12 })

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
        viewBox="0 0 100 100"
        width="100%"
        height="100%"
        role="img"
        aria-hidden="true"
      >
        <g>
          {outerPetals.map((_, index) => (
            <path
              key={`outer-${index}`}
              d="M50 6 C60 15 61 29 50 39 C39 29 40 15 50 6Z"
              transform={`rotate(${index * 30} 50 50)`}
              fill={index % 2 === 0 ? "#2b7ff9" : "#1f73ea"}
            />
          ))}
        </g>
        <g opacity="0.95">
          {innerPetals.map((_, index) => (
            <path
              key={`inner-${index}`}
              d="M50 17 C57 24 57 34 50 42 C43 34 43 24 50 17Z"
              transform={`rotate(${index * 30 + 15} 50 50)`}
              fill="#69a8ff"
            />
          ))}
        </g>
        <circle cx="50" cy="50" r="28" fill="#2b7ff9" />
        <circle
          cx="50"
          cy="50"
          r="23"
          fill="none"
          stroke="rgba(255,255,255,0.42)"
          strokeWidth="3"
        />
        <path
          d="M35 50.5 45.2 60.4 66 39"
          fill="none"
          stroke="white"
          strokeWidth="8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </Box>
  )
}

export default SupportedCheckBadge
