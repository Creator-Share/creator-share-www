"use client"
import { useEffect, useState, useCallback } from "react"
import {
  Box,
  Flex,
  Button,
  Image,
  VStack,
  Menu,
  Portal,
} from "@chakra-ui/react"
import NextLink from "next/link"
import { useAuthStore } from "@/store/authStore"
import { usePathname, useRouter } from "next/navigation"
import { GiHamburgerMenu } from "react-icons/gi"
import { IoClose } from "react-icons/io5"
import { AboutUsModal } from "./AboutUsModal"
import { FAQModal } from "./FAQModal"
import { SignInModal } from "./SignInModal"

// const Links = [
//   // { name: "Sponsorships", href: "/" }, // Temporarily hidden
//   // { name: "Lives", href: "/lives" },
//   // { name: "Projects", href: "/projects" },
//   // { name: "Causes", href: "/causes" },
//   // { name: "My Community", href: "/local" },
//   // { name: "Share Abundance", href: "/share" },
//   // { name: "Strays Worth Saving", href: "/strays-worth-saving" },
//   // { name: "Sponsor-a-Family", href: "/family-in-need" },
//   // { name: "Street Involved", href: "/street-involved" },
//   // { name: "Child Laborers", href: "/child-labor" },
//   // { name: "I-Frame Test", href: "/iframe-test" },
// ]

// Valid tab anchors for the About modal
const ABOUT_TAB_ANCHORS = ["about", "centers", "contact"] as const
type AboutTabAnchor = typeof ABOUT_TAB_ANCHORS[number]

/** Hysteresis avoids layout feedback: shrinking the bar changes scrollY and would flip a single threshold forever. */
const NAV_SCROLL_COLLAPSE_PX = 32
const NAV_SCROLL_EXPAND_PX = 6

const NAV_ROW_HEIGHT_COLLAPSED_PX = 64
const NAV_ROW_HEIGHT_EXPANDED_PX = 88
const NAV_ROW_TRANSITION_MS = 300
const navRowTransition = `height ${NAV_ROW_TRANSITION_MS}ms ease-out`

