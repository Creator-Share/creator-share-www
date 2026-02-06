import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: ["@chakra-ui/react"],
    serverActions: {
      bodySizeLimit: '100mb',
    },
    // Increase body size limit for App Router API routes
    serverComponentsExternalPackages: [],
  },
  
  // Configure body size limit for App Router routes
  // This applies to all /app/api/* routes
  serverRuntimeConfig: {
    maxRequestBodySize: '100mb',
  },

  // Increase body size limit for large image uploads (Pages Router)
  api: {
    bodyParser: {
      sizeLimit: '100mb',
    },
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
