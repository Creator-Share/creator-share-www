"use client"
import React from "react"
import { Flex } from "@chakra-ui/react"
import { FaCircleCheck } from "react-icons/fa6"

interface SupportedCheckBadgeProps {
  size?: "sm" | "lg"
}

const SupportedCheckBadge: React.FC<SupportedCheckBadgeProps> = ({
  size = "sm",
}) => {
  const isLarge = size === "lg"

  return (
    <Flex
      position="absolute"
      right={isLarge ? 4 : 2}
      bottom={isLarge ? 4 : 2}
      width={isLarge ? "42px" : "28px"}
      height={isLarge ? "42px" : "28px"}
      align="center"
      justify="center"
      bg="#2b7ff9"
      color="white"
      borderRadius="full"
      border="2px solid white"
      boxShadow="0 4px 12px rgba(0, 0, 0, 0.22)"
      zIndex={10}
      pointerEvents="none"
      aria-label="Receiving support"
    >
      <FaCircleCheck size={isLarge ? 23 : 16} aria-hidden />
    </Flex>
  )
}

export default SupportedCheckBadge
