"use client"

import { usePathname, useRouter } from "next/navigation"
import Link from "next/link"
import { Box, Flex, Text } from "@chakra-ui/react"
import { FiHome, FiCreditCard, FiLogOut } from "react-icons/fi"
import { useAuthStore } from "@/store/authStore"

const NAV_ITEMS = [
  { href: "/app", label: "Dashboard", icon: FiHome },
  { href: "/app/transactions", label: "Transactions", icon: FiCreditCard },
] as const

// ── Shared desktop nav items ──

function NavItems({ activeFn, onItemClick }: {
  activeFn: (href: string) => boolean
  onItemClick?: () => void
}) {
  return (
    <Flex direction="column" gap={1} px={3}>
      {NAV_ITEMS.map((item) => {
        const active = activeFn(item.href)
        const Icon = item.icon
        return (
          <Link key={item.href} href={item.href} onClick={onItemClick}>
            <Flex
              align="center"
              gap={3}
              px={3}
              py={2.5}
              borderRadius="lg"
              bg={active ? "#2b7ff9" : "transparent"}
              color={active ? "white" : "gray.600"}
              _hover={{ bg: active ? "#1a6fe0" : "gray.50" }}
              transition="all 0.12s"
              cursor="pointer"
            >
              <Icon size={16} />
              <Text fontSize="sm" fontWeight={active ? "600" : "400"}>{item.label}</Text>
            </Flex>
          </Link>
        )
      })}
    </Flex>
  )
}

function NavFooter({ email }: { email?: string | null }) {
  const router = useRouter()
  const { logout } = useAuthStore()

  const handleLogout = async () => {
    await logout()
    router.push("/")
  }

  return (
    <Box px={3} pb={4} borderTop="1px" borderColor="gray.100" pt={3}>
      {email && (
        <Text fontSize="xs" color="gray.400" mb={2} px={3} css={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {email}
        </Text>
      )}
      <Flex
        align="center"
        gap={3}
        px={3}
        py={2.5}
        borderRadius="lg"
        color="gray.500"
        _hover={{ bg: "red.50", color: "red.500" }}
        transition="all 0.12s"
        cursor="pointer"
        onClick={handleLogout}
      >
        <FiLogOut size={16} />
        <Text fontSize="sm">Sign out</Text>
      </Flex>
    </Box>
  )
}

export function AppNav() {
  const pathname = usePathname()
  const { user } = useAuthStore()

  const isActive = (href: string) => {
    if (href === "/app") return pathname === "/app"
    return pathname.startsWith(href)
  }

  return (
    <>
      {/* ── Mobile bottom tab bar ── */}
      <Flex
        display={{ base: "flex", md: "none" }}
        position="fixed"
        bottom={0}
        left={0}
        right={0}
        h="64px"
        bg="white"
        borderTop="1px"
        borderColor="gray.100"
        zIndex={50}
        align="center"
        justify="space-around"
        px={2}
        shadow="0 -2px 12px rgba(0,0,0,0.06)"
      >
        {NAV_ITEMS.map((item) => {
          const active = isActive(item.href)
          const Icon = item.icon
          return (
            <Link key={item.href} href={item.href} style={{ textDecoration: "none", flex: 1 }}>
              <Flex
                direction="column"
                align="center"
                justify="center"
                gap={0.5}
                py={2}
                borderRadius="lg"
                color={active ? "#2b7ff9" : "gray.400"}
                transition="all 0.12s"
              >
                <Icon size={20} />
                <Text fontSize="10px" fontWeight={active ? "600" : "400"} letterSpacing="0.02em">
                  {item.label}
                </Text>
              </Flex>
            </Link>
          )
        })}
      </Flex>

      {/* ── Desktop sidebar ── */}
      <Flex
        display={{ base: "none", md: "flex" }}
        direction="column"
        w="220px"
        flexShrink={0}
        bg="white"
        borderRight="1px"
        borderColor="gray.100"
        minH="calc(100vh - 64px)"
        position="sticky"
        top="64px"
      >
        <Flex direction="column" gap={1} px={3} pt={6} flex={1}>
          <NavItems activeFn={isActive} />
        </Flex>
        <NavFooter email={user?.email} />
      </Flex>
    </>
  )
}