import { Box, Text } from "@chakra-ui/react"
import Image from "next/image"

export default function VerifyAccountPage() {
  return (
    <Box className="flex items-center justify-center min-h-screen p-4">
      <Box className="w-full max-w-md p-6 bg-[#FFFFFF] md:rounded-xl md:border md:shadow-sm md:px-8 md:py-12">
        <Box className="flex justify-center">
          <Image
            width={200}
            height={200}
            alt="Creator Share"
            src="/creator-text.svg"
          />
        </Box>
        <Box className="text-center my-8">
          <Text className="text-[#03150E] font-semibold text-2xl">
            Check your email
          </Text>
          <Text className="text-[#8D9692] text-base">
            If the account can be created, we sent a secure confirmation link.
            Existing account holders can use the sign-in link instead.
          </Text>
        </Box>
      </Box>
    </Box>
  )
}
