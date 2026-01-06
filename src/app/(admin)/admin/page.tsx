"use client"
import { useAuthStore } from "@/store/authStore"
import Link from "next/link"
import { Button, Box, SimpleGrid } from "@chakra-ui/react"

const Dashboard = () => {
  const { user } = useAuthStore()

  if (!user) {
    return <h1>Loading...</h1>
  }

  const navigationItems = [
    { label: "Manage Users", path: "/admin/users" },
    { label: "Manage Children", path: "/admin/children" },
    { label: "Manage Subscriptions", path: "/admin/subscriptions" },
    { label: "Manage Activities", path: "/admin/activities" },
    // { label: 'Manage Child Laborers', path: '/admin/child-laborer' },
    // { label: 'Manage Street Involved', path: '/admin/street-involved' },
    // { label: 'Manage Families in Need', path: '/admin/family-in-need' },
    // { label: 'Manage Animals', path: '/admin/animals' },
  ]

  return (
    <Box p={8}>
      <h1 className="text-2xl font-bold mb-6">
        Welcome to Admin Dashboard, {user.email || "Guest"}
      </h1>
      <SimpleGrid columns={[1, 2, 3]} gap={4}>
        {navigationItems.map((item) => (
          <Link key={item.path} href={item.path}>
            <Button
              className="bg-indigo-900 text-white hover:bg-indigo-800 w-full"
              p={4}
              fontSize={16}
              h="auto"
              whiteSpace="normal"
            >
              {item.label}
            </Button>
          </Link>
        ))}
      </SimpleGrid>
    </Box>
  )
}

export default Dashboard
