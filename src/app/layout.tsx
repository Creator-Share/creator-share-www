import type { Metadata } from "next"
import { Reddit_Sans } from "next/font/google"
import { Providers } from "@/components/Providers"
import "@/styles/globals.css"
import { PageWrapper } from "@/components/PageWrapper"
import { Toaster } from "@/components/ui/toaster"

const redditSans = Reddit_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-reddit-sans",
  display: "swap",
})

export const metadata: Metadata = {
  title: "Creator Share",
  description: "",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html className={redditSans.variable} data-theme="light" style={{ colorScheme: "light" }}>
      {/* suppressHydrationWarning: browser extensions (e.g. password managers, dark-mode
          injectors) modify <body> attributes client-side, causing a benign mismatch that
          React would otherwise warn about. This is intentional — not a real hydration bug. */}
      <body className="flex flex-col min-h-screen overflow-x-hidden" suppressHydrationWarning>
        <Providers>
          <main className="flex-1 max-lg:bg-white">
            <PageWrapper>{children}</PageWrapper>
          </main>
          <Toaster />
        </Providers>
      </body>
    </html>
  )
}
