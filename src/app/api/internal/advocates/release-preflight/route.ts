import { handleAdvocateReleasePreflightRequest } from "@/lib/advocates/releasePreflightRoute"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 10

export function POST(request: Request): Response {
  return handleAdvocateReleasePreflightRequest(request)
}
