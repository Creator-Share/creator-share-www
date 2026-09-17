/**
 * The checkout browser suite builds this fixture from a Playwright worker.
 * Each worker gets its own build directory so parallel workers never share a
 * half-written .next and corrupt one another's manifests.
 *
 * @type {import("next").NextConfig}
 */
const nextConfig = {
  distDir: process.env.CHECKOUT_HARNESS_DIST_DIR || ".next",
}

export default nextConfig
