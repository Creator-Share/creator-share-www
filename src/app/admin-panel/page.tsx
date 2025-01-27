"use client"
import { useAuthStore } from "@/store/authStore";

const Dashboard = () => {
  const { user } = useAuthStore();

  return (
    <div>
      <h1>Welcome, {user}</h1>
    </div>
  );
};

export default Dashboard;
