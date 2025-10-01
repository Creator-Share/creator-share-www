import { redirect } from "next/navigation"
import { createClient } from "@/utils/supabase/server"
import {  RoleAssignmentResponse } from "@/types"

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  const { data: roleData } = await supabase
    .from("role_assignments")
    .select("roles:roles!role_assignments_role_id_fkey(name)")
    .eq("user_id", user.id)

  console.log("DEBUG - AdminLayout roleData:", JSON.stringify(roleData, null, 2))

  // Check if user has SUPER_ADMIN role among any of their assigned roles
  const typedRoleData = (roleData as unknown) as RoleAssignmentResponse
  const hasSuperAdminRole = typedRoleData?.some((assignment) => 
    assignment.roles.name === "SUPER_ADMIN"
  )

  console.log("DEBUG - AdminLayout hasSuperAdminRole:", hasSuperAdminRole)

  if (!roleData || !hasSuperAdminRole) {
    redirect("/not-found")
  }

  return <>{children}</>
}
