import { NextResponse } from "next/server"
import { createClient, createServiceRoleClient } from "@/utils/supabase/server"
import { RoleAssignmentResponse } from "@/types"
import { UserInvitation } from "@/types/admin.types"

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const serviceSupabase = createServiceRoleClient()
    
    // Check if user is authenticated and has SUPER_ADMIN role
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Check user role - handle multiple roles
    const { data: roleData, error: roleCheckError } = await serviceSupabase
      .from("role_assignments")
      .select(`
        roles:roles!role_assignments_role_id_fkey(name)
      `)
      .eq("user_id", user.id)

    const typedRoleData = (roleData as unknown) as RoleAssignmentResponse
    const hasSuperAdminRole = typedRoleData?.some((assignment) => 
      assignment.roles.name === "SUPER_ADMIN"
    )

    if (roleCheckError || !roleData || !hasSuperAdminRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const invitation: UserInvitation = await request.json()
    const { email, role_ids } = invitation

    if (!email || !role_ids || role_ids.length === 0) {
      return NextResponse.json(
        { error: "Email and role_ids are required" },
        { status: 400 }
      )
    }

    console.log("Attempting to invite user:", email, "with roles:", role_ids)

    // Use Supabase's built-in inviteUserByEmail with first role as primary
    const { data: inviteData, error: inviteError } = await serviceSupabase.auth.admin.inviteUserByEmail(
      email,
      {
        data: {
          role_ids: role_ids, // Store all role IDs for later assignment
          invited_by: user.id
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

    console.log("Invitation sent successfully:", inviteData)

    return NextResponse.json(
      { 
        message: "User invited successfully", 
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