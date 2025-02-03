import { redirect } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import { RoleAssignment } from "@/types";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: roleData } = await supabase
    .from("role_assignments")
    .select("roles:roles!role_assignments_role_id_fkey(name)")
    .eq("user_id", user.id)  as unknown as { data: RoleAssignment[]; };

  if ( !roleData || roleData.length === 0 || roleData[0]?.roles?.name !== "SUPER_ADMIN") {
    redirect('/not-found')
  }

  return <>{children}</>
}
