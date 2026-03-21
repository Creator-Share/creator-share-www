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
    <html className={redditSans.variable}>
      <body className="bg-[#F5F5F5] flex flex-col min-h-screen overflow-x-hidden">
        <Providers>
          <main className="flex-1">
            <PageWrapper>{children}</PageWrapper>
          </main>
          <Toaster />
        </Providers>
      </body>
    </html>
  )
}
