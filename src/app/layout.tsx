import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { headers } from "next/headers"
import { Reddit_Sans } from "next/font/google"
import { Providers } from "@/components/Providers"
import "@/styles/globals.css"
import { PageWrapper } from "@/components/PageWrapper"
import { PublicSiteProvider } from "@/components/advocates/PublicSiteProvider"
import { Toaster } from "@/components/ui/toaster"
import { Analytics } from "@vercel/analytics/next"
import { getCurrentPublicSiteResolution } from "@/lib/advocates/currentPublicSite"
import {
  createPaymentPublicSite,
  type PublicSite,
} from "@/lib/advocates/publicSite"
import {
  INTERNAL_ROUTE_SHELL_HEADER,
  TENANT_PAYMENT_SHELL,
} from "@/lib/advocates/tenantRoutePolicy"

const redditSans = Reddit_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-reddit-sans",
  display: "swap",
})

export const dynamic = "force-dynamic"

class PublicSiteOperationalError extends Error {
  constructor(cause: unknown) {
    super("public_site_resolution_failed", { cause })
    this.name = "PublicSiteOperationalError"
  }
}

async function requireCurrentPublicSite(): Promise<PublicSite> {
  const requestHeaders = await headers()
  if (
    requestHeaders.get(INTERNAL_ROUTE_SHELL_HEADER) === TENANT_PAYMENT_SHELL
  ) {
    return createPaymentPublicSite()
  }

  const resolution = await getCurrentPublicSiteResolution()
  if (resolution.kind === "not-found") notFound()
  if (resolution.kind === "operational-failure") {
    throw new PublicSiteOperationalError(resolution.error)
  }
  return resolution.site
}

export async function generateMetadata(): Promise<Metadata> {
  const site = await requireCurrentPublicSite()
  if (site.kind === "payment") {
    return {
      title: "Payment | Creator Share",
      description: "Secure Creator Share sponsorship payment status.",
      robots: { index: false, follow: false },
    }
  }
  if (site.kind === "primary") {
    return {
      title: "Creator Share",
      description: "",
    }
  }

  return {
    title: `${site.displayName} | Creator Share`,
    description: `Explore children eligible for sponsorship through ${site.displayName} and Creator Share.`,
  }
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const site = await requireCurrentPublicSite()

  return (
    <html
      lang="en"
      className={redditSans.variable}
      data-theme="light"
      style={{ colorScheme: "light" }}
    >
      {/* suppressHydrationWarning: browser extensions (e.g. password managers, dark-mode
          injectors) modify <body> attributes client-side, causing a benign mismatch that
          React would otherwise warn about. This is intentional, not a real hydration bug. */}
      <body
        className="flex min-h-screen flex-col overflow-x-hidden"
        suppressHydrationWarning
      >
        <Providers>
          <PublicSiteProvider site={site}>
            <main className="flex-1 max-lg:bg-white">
              {site.kind === "payment" ? (
                <div className="w-full max-w-[1200px] mx-auto px-4 max-lg:pb-0 pb-4 max-lg:bg-white">
                  {children}
                </div>
              ) : (
                <PageWrapper>{children}</PageWrapper>
              )}
            </main>
            <Toaster />
          </PublicSiteProvider>
        </Providers>
        {site.kind === "primary" ? <Analytics /> : null}
      </body>
    </html>
  )
}
