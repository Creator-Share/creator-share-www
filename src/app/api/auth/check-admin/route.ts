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
      console.log("❌ No user found")
      return NextResponse.json({ isAdmin: false })
    }

    console.log("👤 Auth User ID:", user.id)
    console.log("👤 User Email:", user.email)

    // Use auth.users.id directly - this is the source of truth for authentication
    // The role_assignments table should reference auth.users.id (fixed in migration)
    const { data: roleData, error: roleError } = await supabase
      .from("role_assignments")
      .select(
        `
        roles:roles!role_assignments_role_id_fkey(name)
      `
      )
      .eq("user_id", user.id)

    console.log("🔍 Role Query Error:", roleError)
    console.log("📦 Raw Role Data:", JSON.stringify(roleData, null, 2))

    // Check if any role assignment has SUPER_ADMIN role
    // Cast to unknown first to handle the type mismatch
    const typedRoleData = (roleData as unknown) as RoleAssignmentResponse
    console.log("📋 Typed Role Data:", JSON.stringify(typedRoleData, null, 2))
    
    if (typedRoleData && typedRoleData.length > 0) {
      console.log("🎭 User Roles:")
      typedRoleData.forEach((assignment, index) => {
        console.log(`  [${index}] Role Name:`, assignment.roles?.name)
        console.log(`  [${index}] Full Assignment:`, JSON.stringify(assignment, null, 2))
      })
    } else {
      console.log("⚠️ No role assignments found")
    }

    const isAdmin = typedRoleData?.some((assignment) => 
      assignment.roles.name === "SUPER_ADMIN"
    )
    
    console.log("✅ Is Admin Result:", isAdmin)
    console.log("✅ Final isAdmin (boolean):", !!isAdmin)
    
    return NextResponse.json({ isAdmin: !!isAdmin })
  } catch (error) {
    console.error("❌ Error checking admin:", error)
    return NextResponse.json({ isAdmin: false })
  }
}
