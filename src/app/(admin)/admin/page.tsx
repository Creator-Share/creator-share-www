"use client";
import { useAuthStore } from "@/store/authStore";
import { useRouter } from "next/navigation";
import { Button, Box, SimpleGrid } from "@chakra-ui/react";

const Dashboard = () => {
  const { user } = useAuthStore();
  const router = useRouter();

  if (!user) {
    return <h1>Loading...</h1>;
  }

  const navigationItems = [
    { label: 'Manage Children', path: '/admin/children' },
    { label: 'Manage Child Laborers', path: '/admin/child-laborer' },
    { label: 'Manage Street Involved', path: '/admin/street-involved' },
    { label: 'Manage Families in Need', path: '/admin/family-in-need' },
    { label: 'Manage Animals', path: '/admin/animals' },
    { label: 'Manage Activities', path: '/admin/activities' },
  ];

  const handleNavigate = (path: string) => {
    router.push(path);
  };

  return (
    <Box p={8}>
      <h1 className="text-2xl font-bold mb-6">Welcome to Admin Dashboard, {user.email || "Guest"}</h1>
      <SimpleGrid columns={[1, 2, 3]} gap={4}>
        {navigationItems.map((item) => (
          <Button
            key={item.path}
            onClick={() => handleNavigate(item.path)}
            className="bg-indigo-900 text-white hover:bg-indigo-800"
            p={4}
            fontSize={16}
            h="auto"
            whiteSpace="normal"
          >
            {item.label}
          </Button>
        ))}
      </SimpleGrid>
    </Box>
  );
};

export default Dashboard;
