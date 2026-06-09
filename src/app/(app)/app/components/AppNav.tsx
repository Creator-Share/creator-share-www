"use client"

import { usePathname, useRouter } from "next/navigation"
import Link from "next/link"
import { Box, Flex, Text, IconButton } from "@chakra-ui/react"
import { FiHome, FiCreditCard, FiMenu, FiX, FiLogOut } from "react-icons/fi"
import { useAuthStore } from "@/store/authStore"
import { useState } from "react"

const NAV_ITEMS = [
  { href: "/app", label: "Dashboard", icon: FiHome },
  { href: "/app/transactions", label: "Transactions", icon: FiCreditCard },
] as const

// ── Shared rendering for nav items (used by both mobile drawer and desktop sidebar) ──

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
  const [mobileOpen, setMobileOpen] = useState(false)

  const isActive = (href: string) => {
    if (href === "/app") return pathname === "/app"
    return pathname.startsWith(href)
  }

  return (
    <>
      {/* ── Mobile top bar ── */}
      <Flex
        display={{ base: "flex", md: "none" }}
        align="center"
        justify="space-between"
        px={4}
        py={3}
        bg="white"
        borderBottom="1px"
        borderColor="gray.100"
        position="sticky"
        top={0}
        zIndex={50}
      >
        <Text fontWeight="700" fontSize="md" color="gray.800">
          My Account
        </Text>
        <IconButton
          aria-label="Toggle navigation"
          variant="ghost"
          size="sm"
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          {mobileOpen ? <FiX /> : <FiMenu />}
        </IconButton>
      </Flex>

      {/* ── Mobile drawer overlay ── */}
      {mobileOpen && (
        <Box
          display={{ base: "block", md: "none" }}
          position="fixed"
          inset={0}
          bg="rgba(0,0,0,0.3)"
          zIndex={40}
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* ── Mobile drawer ── */}
      <Box
        display={{ base: "block", md: "none" }}
        position="fixed"
        top="52px"
        left={0}
        bottom={0}
        w="240px"
        bg="white"
        borderRight="1px"
        borderColor="gray.100"
        zIndex={45}
        transform={mobileOpen ? "translateX(0)" : "translateX(-100%)"}
        transition="transform 0.2s ease"
        shadow="lg"
        pt={4}
      >
        <Flex direction="column" h="full">
          <NavItems activeFn={isActive} onItemClick={() => setMobileOpen(false)} />
          <Box flex={1} />
          <NavFooter email={user?.email} />
        </Flex>
      </Box>

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
