"use client";
import { useAuthStore } from "@/store/authStore";
import { useRouter } from "next/navigation";
import { Button, Box } from "@chakra-ui/react";

const Dashboard = () => {
  const { user } = useAuthStore();

  const router = useRouter();

  if (!user) {
    return <h1>Loading...</h1>;
  }

  const handleNavigate = () => {
    router.push('/admin/children')
  }
  return (
    <Box p={8}>
      <h1>Welcome, {user.email || "Guest"}</h1>
      <Button className="bg-indigo-900 text-semibold text-semibold text-white" p={4} fontSize={16} onClick={handleNavigate}>Manage Children</Button>
    </Box>
  );
};

export default Dashboard;
