import { NextResponse } from "next/server"
import { createClient, createServiceRoleClient } from "@/utils/supabase/server"
import { UserInvitation } from "@/types/admin.types"
import { requireSuperAdmin } from "@/utils/auth/requireSuperAdmin"
import {
  replaceCreatorShareRoles,
  roleChangeReason,
} from "@/utils/admin/creatorShareRoles"

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const auth = await requireSuperAdmin(supabase)
    if (!auth.ok) return auth.response
    const { user } = auth

    const serviceSupabase = createServiceRoleClient()
    const invitation: UserInvitation = await request.json()
    const { email, role_ids } = invitation
    const reason = (invitation as UserInvitation & { reason?: string }).reason

    if (!email || !role_ids || role_ids.length === 0) {
      return NextResponse.json(
        { error: "Email and role_ids are required" },
        { status: 400 }
      )
    }
    // Use Supabase's built-in inviteUserByEmail
    const { data: inviteData, error: inviteError } = await serviceSupabase.auth.admin.inviteUserByEmail(
      email,
      {
        data: {
          invited_by: user.id  // Only track who invited, no role_ids here
        },
        redirectTo: `${process.env.NEXT_PUBLIC_BASE_URL || 'https://creator-share-www.vercel.app'}/set-password`
      }
    )

    if (inviteError) {
      console.error("Error inviting user:", inviteError)
      return NextResponse.json({ 
        error: "Failed to invite user", 
        details: inviteError.message 
      }, { status: 500 })
    }

    let roles
    try {
      roles = await replaceCreatorShareRoles(
        supabase,
        request,
        inviteData.user.id,
        role_ids,
        roleChangeReason(
          reason,
          "Administrator assigned initial Creator Share roles to an invited user",
        ),
      )
    } catch (roleError) {
      console.error("Error assigning roles to invited user:", roleError)
      return NextResponse.json({ 
        error: "User invited but roles could not be assigned",
        details: roleError instanceof Error ? roleError.message : "Unknown error",
      }, { status: 500 })
    }

    return NextResponse.json(
      { 
        message: "User invited and roles assigned successfully", 
        user: inviteData.user,
        roles,
        invitationSent: true
      },
      { status: 201 }
    )
  } catch (error) {
    console.error("Unexpected error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
