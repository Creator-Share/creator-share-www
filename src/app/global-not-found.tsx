import { redditSans } from "@/app/fonts"

import { NotFoundContent } from "@/components/NotFoundContent"
import "@/styles/globals.css"

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
