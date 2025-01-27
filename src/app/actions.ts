import { supabase } from "@/utils/supabaseClient";
import { loginForm } from "@/types";
import { useRouter } from 'next/navigation';


export const fetchUserRoles = async (userId: string): Promise<string[]> => {
  try {
    const { data, error } = await supabase
      .from("role_assignments")
      .select(`roles!role_assignments_role_id_fkey(name)`)
      .eq("user_id", userId);

    if (error) {
      console.error("Error fetching user role assignments:", error.message);
      return [];
    }

    // Handle roles data structure
    const roleNames = data.flatMap((role: { roles: { name: string } | { name: string }[] }) => {
      if (Array.isArray(role.roles)) {
        return role.roles.map((r) => r.name);
      }
      return role.roles.name;
    });

    console.log("Extracted role names:", roleNames);
    return roleNames;
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error("Unexpected error fetching roles:", error.message);
    } else {
      console.error("Unexpected error fetching roles:", error); // Handle non-Error cases
    }
    return [];
  }
};

export const loginAction = async (
  data: loginForm,
  login: (email: string, password: string) => Promise<{ error?: string }>,
  fetchUser: () => Promise<void>,
  router: ReturnType<typeof useRouter>
): Promise<void> => {
  const { email, password } = data;

  const { error } = await login(email, password);

  if (error) {
    console.error("Login failed:", error);
    return;
  }

  // Fetch the user details from authStore
  await fetchUser();
  const userId = (await supabase.auth.getUser()).data.user?.id;

  console.log("Fetched User ID:", userId);

  if (!userId) {
    console.error("Unable to fetch user ID");
    return;
  }

  const roleNames = await fetchUserRoles(userId);

  console.log("Logged in user's roles:", roleNames);

  if (roleNames.includes("SUPER_ADMIN")) {
    console.log("Redirecting to /choose-dashboard...");
    router.push("/admin-panel/choose-dashboard");
  } else {
    console.log("Redirecting to /...");
    router.push("/");
  }
};
