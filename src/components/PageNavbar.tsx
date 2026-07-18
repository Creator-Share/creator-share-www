"use client"
import { useEffect, useState, useCallback, useRef } from "react"
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
import {
  DialogCloseTrigger,
  DialogContent,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog"
import { ROUTE_TO_TYPE } from "@/config/beneficiaryTypes"
import { resolvePublicSiteTheme } from "@/lib/advocates/publicSiteTheme"
import { usePublicSite } from "./advocates/PublicSiteProvider"

// Valid tab anchors for the About modal
const ABOUT_TAB_ANCHORS = ["about", "centers", "contact"] as const
type AboutTabAnchor = (typeof ABOUT_TAB_ANCHORS)[number]

/** Hysteresis avoids layout feedback: shrinking the bar changes scrollY and would flip a single threshold forever. */
const NAV_SCROLL_COLLAPSE_PX = 32
const NAV_SCROLL_EXPAND_PX = 6

const NAV_ROW_HEIGHT_COLLAPSED_PX = 64
const NAV_ROW_HEIGHT_MOBILE_PX = 52
const NAV_ROW_HEIGHT_EXPANDED_PX = 88
const NAV_ROW_TRANSITION_MS = 300
const navRowTransition = `height ${NAV_ROW_TRANSITION_MS}ms ease-out`

export function PageNavbar() {
  const publicSite = usePublicSite()
  const publicSiteTheme = resolvePublicSiteTheme(publicSite)
  const mobileMenuForeground =
    publicSite.kind === "advocate"
      ? publicSiteTheme.primaryForegroundColor
      : "white"
  const advocateMobileMenuHoverBackground =
    publicSiteTheme.primaryForegroundColor === "#000000"
      ? "rgba(0, 0, 0, 0.08)"
      : "rgba(255, 255, 255, 0.1)"
  const [isOpen, setIsOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [isScrolled, setIsScrolled] = useState(false)
  const [skipTransition, setSkipTransition] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const prevScrollRef = useRef(0)
  const prevPathRef = useRef<string>("/")
  const mobileMenuTriggerRef = useRef<HTMLButtonElement>(null)
  const firstMobileMenuActionRef = useRef<HTMLButtonElement>(null)
  const [aboutUsOpen, setAboutUsOpen] = useState(false)
  const [aboutUsDefaultTab, setAboutUsDefaultTab] =
    useState<AboutTabAnchor>("about")
  const [faqOpen, setFaqOpen] = useState(false)
  const [signInOpen, setSignInOpen] = useState(false)
  const user = useAuthStore((state) => state.user)
  const logout = useAuthStore((state) => state.logout)
  const fetchUser = useAuthStore((state) => state.fetchUser)
  const router = useRouter()
  const pathname = usePathname()
  const [isAdmin, setIsAdmin] = useState(false)

  const isHome = pathname in ROUTE_TO_TYPE
  const isHomeLogoExpanded = isHome && !isScrolled && !isMobile

  // Scroll detection for navbar shadow and home logo size (hysteresis prevents bounce near top).
  // If the user jumps more than half a viewport in one scroll event, snap the navbar to its
  // final state immediately (no transition) so the filter bar never docks under a semi-transparent bar.
  const handleScroll = useCallback(() => {
    const scrollTop = window.scrollY || document.documentElement.scrollTop
    const delta = Math.abs(scrollTop - prevScrollRef.current)
    prevScrollRef.current = scrollTop

    if (delta > window.innerHeight / 2) {
      setSkipTransition(true)
      setIsScrolled(scrollTop > NAV_SCROLL_EXPAND_PX)
      requestAnimationFrame(() =>
        requestAnimationFrame(() => setSkipTransition(false)),
      )
      return
    }

    setSkipTransition(false)
    setIsScrolled((wasScrolled) => {
      if (wasScrolled) return scrollTop > NAV_SCROLL_EXPAND_PX
      return scrollTop > NAV_SCROLL_COLLAPSE_PX
    })
  }, [])

  // Check URL path for modals (About tabs, FAQ, Sign In)
  const checkPathAndOpenModal = useCallback(() => {
    if (typeof window === "undefined") return
    const path = window.location.pathname
    const isLoginPage = path === "/login"

    if (ABOUT_TAB_ANCHORS.includes(path.slice(1) as AboutTabAnchor)) {
      setAboutUsDefaultTab(path.slice(1) as AboutTabAnchor)
      setAboutUsOpen(true)
    } else if (path === "/faq") {
      setFaqOpen(true)
    } else if (path === "/signin" || isLoginPage) {
      setSignInOpen(true)
    }
  }, [])

  useEffect(() => {
    setMounted(true)
    fetchUser()

    // Set up scroll listener
    window.addEventListener("scroll", handleScroll, { passive: true })
    handleScroll() // Check initial scroll position

    // Track mobile breakpoint so the logo stays compact on small screens
    const checkMobile = () => setIsMobile(window.innerWidth < 768)
    checkMobile()
    window.addEventListener("resize", checkMobile, { passive: true })

    // Check path on mount and listen for popstate (browser back/forward)
    checkPathAndOpenModal()
    window.addEventListener("popstate", checkPathAndOpenModal)

    return () => {
      window.removeEventListener("scroll", handleScroll)
      window.removeEventListener("resize", checkMobile)
      window.removeEventListener("popstate", checkPathAndOpenModal)
    }
  }, [fetchUser, handleScroll, checkPathAndOpenModal])

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

  useEffect(() => {
    if (publicSite.kind === "advocate" && !isMobile) {
      setIsOpen(false)
    }
  }, [isMobile, publicSite.kind])

  // Close menu on route change and check for modal triggers
  useEffect(() => {
    setIsOpen(false)
    checkPathAndOpenModal()
  }, [pathname, checkPathAndOpenModal])

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
            prevPath={prevPathRef.current}
          />
          <FAQModal
            open={faqOpen}
            onClose={() => setFaqOpen(false)}
            prevPath={prevPathRef.current}
          />
          <SignInModal open={signInOpen} onClose={() => setSignInOpen(false)} />
        </>
      )}
      <Box
        className={`w-full z-[1000] sticky top-0 bg-white border-b ${(isHome && !isScrolled) || (isMobile && !isScrolled) ? "border-transparent" : "border-gray-200"}`}
        style={{
          boxShadow: isScrolled
            ? "0 4px 24px -4px rgba(0, 0, 0, 0.08), 0 2px 8px -2px rgba(0, 0, 0, 0.04)"
            : "none",
        }}
      >
        <Flex
          className="w-full max-w-[1200px] mx-auto px-6 md:px-8 flex justify-between items-center relative overflow-visible"
          style={{
            height: isHomeLogoExpanded
              ? NAV_ROW_HEIGHT_EXPANDED_PX
              : isMobile
                ? NAV_ROW_HEIGHT_MOBILE_PX
                : NAV_ROW_HEIGHT_COLLAPSED_PX,
            transition: skipTransition ? "none" : navRowTransition,
          }}
        >
          {/* Logo: larger at top on homepage only; other routes stay compact */}
          <Box
            className="flex items-center flex-shrink-0 overflow-visible"
            style={{
              transform: isHomeLogoExpanded
                ? "translateX(20px)"
                : "translateX(0)",
              transition: skipTransition
                ? "none"
                : `transform ${NAV_ROW_TRANSITION_MS}ms ease-out`,
            }}
          >
            <Box
              style={{
                animation:
                  "pageLogoSlideIn 0.5s cubic-bezier(0.22, 1, 0.36, 1) both",
              }}
            >
              <NextLink href="/" passHref>
                {publicSite.kind === "advocate" ? (
                  <Flex
                    alignItems="center"
                    gap={{ base: 2, lg: 3 }}
                    maxW="min(68vw, 420px)"
                  >
                    {publicSite.logoUrl ? (
                      <Image
                        src={publicSite.logoUrl}
                        alt={publicSite.logoAltText || publicSite.displayName}
                        height={isHomeLogoExpanded ? "64px" : "42px"}
                        maxW={
                          isHomeLogoExpanded
                            ? "220px"
                            : { base: "130px", md: "170px" }
                        }
                        objectFit="contain"
                        style={{
                          transition: skipTransition
                            ? "none"
                            : `height ${NAV_ROW_TRANSITION_MS}ms ease-out`,
                        }}
                      />
                    ) : (
                      <Box
                        as="span"
                        color="var(--public-site-primary-ink)"
                        fontSize={isHomeLogoExpanded ? "xl" : "md"}
                        fontWeight="800"
                        overflow="hidden"
                        textOverflow="ellipsis"
                        whiteSpace="nowrap"
                      >
                        {publicSite.displayName}
                      </Box>
                    )}
                    <Box
                      as="span"
                      display="block"
                      color="gray.500"
                      fontSize={{ base: "10px", lg: "xs" }}
                      lineHeight="1.2"
                      whiteSpace="nowrap"
                    >
                      with Creator Share
                    </Box>
                  </Flex>
                ) : (
                  <Image
                    src="/logo_text.svg"
                    alt="Creator Share"
                    height={isHomeLogoExpanded ? "72px" : "48px"}
                    objectFit="contain"
                    style={{
                      transition: skipTransition
                        ? "none"
                        : `height ${NAV_ROW_TRANSITION_MS}ms ease-out`,
                    }}
                  />
                )}
              </NextLink>
            </Box>
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
              animation:
                "pageNavRightIn 0.5s 0.07s cubic-bezier(0.22, 1, 0.36, 1) both",
            }}
          >
            <Button size="sm" variant="ghost" borderRadius="full" asChild>
              <a
                href="/faq"
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0)
                    return
                  e.preventDefault()
                  prevPathRef.current =
                    window.location.pathname + window.location.search
                  window.history.replaceState(null, "", "/faq")
                  setFaqOpen(true)
                }}
              >
                {publicSite.kind === "advocate" ? "Creator Share FAQ" : "FAQ"}
              </a>
            </Button>
            <Button size="sm" variant="ghost" borderRadius="full" asChild>
              <a
                href="/about"
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0)
                    return
                  e.preventDefault()
                  prevPathRef.current =
                    window.location.pathname + window.location.search
                  window.history.replaceState(null, "", "/about")
                  setAboutUsOpen(true)
                }}
              >
                {publicSite.kind === "advocate"
                  ? `About ${publicSite.displayName}`
                  : "About Us"}
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
                    style={
                      pathname?.startsWith("/admin")
                        ? {
                            textDecoration: "underline",
                            textUnderlineOffset: "4px",
                            fontWeight: 600,
                          }
                        : undefined
                    }
                  >
                    <a
                      href="/admin"
                      onClick={(e) => {
                        if (
                          e.metaKey ||
                          e.ctrlKey ||
                          e.shiftKey ||
                          e.button !== 0
                        )
                          return
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
              <Button size="sm" variant="ghost" borderRadius="full" asChild>
                <a
                  href="/login"
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0)
                      return
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
          {mounted &&
            (publicSite.kind === "advocate" ? (
              <DialogRoot
                open={isOpen}
                onOpenChange={(details) => setIsOpen(details.open)}
                ids={{
                  trigger: "advocate-mobile-navigation-trigger",
                  content: "advocate-mobile-navigation",
                }}
                initialFocusEl={() => firstMobileMenuActionRef.current}
                finalFocusEl={() => mobileMenuTriggerRef.current}
                closeOnInteractOutside={false}
                closeOnEscape={true}
                trapFocus={true}
                restoreFocus={true}
              >
                <Box
                  display={{ base: "block", md: "none" }}
                  className="absolute right-4 top-1/2 z-[1101] -translate-y-1/2"
                >
                  <DialogTrigger asChild>
                    <Button
                      ref={mobileMenuTriggerRef}
                      aria-label="Open navigation menu"
                      aria-expanded={isOpen}
                      aria-controls="advocate-mobile-navigation"
                      variant="ghost"
                      color="gray.500"
                      _hover={{ bg: "transparent" }}
                      transition="transform 0.2s ease"
                    >
                      <GiHamburgerMenu className="w-6 h-6" />
                    </Button>
                  </DialogTrigger>
                </Box>

                <DialogContent
                  backdrop={false}
                  className="md:hidden"
                  position="fixed"
                  inset={0}
                  width="100vw"
                  maxWidth="none"
                  height="100dvh"
                  minHeight="100dvh"
                  margin={0}
                  padding={0}
                  borderRadius={0}
                  background={publicSiteTheme.primaryColor}
                  color={publicSiteTheme.primaryForegroundColor}
                  zIndex="1200"
                >
                  <DialogTitle className="sr-only">
                    Advocate site navigation
                  </DialogTitle>
                  <DialogCloseTrigger
                    top="18px"
                    insetEnd="16px"
                    transform="none"
                    color={publicSiteTheme.primaryForegroundColor}
                    zIndex="2"
                  >
                    <IoClose className="w-6 h-6" />
                  </DialogCloseTrigger>

                  <Flex
                    direction="column"
                    alignItems="center"
                    justifyContent="center"
                    width="100%"
                    height="100%"
                    paddingX={6}
                    paddingY={20}
                    position="relative"
                  >
                    <Flex
                      position="absolute"
                      top={5}
                      left={5}
                      right="72px"
                      alignItems="center"
                      gap={2}
                      minWidth={0}
                    >
                      {publicSite.logoUrl ? (
                        <Image
                          src={publicSite.logoUrl}
                          alt={publicSite.logoAltText || publicSite.displayName}
                          maxHeight="34px"
                          maxWidth="120px"
                          objectFit="contain"
                        />
                      ) : (
                        <Box
                          as="span"
                          maxWidth="130px"
                          overflow="hidden"
                          textOverflow="ellipsis"
                          whiteSpace="nowrap"
                          fontSize="sm"
                          fontWeight="bold"
                        >
                          {publicSite.displayName}
                        </Box>
                      )}
                      <Box
                        as="span"
                        fontSize="xs"
                        fontWeight="semibold"
                        whiteSpace="nowrap"
                      >
                        with Creator Share
                      </Box>
                    </Flex>

                    <VStack
                      as="nav"
                      aria-label="Mobile navigation"
                      gap={6}
                      width="100%"
                      maxWidth="360px"
                    >
                      <Button
                        ref={firstMobileMenuActionRef}
                        size="lg"
                        variant="ghost"
                        color={mobileMenuForeground}
                        fontSize="xl"
                        _hover={{ bg: advocateMobileMenuHoverBackground }}
                        onClick={() => {
                          setIsOpen(false)
                          prevPathRef.current =
                            window.location.pathname + window.location.search
                          window.history.replaceState(null, "", "/faq")
                          setFaqOpen(true)
                        }}
                        className="w-full"
                      >
                        Creator Share FAQ
                      </Button>
                      <Button
                        size="lg"
                        variant="ghost"
                        color={mobileMenuForeground}
                        fontSize="xl"
                        _hover={{ bg: advocateMobileMenuHoverBackground }}
                        onClick={() => {
                          setIsOpen(false)
                          prevPathRef.current =
                            window.location.pathname + window.location.search
                          window.history.replaceState(null, "", "/about")
                          setAboutUsOpen(true)
                        }}
                        className="w-full"
                      >
                        About {publicSite.displayName}
                      </Button>
                      {user ? (
                        <>
                          {isAdmin && (
                            <NextLink href="/admin" passHref>
                              <Button
                                size="lg"
                                variant="ghost"
                                color={mobileMenuForeground}
                                fontSize="xl"
                                _hover={{
                                  bg: advocateMobileMenuHoverBackground,
                                }}
                                className="w-full"
                              >
                                Admin
                              </Button>
                            </NextLink>
                          )}
                          <Button
                            size="lg"
                            variant="ghost"
                            color={mobileMenuForeground}
                            fontSize="xl"
                            _hover={{ bg: advocateMobileMenuHoverBackground }}
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
                          color={mobileMenuForeground}
                          fontSize="xl"
                          _hover={{ bg: advocateMobileMenuHoverBackground }}
                          className="w-full"
                          onClick={() => {
                            setIsOpen(false)
                            window.history.pushState(
                              { modal: true },
                              "",
                              "/login",
                            )
                            setSignInOpen(true)
                          }}
                        >
                          Sign In
                        </Button>
                      )}
                    </VStack>
                  </Flex>
                </DialogContent>
              </DialogRoot>
            ) : (
              <Box
                display={{ base: "block", md: "none" }}
                className="absolute right-4 top-1/2 z-[1101] -translate-y-1/2"
              >
                <Button
                  onClick={() => setIsOpen(!isOpen)}
                  aria-label="Toggle Menu"
                  variant="ghost"
                  color={isOpen ? "white" : "gray.500"}
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
            ))}
        </Flex>

        {/* Mobile Menu (Dropdown) */}
        {mounted && publicSite.kind === "primary" && isOpen && (
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
                  prevPathRef.current =
                    window.location.pathname + window.location.search
                  window.history.replaceState(null, "", "/faq")
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
                  prevPathRef.current =
                    window.location.pathname + window.location.search
                  window.history.replaceState(null, "", "/about")
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
                      <Button
                        size="lg"
                        variant="ghost"
                        color="white"
                        fontSize="xl"
                        _hover={{ bg: "rgba(255, 255, 255, 0.1)" }}
                        className="w-full"
                      >
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
