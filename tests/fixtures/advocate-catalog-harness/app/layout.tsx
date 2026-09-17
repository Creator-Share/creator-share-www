"use client"

import type { ReactNode } from "react"
import { ChakraProvider, defaultSystem } from "@chakra-ui/react"

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
      </body>
    </html>
  )
}
