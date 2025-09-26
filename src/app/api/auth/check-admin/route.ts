import { createClient } from "@/utils/supabase/server"
import { NextResponse } from "next/server"
import { RoleAssignment } from "@/types"

export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ isAdmin: false })
    }

    const { data: roleData } = (await supabase
      .from("role_assignments")
      .select(
        `
        roles:roles!role_assignments_role_id_fkey(name)
      `,
      )
      .eq("user_id", user.id)) as { data: RoleAssignment[] | null }

    const isAdmin = roleData?.[0]?.roles?.name === "SUPER_ADMIN"
    return NextResponse.json({ isAdmin })
  } catch (error) {
    console.error("Error checking admin:", error)
    return NextResponse.json({ isAdmin: false })
  }
}
