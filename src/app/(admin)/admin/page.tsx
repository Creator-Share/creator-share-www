"use client"
import { useAuthStore } from "@/store/authStore"
import Link from "next/link"
import { Button, Box, SimpleGrid } from "@chakra-ui/react"
import { LogoLoader } from "@/components/common/LogoLoader"

const Dashboard = () => {
  const { user } = useAuthStore()

  if (!user) {
    return <LogoLoader size="lg" minHeight="100vh" />
  }

  const navigationItems = [
    { label: "Manage Users", path: "/admin/users" },
    { label: "Manage Beneficiaries", path: "/admin/beneficiaries" },
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
              className="w-full text-white"
              bg="#2b7ff9"
              _hover={{ bg: "#1a6fe0" }}
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
