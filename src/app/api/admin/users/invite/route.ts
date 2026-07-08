import { NextResponse } from "next/server"
import { createClient, createServiceRoleClient } from "@/utils/supabase/server"
import { UserInvitation } from "@/types/admin.types"
import { requireSuperAdmin } from "@/utils/auth/requireSuperAdmin"

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const auth = await requireSuperAdmin(supabase)
    if (!auth.ok) return auth.response
    const { user } = auth

    const serviceSupabase = createServiceRoleClient()
    const invitation: UserInvitation = await request.json()
    const { email, role_ids } = invitation

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

    // Assign roles immediately — don't defer to a client-callable endpoint
    const newAssignments = role_ids.map((roleId: string) => ({
      user_id: inviteData.user.id,
      role_id: roleId
    }))

    const { error: roleInsertError } = await serviceSupabase
      .from("role_assignments")
      .insert(newAssignments)

    if (roleInsertError) {
      console.error("Error assigning roles to invited user:", roleInsertError)
      return NextResponse.json({ 
        error: "User invited but roles could not be assigned",
        details: roleInsertError.message
      }, { status: 500 })
    }

    return NextResponse.json(
      { 
        message: "User invited and roles assigned successfully", 
        user: inviteData.user,
        invitationSent: true
      },
      { status: 201 }
    )
  } catch (error) {
    console.error("Unexpected error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}