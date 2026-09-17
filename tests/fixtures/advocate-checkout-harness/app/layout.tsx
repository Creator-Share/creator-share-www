import type { ReactNode } from "react"

import { Providers } from "@/components/Providers"
import { Toaster } from "@/components/ui/toaster"
import "@/styles/globals.css"

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  )
}
