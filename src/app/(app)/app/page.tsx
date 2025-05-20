"use client";
import { useEffect, useState } from "react";
import { DataTable } from "@/components/admin-ui/Tables/data-table";
import { columns, type Subscription } from "./columns";
import { createClient } from "@/utils/supabase/client";
import { Box, Heading, Text } from "@chakra-ui/react";
import { useAuthStore } from "@/store/authStore";
import { ColumnDef } from "@tanstack/react-table";

const UserDashboard = () => {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuthStore();

  useEffect(() => {
    async function fetchSubscriptions() {
      if (!user) return;

      const supabase = createClient();
      const { data, error } = await supabase
        .from("subscriptions")
        .select(`
          *,
          child:beneficiaries(
            name
          )
        `)
        .eq("user_id", user.id);

      if (error) {
        console.error("Error fetching subscriptions:", error);
        return;
      }

      setSubscriptions(data || []);
      setLoading(false);
    }

    fetchSubscriptions();
  }, [user]);

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <Box className="container mx-auto py-8">
      <Box className="mb-8">
        <Heading size="lg" mb={2}>My Sponsorships</Heading>
        <Text color="gray.600">
          Manage your active sponsorships and view payment history
        </Text>
      </Box>
      
      <DataTable
        columns={columns as unknown as ColumnDef<unknown, unknown>[]}
        data={subscriptions}
        controls="bottom"
        tableHeight="h-[50vh]"
      />
    </Box>
  );
};

export default UserDashboard;