export function PageNavbar() {
  const [isOpen, setIsOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [isScrolled, setIsScrolled] = useState(false)
  const [aboutUsOpen, setAboutUsOpen] = useState(false)
  const [aboutUsDefaultTab, setAboutUsDefaultTab] = useState<AboutTabAnchor>("about")
  const [faqOpen, setFaqOpen] = useState(false)
  const [signInOpen, setSignInOpen] = useState(false)
  const user = useAuthStore((state) => state.user)
  const logout = useAuthStore((state) => state.logout)
  const fetchUser = useAuthStore((state) => state.fetchUser)
  const router = useRouter()
  const pathname = usePathname()
  const [isAdmin, setIsAdmin] = useState(false)

  const isHome = pathname === "/"
  const isHomeLogoExpanded = isHome && !isScrolled

  // Scroll detection for navbar shadow and home logo size (hysteresis prevents bounce near top)
  const handleScroll = useCallback(() => {
    const scrollTop = window.scrollY || document.documentElement.scrollTop
    setIsScrolled((wasScrolled) => {
      if (wasScrolled) {
        return scrollTop > NAV_SCROLL_EXPAND_PX
      }
      return scrollTop > NAV_SCROLL_COLLAPSE_PX
    })
  }, [])

  // Check URL hash or path for modals (About tabs and Sign In)
  const checkHashAndOpenModal = useCallback(() => {
    if (typeof window === "undefined") return
    const hash = window.location.hash.slice(1) // Remove the #
    const isLoginPage = window.location.pathname === "/login"
    
    if (ABOUT_TAB_ANCHORS.includes(hash as AboutTabAnchor)) {
      setAboutUsDefaultTab(hash as AboutTabAnchor)
      setAboutUsOpen(true)
    } else if (hash === "faq") {
      setFaqOpen(true)
    } else if (hash === "signin" || isLoginPage) {
      setSignInOpen(true)
    }
  }, [])

  useEffect(() => {
    setMounted(true)
    fetchUser()
    
    // Set up scroll listener
    window.addEventListener("scroll", handleScroll, { passive: true })
    handleScroll() // Check initial scroll position

    // Check hash on mount and listen for changes
    checkHashAndOpenModal()
    window.addEventListener("hashchange", checkHashAndOpenModal)
    
    return () => {
      window.removeEventListener("scroll", handleScroll)
      window.removeEventListener("hashchange", checkHashAndOpenModal)
    }
  }, [fetchUser, handleScroll, checkHashAndOpenModal])

  useEffect(() => {
    const checkAdminStatus = async () => {
      if (user?.id) {
        const response = await fetch("/api/auth/check-admin")
        const { isAdmin } = await response.json()
        setIsAdmin(isAdmin)
      }
    }
    checkAdminStatus()
  }, [user])

  useEffect(() => {
    if (isOpen) {
      document.body.classList.add("overflow-hidden")
    } else {
      document.body.classList.remove("overflow-hidden")
    }
  }, [isOpen])

  // Close menu on route change and check for modal triggers
  useEffect(() => {
    setIsOpen(false)
    checkHashAndOpenModal()
  }, [pathname, checkHashAndOpenModal])

  const handleLogout = async () => {
    setIsOpen(false)
    await logout()
    router.push("/")
  }

  // Render the full navbar structure on every render (including SSR).
  // Auth-dependent UI is guarded by {mounted && ...} to avoid hydration
  // mismatches with client-side auth state while keeping the navbar height
  // stable from the very first paint.
  return (
    <>
      {mounted && (
        <>
          <AboutUsModal
            open={aboutUsOpen}
            onClose={() => setAboutUsOpen(false)}
            defaultTab={aboutUsDefaultTab}
          />
          <FAQModal open={faqOpen} onClose={() => setFaqOpen(false)} />
          <SignInModal open={signInOpen} onClose={() => setSignInOpen(false)} />
        </>
      )}
      <Box 
        className={`w-full z-[1000] sticky top-0 transition-all duration-500 ${
          isScrolled 
            ? "bg-white border-b border-gray-200" 
            : "bg-transparent border-b border-transparent"
        }`}
        style={{
          boxShadow: isScrolled 
            ? "0 4px 24px -4px rgba(0, 0, 0, 0.08), 0 2px 8px -2px rgba(0, 0, 0, 0.04)" 
            : "none"
        }}
      >
        <Flex
          className="w-full max-w-[1200px] mx-auto px-6 md:px-8 flex justify-between items-center relative overflow-visible"
          style={{
            height: isHomeLogoExpanded
              ? NAV_ROW_HEIGHT_EXPANDED_PX
              : NAV_ROW_HEIGHT_COLLAPSED_PX,
            transition: navRowTransition,
          }}
        >
        {/* Logo: larger at top on homepage only; other routes stay compact */}
        <Box
          className="flex items-center flex-shrink-0 overflow-visible"
          style={{
            animation: "pageLogoSlideIn 0.5s cubic-bezier(0.22, 1, 0.36, 1) both",
          }}
        >
          <NextLink href="/" passHref>
            <Image
              src="/logo_text.svg"
              alt="Creator Share"
              height={isHomeLogoExpanded ? "72px" : "48px"}
              objectFit="contain"
              style={{
                transition: `height ${NAV_ROW_TRANSITION_MS}ms ease-out`,
              }}
            />
          </NextLink>
        </Box>

        {/* Desktop Menu */}
        <Flex as="nav" gap={4} display={{ base: "none", md: "flex" }}>
          {/* Navigation links temporarily disabled
          {Links.map((link) => {
            const isActive = pathname === link.href
            return (
              <Link
                as={NextLink}
                key={link.name}
                href={link.href}
                px={3}
                py={2}
                rounded="md"
                transition="all 0.2s ease-in-out"
                bg={isActive ? "blue.500" : "transparent"}
                color={isActive ? "white" : "inherit"}
                _hover={{
                  textDecoration: "none",
                  bg: isActive ? "blue.600" : "gray.200",
                  _dark: {
                    bg: isActive ? "blue.600" : "gray.700",
                  },
                }}
                _focus={{
                  boxShadow: "none",
                  outline: "none",
                }}
                _focusVisible={{
                  boxShadow: "none",
                  outline: "none",
                }}
                _dark={{
                  color: isActive ? "white" : "inherit",
                }}
              >
                {link.name}
              </Link>
            )
          })} */}
        </Flex>

        {/* Right Actions */}
        <Flex
          gap={1}
          display={{ base: "none", md: "flex" }}
          alignItems="center"
          style={{
            animation: "pageNavRightIn 0.5s 0.07s cubic-bezier(0.22, 1, 0.36, 1) both",
          }}
        >
          <Button
            size="sm"
            variant="ghost"
            borderRadius="full"
            asChild
          >
            <a
              href="/#faq"
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
                e.preventDefault()
                window.history.replaceState(null, "", "#faq")
                setFaqOpen(true)
              }}
            >
              FAQ
            </a>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            borderRadius="full"
            asChild
          >
            <a
              href="/#about"
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
                e.preventDefault()
                window.history.replaceState(null, "", "#about")
                setAboutUsOpen(true)
              }}
            >
              About Us
            </a>
          </Button>
          {mounted && user ? (
            <>
              {isAdmin && (
                <Button
                  size="sm"
                  variant="ghost"
                  borderRadius="full"
                  asChild
                  style={pathname?.startsWith("/admin") ? {
                    textDecoration: "underline",
                    textUnderlineOffset: "4px",
                    fontWeight: 600,
                  } : undefined}
                >
                  <a
                    href="/admin"
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
                      e.preventDefault()
                      router.push("/admin")
                    }}
                  >
                    Admin Dashboard
                  </a>
                </Button>
              )}
              {/* Temporarily hidden
              <Button
                size="sm"
                variant={pathname === "/app" ? "solid" : "ghost"}
                onClick={() => router.push("/app")}
              >
                User Dashboard
              </Button>
              */}
              <Menu.Root>
                <Menu.Trigger asChild>
                  <Button size="sm" variant="ghost" borderRadius="full">
                    My Account ({user.email})
                  </Button>
                </Menu.Trigger>
                <Portal>
                  <Menu.Positioner>
                    <Menu.Content>
                      <Menu.Item
                        value="logout"
                        onClick={() => {
                          handleLogout()
                        }}
                        cursor="pointer"
                      >
                        Logout
                      </Menu.Item>
                    </Menu.Content>
                  </Menu.Positioner>
                </Portal>
              </Menu.Root>
            </>
          ) : mounted ? (
            <Button
              size="sm"
              variant="ghost"
              borderRadius="full"
              asChild
            >
              <a
                href="/login"
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
                  e.preventDefault()
                  window.history.pushState({ modal: true }, "", "/login")
                  setSignInOpen(true)
                }}
              >
                Sign In
              </a>
            </Button>
          ) : null}
        </Flex>

        {/* Mobile menu: only rendered client-side (isOpen state is client-driven) */}
        {mounted && (
          <Box
            display={{ base: "block", md: "none" }}
            className="absolute right-4 top-1/2 z-[1101] -translate-y-1/2"
          >
            <Button
              onClick={() => setIsOpen(!isOpen)}
              aria-label="Toggle Menu"
              variant="ghost"
              color={isOpen ? "white" : "inherit"}
              _hover={{
                bg: "transparent",
                transform: isOpen ? "scale(1.15)" : undefined,
              }}
              transition="transform 0.2s ease"
            >
              {isOpen ? (
                <IoClose className="w-6 h-6" />
              ) : (
                <GiHamburgerMenu className="w-6 h-6" />
              )}
            </Button>
          </Box>
        )}
      </Flex>

      {/* Mobile Menu (Dropdown) */}
      {mounted && isOpen && (
        <Box
          className="fixed top-0 left-0 right-0 bg-[#2B7FF9] shadow-lg md:hidden flex flex-col items-center justify-center"
          style={{ height: "100dvh" }}
          zIndex="1100"
          pointerEvents="auto"
        >
          <VStack gap={6} py={6}>
            {/* FAQ - always visible */}
            <Button
              size="lg"
              variant="ghost"
              color="white"
              fontSize="xl"
              _hover={{ bg: "rgba(255, 255, 255, 0.1)" }}
              onClick={() => {
                setIsOpen(false)
                window.history.replaceState(null, "", "#faq")
                setFaqOpen(true)
              }}
              className="w-full"
            >
              FAQ
            </Button>
            {/* About Us - always visible */}
            <Button
              size="lg"
              variant="ghost"
              color="white"
              fontSize="xl"
              _hover={{ bg: "rgba(255, 255, 255, 0.1)" }}
              onClick={() => {
                setIsOpen(false)
                window.history.replaceState(null, "", "#about")
                setAboutUsOpen(true)
              }}
              className="w-full"
            >
              About Us
            </Button>
            {/* Navigation links temporarily disabled
            {Links.map((link) => {
              const isActive = pathname === link.href
              return (
                <Link
                  as={NextLink}
                  key={link.name}
                  href={link.href}
                  w="full"
                  px={4}
                  py={2}
                  textAlign="center"
                  color="white"
                  rounded="md"
                  bg={isActive ? "rgba(255, 255, 255, 0.2)" : "transparent"}
                  transition="all 0.2s ease-in-out"
                  _hover={{
                    textDecoration: "none",
                    bg: isActive
                      ? "rgba(255, 255, 255, 0.3)"
                      : "rgba(255, 255, 255, 0.2)",
                  }}
                  _focus={{
                    boxShadow: "none",
                    outline: "none",
                  }}
                  _focusVisible={{
                    boxShadow: "none",
                    outline: "none",
                  }}
                >
                  {link.name}
                </Link>
              )
            })} */}
            {user ? (
              <>
                {isAdmin && (
                  <NextLink href="/admin" passHref>
                    <Button size="lg" variant="ghost" color="white" fontSize="xl" _hover={{ bg: "rgba(255, 255, 255, 0.1)" }} className="w-full">
                      Admin
                    </Button>
                  </NextLink>
                )}
                <Button
                  size="lg"
                  variant="ghost"
                  color="white"
                  fontSize="xl"
                  _hover={{ bg: "rgba(255, 255, 255, 0.1)" }}
                  onClick={handleLogout}
                  className="w-full"
                >
                  Logout
                </Button>
              </>
            ) : (
              <Button
                size="lg"
                variant="ghost"
                color="white"
                fontSize="xl"
                _hover={{ bg: "rgba(255, 255, 255, 0.1)" }}
                className="w-full"
                onClick={() => {
                  setIsOpen(false)
                  window.history.pushState({ modal: true }, "", "/login")
                  setSignInOpen(true)
                }}
              >
                Sign In
              </Button>
            )}
          </VStack>
        </Box>
      )}
      </Box>
    </>
  )
}
