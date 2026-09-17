import { Reddit_Sans } from "next/font/google"

import { NotFoundContent } from "@/components/NotFoundContent"
import "@/styles/globals.css"

const redditSans = Reddit_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-reddit-sans",
  display: "swap",
})

export default function GlobalNotFound() {
  return (
    <html
      lang="en"
      className={redditSans.variable}
      data-theme="light"
      style={{ colorScheme: "light" }}
    >
      <body className="min-h-screen bg-white">
        <NotFoundContent />
      </body>
    </html>
  )
}
