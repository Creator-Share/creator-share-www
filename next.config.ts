import type { NextConfig } from "next"

import {
  assertAdvocateStagingExternalProviderBoundary,
  assertAdvocateStagingSupabaseBoundary,
} from "./src/lib/advocates/stagingDeploymentBoundary"
import {
  assertStagingPayPalPaymentEnvironment,
  assertStagingStripePaymentEnvironment,
} from "./src/lib/sponsorships/checkout/stagingPaymentBoundary"

assertAdvocateStagingSupabaseBoundary(process.env)
assertAdvocateStagingExternalProviderBoundary(process.env)
assertStagingStripePaymentEnvironment(process.env)
assertStagingPayPalPaymentEnvironment(process.env)

function configuredSupabaseImagePatterns() {
  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!configured || configured !== configured.trim()) return []

  try {
    const url = new URL(configured)
    const localDevelopment =
      process.env.NODE_ENV !== "production" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    if (
      (url.protocol !== "https:" &&
        !(localDevelopment && url.protocol === "http:")) ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      return []
    }

    const origin = {
      protocol:
        url.protocol === "http:" ? ("http" as const) : ("https" as const),
      hostname: url.hostname,
      port: url.port,
    }
    return [
      {
        ...origin,
        pathname: "/storage/v1/object/public/media/**",
      },
      {
        ...origin,
        pathname: "/storage/v1/object/public/advocate-assets/**",
      },
    ]
  } catch {
    return []
  }
}

const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: ["@chakra-ui/react"],
    globalNotFound: true,
  },

  /**
   * Serve /street, /care, and /dogs from the root page so there is only one
   * page.tsx.  The browser URL stays as-is (e.g. /street); SponsorshipsContainer
   * reads window.location.pathname on mount and applies the correct type filter.
   */
  async rewrites() {
    return [
      { source: "/child_laborers", destination: "/" },
      { source: "/special_needs", destination: "/" },
      { source: "/in_our_care", destination: "/" },
      { source: "/dogs", destination: "/" },
      { source: "/about", destination: "/" },
      { source: "/centers", destination: "/" },
      { source: "/contact", destination: "/" },
      { source: "/faq", destination: "/" },
      { source: "/signin", destination: "/" },
      { source: "/login", destination: "/" },
    ]
  },

  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "tile.openstreetmap.org",
      },
      {
        protocol: "https",
        hostname: "cdn.pixabay.com",
      },
      {
        protocol: "https",
        hostname: "static.wixstatic.com",
      },
      {
        protocol: "https",
        hostname: "media.istockphoto.com",
      },
      ...configuredSupabaseImagePatterns(),
    ],
  },

  webpack: (config, { isServer }) => {
    // SVG handling
    config.module.rules.push({
      test: /\.svg$/,
      use: ["@svgr/webpack"],
    })

    // MSW handling
    if (isServer) {
      if (Array.isArray(config.resolve.alias)) {
        config.resolve.alias.push({ name: "msw/browser", alias: false })
      } else {
        config.resolve.alias["msw/browser"] = false
      }
    } else {
      if (Array.isArray(config.resolve.alias)) {
        config.resolve.alias.push({ name: "msw/node", alias: false })
      } else {
        config.resolve.alias["msw/node"] = false
      }
    }

    return config
  },
}

export default nextConfig
