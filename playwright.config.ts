import { defineConfig, devices } from "@playwright/test"

/**
 * When port 3000 is already taken, `next dev` binds to another port but this
 * config still waits on :3000 and times out. Set PW_NO_WEBSERVER=1 to reuse an
 * app you already started (e.g. `npm run dev` on 3000), or set PLAYWRIGHT_DEV_PORT
 * so the spawned dev server and baseURL stay in sync (default 3000).
 */
const devPort = process.env.PLAYWRIGHT_DEV_PORT ?? "3000"
const devOrigin = `http://localhost:${devPort}`
const runWebKitReleaseGate = process.env.RUN_WEBKIT_BROWSER_INTEGRATION === "1"

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: devOrigin,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: runWebKitReleaseGate
    ? [
        {
          name: "webkit",
          use: { ...devices["iPhone 15 Pro"] },
        },
      ]
    : [
        {
          name: "chromium",
          use: { ...devices["Desktop Chrome"] },
        },
      ],
  webServer: process.env.PW_NO_WEBSERVER
    ? undefined
    : {
        command: `npm run dev -- --port ${devPort}`,
        url: devOrigin,
        reuseExistingServer: true,
        timeout: 120000,
        env: {
          // A developer machine supplies these through .env.local, but a CI
          // runner has no such file and the dev server refuses to boot without
          // them. Every browser spec intercepts its own network, so loopback
          // placeholders give full coverage while making it impossible for the
          // suite to reach a real project. Real values still win when present.
          // These live here rather than in the workflow because the FF-029
          // contract forbids that workflow from naming a Supabase key variable.
          NEXT_PUBLIC_SUPABASE_URL:
            process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321",
          NEXT_PUBLIC_SUPABASE_ANON_KEY:
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "ci-browser-anon-key",
        },
      },
})
