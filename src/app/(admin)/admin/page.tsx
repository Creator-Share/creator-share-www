"use client";
import { useAuthStore } from "@/store/authStore";
import { useRouter } from "next/navigation";
import { Button } from "@chakra-ui/react";

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
    <div>
      <h1>Welcome, {user.email || "Guest"}</h1>
      <Button className="bg-indigo-900 text-semibold" onClick={handleNavigate}>Manage Children</Button>
    </div>
  );
};

export default Dashboard;
