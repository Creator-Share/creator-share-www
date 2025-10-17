import { Text, Box } from "@chakra-ui/react"
import Link from "next/link"
import React from "react"

const AuthMessage = () => {
  return (
    <Box>
      <Text className="text-[#8D9692] text-sm text-center">
        👋 Login is only required for administrators managing the platform.
        <br />
        You can browse and support children without creating an account.
      </Text>
    </Box>
  )
}

export default AuthMessage
