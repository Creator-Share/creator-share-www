import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

const EXPECTED_MATCHERS = [
  "/((?!_next/static|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  "/((?!_next/static(?:/|$)).*)",
]
const EXPECTED_SIBLING_HOST_MATCHER =
  "(?:(?:[a-z0-9-]+\\.)+creatorshare\\.com\\.?|(?:[a-z0-9-]+\\.)+localhost)(?::[0-9]+)?"

async function readJson(pathname) {
  return JSON.parse(await readFile(resolve(process.cwd(), pathname), "utf8"))
}

const functionsManifest = await readJson(
  ".next/server/functions-config-manifest.json",
)
if (functionsManifest.functions?.["/_middleware"] !== undefined) {
  throw new Error("Advocate middleware was unexpectedly emitted for Node.js")
}

const edgeManifest = await readJson(".next/server/middleware-manifest.json")
const middleware = edgeManifest.middleware?.["/"]
if (middleware === undefined) {
  throw new Error("Advocate middleware was not emitted for Edge")
}
if (
  !Array.isArray(middleware.matchers) ||
  middleware.matchers.length !== EXPECTED_MATCHERS.length ||
  middleware.matchers.some(
    (matcher, index) => matcher.originalSource !== EXPECTED_MATCHERS[index],
  )
) {
  throw new Error("Advocate middleware matcher does not match the release gate")
}
if (
  middleware.matchers[1]?.has?.length !== 1 ||
  middleware.matchers[1].has[0]?.type !== "host" ||
  middleware.matchers[1].has[0]?.value !== EXPECTED_SIBLING_HOST_MATCHER
) {
  throw new Error(
    "Advocate sibling Host matcher does not match the release gate",
  )
}

console.log("Advocate Edge middleware build gate passed")
