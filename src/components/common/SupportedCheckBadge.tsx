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
        viewBox="0 0 64 64"
        width="100%"
        height="100%"
        role="img"
        aria-hidden="true"
      >
        <g transform="translate(32 32)">
          {Array.from({ length: 12 }).map((_, index) => (
            <ellipse
              key={`outer-${index}`}
              cx="0"
              cy="-20"
              rx="7.4"
              ry="14.5"
              transform={`rotate(${index * 30})`}
              fill={index % 2 === 0 ? "#2b7ff9" : "#1f73ea"}
            />
          ))}
          {Array.from({ length: 8 }).map((_, index) => (
            <ellipse
              key={`inner-${index}`}
              cx="0"
              cy="-14"
              rx="6"
              ry="11"
              transform={`rotate(${index * 45 + 22.5})`}
              fill="#5da0ff"
              opacity="0.92"
            />
          ))}
        </g>
        <circle cx="32" cy="32" r="25.5" fill="none" stroke="white" strokeWidth="3.2" />
        <circle cx="32" cy="32" r="19.5" fill="#2b7ff9" />
        <circle cx="32" cy="32" r="15.5" fill="none" stroke="rgba(255,255,255,0.52)" strokeWidth="2" strokeDasharray="2.8 3.6" />
        <path
          d="M22.5 32.4 29 38.8 42.8 25.1"
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
