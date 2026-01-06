import {  RoleAssignmentResponse } from "@/types"
import { createClient } from "@/utils/supabase/server"
import { NextResponse } from "next/server"

export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ isAdmin: false })
    }

    // Use auth.users.id directly - this is the source of truth for authentication
    // The role_assignments table should reference auth.users.id (fixed in migration)
    const { data: roleData } = await supabase
      .from("role_assignments")
      .select(
        `
        roles:roles!role_assignments_role_id_fkey(name)
      `
      )
      .eq("user_id", user.id)


    // Check if any role assignment has SUPER_ADMIN role
    // Cast to unknown first to handle the type mismatch
    const typedRoleData = (roleData as unknown) as RoleAssignmentResponse
    

    const isAdmin = typedRoleData?.some((assignment) => 
      assignment.roles.name === "SUPER_ADMIN"
    )
    
    return NextResponse.json({ isAdmin: !!isAdmin })
  } catch (error) {
    console.error("❌ Error checking admin:", error)
    return NextResponse.json({ isAdmin: false })
  }
}
