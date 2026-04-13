"use client"
import { Box, Stack, Button, Text } from "@chakra-ui/react"
import Image from "next/image"
const Verified = () => {
  return (
    <Box className="flex items-center justify-center min-h-screen p-4">
      <Box className="w-full max-w-md p-6 bg-[#FFFFFF] md:rounded-xl md:border md:shadow-sm md:px-8 md:py-12">
        <Box className="flex justify-center">
          <Image
            width={200}
            height={200}
            alt="creator"
            src="/creator-text.svg"
          />
        </Box>
        <Box className="text-center my-8">
          <Text className="text-[#03150E] font-semibold text-2xl">
            Account Created
          </Text>
          <Text className="text-[#8D9692] text-base">
            You have successfully created a Creator Share account.
          </Text>
        </Box>
        <Stack>
          <Button className="border bg-[#2b7ff9] text-[#FFFFFF] font-semibold text-base">
            Proceed to Dashboard
          </Button>
          <Button className="border border-[#2b7ff9] text-[#2b7ff9] text-base font-semibold">
            Start a Campaign
          </Button>
        </Stack>
      </Box>
    </Box>
  )
}

export default Verified
