"use client";
import { useAuthStore } from "@/store/authStore";

const Dashboard = () => {
  const { user } = useAuthStore();

  if (!user) {
    return <h1>Loading...</h1>;
  }

  return (
    <div>
      <h1>Welcome, {user.email || "Guest"}</h1>
    </div>
  );
};

export default Dashboard;
