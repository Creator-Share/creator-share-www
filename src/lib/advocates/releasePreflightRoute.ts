import "server-only"

import {
  runAdvocateReleasePreflight,
  type AdvocateReleasePreflightEnvironment,
} from "@/lib/advocates/releasePreflight"
import {
  isAuthorizedPublicationCanaryWorkerRequest,
  loadPublicationCanaryWorkerSecret,
} from "@/lib/advocates/publicationCanary/workerAuth"

export interface AdvocateReleasePreflightRouteDependencies {
  environment?: AdvocateReleasePreflightEnvironment
}

const RESPONSE_HEADERS = Object.freeze({
  "Cache-Control": "private, no-store, max-age=0",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-Robots-Tag": "noindex, nofollow",
})

function response(body: unknown, status: number, allow?: string): Response {
  return Response.json(body, {
    status,
    headers: {
      ...RESPONSE_HEADERS,
      ...(allow === undefined ? {} : { Allow: allow }),
    },
  })
}

export function handleAdvocateReleasePreflightRequest(
  request: Request,
  dependencies: AdvocateReleasePreflightRouteDependencies = {},
): Response {
  if (request.method !== "POST") {
    return response({ code: "method_not_allowed" }, 405, "POST")
  }

  const environment = dependencies.environment ?? process.env
  let expectedSecret: string
  try {
    expectedSecret = loadPublicationCanaryWorkerSecret(environment)
  } catch {
    return response({ code: "preflight_unavailable" }, 503)
  }
  if (
    !isAuthorizedPublicationCanaryWorkerRequest(
      request.headers.get("authorization"),
      expectedSecret,
    )
  ) {
    return response({ code: "unauthorized" }, 401)
  }

  return response(runAdvocateReleasePreflight(environment), 200)
}
