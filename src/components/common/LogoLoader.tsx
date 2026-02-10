import { Box, Flex } from "@chakra-ui/react"
import Image from "next/image"

interface LogoLoaderProps {
  size?: "sm" | "md" | "lg"
  minHeight?: string
}

export function LogoLoader({ size = "md", minHeight = "400px" }: LogoLoaderProps) {
  const sizes = {
    sm: 40,
    md: 60,
    lg: 80,
  }

  const logoSize = sizes[size]

  return (
    <Flex
      justify="center"
      align="center"
      minH={minHeight}
      width="100%"
    >
      <Box className="animate-pulse">
        <Image
          src="/logo_icon.svg"
          alt="Loading..."
          width={logoSize}
          height={logoSize}
          priority
        />
      </Box>
    </Flex>
  )
}
