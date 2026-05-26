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
  const dimension = isLarge ? 58 : 38
  const offset = isLarge ? 3 : 1

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
        viewBox="0 0 72 72"
        width="100%"
        height="100%"
        role="img"
        aria-hidden="true"
      >
        <g transform="translate(36 36)">
          {Array.from({ length: 12 }).map((_, index) => (
            <ellipse
              key={`outer-${index}`}
              cx="0"
              cy="-20"
              rx="7.2"
              ry="13.8"
              transform={`rotate(${index * 30})`}
              fill={index % 2 === 0 ? "#2b7ff9" : "#1f73ea"}
            />
          ))}
          {Array.from({ length: 8 }).map((_, index) => (
            <ellipse
              key={`inner-${index}`}
              cx="0"
              cy="-14"
              rx="5.6"
              ry="10.8"
              transform={`rotate(${index * 45 + 22.5})`}
              fill="#5da0ff"
              opacity="0.92"
            />
          ))}
        </g>
        <circle
          cx="36"
          cy="36"
          r="21.8"
          fill="none"
          stroke="white"
          strokeWidth="3.4"
        />
        <circle cx="36" cy="36" r="18.2" fill="#2b7ff9" />
        <circle
          cx="36"
          cy="36"
          r="13.5"
          fill="none"
          stroke="rgba(255,255,255,0.36)"
          strokeWidth="1.6"
        />
        <path
          d="M26.5 36.4 33 42.8 46.8 29.1"
          fill="none"
          stroke="white"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </Box>
  )
}

export default SupportedCheckBadge
