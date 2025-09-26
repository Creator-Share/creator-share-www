"use client"

import { Suspense } from "react"
import { Box, Text } from "@chakra-ui/react"
import dynamic from "next/dynamic"

const CheckoutContent = dynamic(() => import("./CheckoutContent"), {
  ssr: false,
})

export default function CheckoutPage() {
  return (
    <Suspense
      fallback={
        <Box className="w-full min-h-screen p-4 flex items-center justify-center">
          <Text>Loading checkout...</Text>
        </Box>
      }
    >
      <CheckoutContent />
    </Suspense>
  )
}
