import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { requireSuperAdmin } from "@/utils/auth/requireSuperAdmin"

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const auth = await requireSuperAdmin(supabase)
    if (!auth.ok) return auth.response

    const { userId, roleId } = await request.json()

    if (!userId || !roleId) {
      return NextResponse.json(
        { error: "userId and roleId are required" },
        { status: 400 }
      )
    }

    // Check if role assignment already exists
    const { data: existingAssignment } = await supabase
      .from("role_assignments")
      .select("id")
      .eq("user_id", userId)
      .eq("role_id", roleId)
      .single()

    if (existingAssignment) {
      return NextResponse.json(
        { error: "User already has this role" },
        { status: 400 }
      )
    }

    // Assign role to user
    const { error } = await supabase
      .from("role_assignments")
      .insert({
        user_id: userId,
        role_id: roleId,
      })

    if (error) {
      console.error("Error assigning role:", error)
      return NextResponse.json({ error: "Failed to assign role" }, { status: 500 })
    }

    return NextResponse.json({ message: "Role assigned successfully" })
  } catch (error) {
    console.error("Unexpected error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
