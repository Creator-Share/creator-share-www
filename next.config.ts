import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: ["@chakra-ui/react"],
  },

  async redirects() {
    return [
      {
        source: "/sponsorships",
        destination: "/",
        permanent: true,
      },
    ]
  },

  /**
   * Serve /street, /care, and /dogs from the root page so there is only one
   * page.tsx.  The browser URL stays as-is (e.g. /street); SponsorshipsContainer
   * reads window.location.pathname on mount and applies the correct type filter.
   */
  async rewrites() {
    return [
      { source: "/street", destination: "/" },
      { source: "/care",   destination: "/" },
      { source: "/dogs",   destination: "/" },
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
      {
        protocol: "https",
        hostname: "*.supabase.co",
      },
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
