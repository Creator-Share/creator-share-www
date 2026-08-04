import { handleAdvocateInvitationEmailRequest } from "@/lib/advocates/invitations/emailRoute"
import { createAdvocateInvitationEmailWorkerDependencies } from "@/lib/advocates/invitations/emailRuntime"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

async function handle(request: Request): Promise<Response> {
  return handleAdvocateInvitationEmailRequest(request, {
    createWorkerDependencies({ config }) {
      return createAdvocateInvitationEmailWorkerDependencies({ config })
    },
  })
}

export const GET = handle
export const POST = handle
