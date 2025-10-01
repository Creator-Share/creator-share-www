import { NextResponse } from "next/server"
import { createClient, createServiceRoleClient } from "@/utils/supabase/server"
import {  RoleAssignmentResponse } from "@/types"
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
    const { email, role_id } = invitation

    if (!email || !role_id) {
      return NextResponse.json(
        { error: "Email and role_id are required" },
        { status: 400 }
      )
    }

    // Check if user already exists
    const { data: existingUser } = await serviceSupabase
      .from("users")
      .select("id")
      .eq("email", email)
      .single()

    if (existingUser) {
      return NextResponse.json(
        { error: "User with this email already exists" },
        { status: 400 }
      )
    }

    // Create user invitation using service role client
    const { data: newUser, error: userError } = await serviceSupabase
      .from("users")
      .insert({
        email,
        first_name: null,
        last_name: null,
      })
      .select()
      .single()

    if (userError) {
      console.error("Error creating user:", userError)
      return NextResponse.json({ error: "Failed to create user" }, { status: 500 })
    }

    // Assign role to user using service role client
    const { error: roleError } = await serviceSupabase
      .from("role_assignments")
      .insert({
        user_id: newUser.id,
        role_id,
      })

    if (roleError) {
      console.error("Error assigning role:", roleError)
      // Clean up the user if role assignment fails
      await serviceSupabase.from("users").delete().eq("id", newUser.id)
      return NextResponse.json({ error: "Failed to assign role" }, { status: 500 })
    }

    return NextResponse.json(
      { message: "User invited successfully" },
      { status: 201 }
    )
  } catch (error) {
    console.error("Unexpected error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
} 