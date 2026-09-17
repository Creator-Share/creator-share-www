/**
 * Each Playwright worker builds this fixture into its own directory so
 * parallel workers never share a half-written .next.
 *
 * @type {import("next").NextConfig}
 */
const nextConfig = {
  distDir: process.env.CHECKOUT_HARNESS_DIST_DIR || ".next",
}

export default nextConfig
