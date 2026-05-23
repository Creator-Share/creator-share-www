"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import {
  Box,
  Flex,
  Text,
  Button,
  IconButton,
  VStack,
  Spacer,
} from "@chakra-ui/react"
import { IoMdNotificationsOutline } from "react-icons/io"
import { usePathname, useRouter } from "next/navigation"

interface Notification {
  id: string
  title: string
  message: string
  type: string
  link: string | null
  read: boolean
  created_at: string
}

export function AdminNotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const pathname = usePathname()
  const router = useRouter()

  // Don't render on non-admin pages (moved below hooks to avoid Rules of Hooks violations)
  const isAdminPage = pathname?.startsWith("/admin")

  const fetchNotifications = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch("/api/admin/notifications?limit=10")
      if (!res.ok) return
      const data = await res.json()
      setNotifications(data.notifications || [])
      setUnreadCount(data.unreadCount || 0)
    } catch (err) {
      console.error("[NotificationBell] Fetch error:", err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchNotifications()
    // Poll every 2 minutes for new notifications
    const interval = setInterval(fetchNotifications, 120_000)
    return () => clearInterval(interval)
  }, [fetchNotifications])

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside)
      return () => document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [isOpen])

  const markAsRead = async (id?: string) => {
    // Snapshot previous state for rollback on failure
    const prevNotifications = notifications
    const prevUnreadCount = unreadCount

    // Optimistic update
    if (id) {
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
      )
      setUnreadCount((c) => Math.max(0, c - 1))
    } else {
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
      setUnreadCount(0)
    }

    try {
      const res = await fetch("/api/admin/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(id ? { id } : {}),
      })
      if (!res.ok) throw new Error("PATCH returned " + res.status)
    } catch (err) {
      // Rollback optimistic update on failure
      setNotifications(prevNotifications)
      setUnreadCount(prevUnreadCount)
      console.error("[NotificationBell] Mark as read error:", err)
    }
  }

  const handleNotificationClick = (notification: Notification) => {
    if (!notification.read) {
      markAsRead(notification.id)
    }
    if (notification.link) {
      router.push(notification.link)
      setIsOpen(false)
    }
  }

  const timeAgo = (dateStr: string) => {
    const now = new Date()
    const date = new Date(dateStr)
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60_000)
    if (diffMins < 1) return "just now"
    if (diffMins < 60) return `${diffMins}m ago`
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    const diffDays = Math.floor(diffHours / 24)
    return `${diffDays}d ago`
  }

  // Check for unread indicator
  const hasUnread = unreadCount > 0

  if (!isAdminPage) return null

  return (
    <Box position="relative" ref={dropdownRef}>
      <IconButton
        aria-label="Notifications"
        variant="ghost"
        borderRadius="full"
        size="sm"
        onClick={() => {
          setIsOpen(!isOpen)
          if (!isOpen) fetchNotifications()
        }}
        position="relative"
      >
        <Box position="relative">
          <IoMdNotificationsOutline size={20} />
          {hasUnread && (
            <Box
              position="absolute"
              top="-4px"
              right="-4px"
              width="16px"
              height="16px"
              borderRadius="full"
              bg="red.500"
              color="white"
              fontSize="10px"
              fontWeight="bold"
              display="flex"
              alignItems="center"
              justifyContent="center"
              lineHeight="1"
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </Box>
          )}
        </Box>
      </IconButton>

      {isOpen && (
        <Box
          position="absolute"
          top="100%"
          right="0"
          mt={2}
          width="360px"
          maxHeight="480px"
          bg="white"
          borderRadius="lg"
          boxShadow="0 4px 24px rgba(0,0,0,0.12)"
          border="1px solid"
          borderColor="gray.200"
          zIndex={9999}
          overflow="hidden"
          display="flex"
          flexDirection="column"
        >
          {/* Header */}
          <Flex
            px={4}
            py={3}
            borderBottom="1px solid"
            borderColor="gray.200"
            align="center"
          >
            <Text fontSize="sm" fontWeight="semibold" color="gray.900">
              Notifications
            </Text>
            <Spacer />
            {hasUnread && (
              <Button
                size="xs"
                variant="ghost"
                color="blue.600"
                onClick={() => markAsRead()}
                fontSize="xs"
              >
                Mark all as read
              </Button>
            )}
          </Flex>

          {/* List */}
          <Box flex="1" overflowY="auto">
            {loading && notifications.length === 0 ? (
              <Text px={4} py={8} textAlign="center" color="gray.500" fontSize="sm">
                Loading...
              </Text>
            ) : notifications.length === 0 ? (
              <Text px={4} py={8} textAlign="center" color="gray.500" fontSize="sm">
                No notifications yet
              </Text>
            ) : (
              <VStack gap={0} align="stretch">
                {notifications.map((notification) => (
                  <Box
                    key={notification.id}
                    px={4}
                    py={3}
                    cursor="pointer"
                    borderBottom="1px solid"
                    borderColor="gray.100"
                    bg={notification.read ? "white" : "blue.50"}
                    _hover={{ bg: notification.read ? "gray.50" : "blue.100" }}
                    onClick={() => handleNotificationClick(notification)}
                    transition="background 0.15s"
                  >
                    <Flex justify="space-between" align="start" mb={1}>
                      <Text
                        fontSize="sm"
                        fontWeight={notification.read ? "normal" : "semibold"}
                        color="gray.900"
                        css={{ lineClamp: 1 }}
                      >
                        {notification.title}
                      </Text>
                      <Text
                        fontSize="xs"
                        color="gray.500"
                        whiteSpace="nowrap"
                        ml={2}
                        flexShrink={0}
                      >
                        {timeAgo(notification.created_at)}
                      </Text>
                    </Flex>
                    <Text
                      fontSize="xs"
                      color="gray.600"
                      css={{ lineClamp: 2 }}
                      lineHeight="1.4"
                    >
                      {notification.message}
                    </Text>
                  </Box>
                ))}
              </VStack>
            )}
          </Box>
        </Box>
      )}
    </Box>
  )
}
