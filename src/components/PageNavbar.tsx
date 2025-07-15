"use client";
import { useEffect, useState } from "react";
import { Box, Flex, Link, Button, Image, VStack, Menu, Portal } from "@chakra-ui/react";
import NextLink from "next/link";
import { useAuthStore } from "@/store/authStore";
import { useRouter } from "next/navigation";
import { ColorModeButton } from "./ui/color-mode";
import { GiHamburgerMenu } from "react-icons/gi";
import { IoClose } from "react-icons/io5";

const Links = [
  { name: "Home", href: "/" },
  // { name: "Lives", href: "/lives" },
  // { name: "Projects", href: "/projects" },
  // { name: "Causes", href: "/causes" },
  // { name: "My Community", href: "/local" },
  // { name: "Share Abundance", href: "/share" },
  { name: "Sponsorships", href: "/sponsorships" },
  { name: "Strays Worth Saving", href: "/strays-worth-saving" },
  // { name: "Sponsor-a-Family", href: "/family-in-need" },
  // { name: "Street Involved", href: "/street-involved" },
  // { name: "Child Laborer", href: "/child-labor" },
  // { name: "I-Frame Test", href: "/iframe-test" },
];

export function PageNavbar() {
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const fetchUser = useAuthStore((state) => state.fetchUser);
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    setMounted(true);
    fetchUser();
  }, [fetchUser]);

  useEffect(() => {
    const checkAdminStatus = async () => {
      if (user?.id) {
        const response = await fetch("/api/auth/check-admin");
        const { isAdmin } = await response.json();
        setIsAdmin(isAdmin);
      }
    };
    checkAdminStatus();
  }, [user]);

  useEffect(() => {
    if (isOpen) {
      document.body.classList.add("overflow-hidden");
    } else {
      document.body.classList.remove("overflow-hidden");
    }
  }, [isOpen]);

  const handleLogout = async () => {
    await logout();
    router.push("/");
  };

  if (!mounted) return null;

  return (
    <Box className="w-full z-[1000] bg-[#FFFFFF]">
      <Flex className="container mx-auto px-4 h-16 flex justify-between items-center relative">
        {/* Logo Centered */}
        <Box className="w-full md:w-[10%]">
          <NextLink href="/" passHref>
            <Image src="/logo_text.svg" alt="Logo" height="55px" mx="auto" />
          </NextLink>
        </Box>

        {/* Desktop Menu */}
        <Flex as="nav" gap={4} display={{ base: "none", md: "flex" }}>
          {Links.map((link) => (
            <Link
              as={NextLink}
              key={link.name}
              href={link.href}
              px={2}
              py={1}
              rounded="md"
              className="hover:bg-gray-100 dark:hover:bg-[#2B7FF9]"
              _hover={{ textDecoration: "none" }}
            >
              {link.name}
            </Link>
          ))}
        </Flex>

        {/* Right Actions */}
        <Flex gap={4} display={{ base: "none", md: "flex" }}>
          {/* <ColorModeButton /> */}
          {user ? (
            <Menu.Root>
              <Menu.Trigger asChild>
                <Button size="sm" variant="ghost">
                  {user.email}
                </Button>
              </Menu.Trigger>
              <Portal>
                <Menu.Positioner>
                  <Menu.Content>
                    {isAdmin && (
                      <Menu.Item
                        value="admin"
                        onClick={() => {
                          router.push("/admin");
                        }}
                      >
                        Admin Dashboard
                      </Menu.Item>
                    )}
                    <Menu.Item
                      value="user-dashboard"
                      onClick={() => {
                        router.push("/app");
                      }}
                    >
                      User Dashboard
                    </Menu.Item>
                    <Menu.Item
                      value="logout"
                      onClick={() => {
                        handleLogout();
                      }}
                    >
                      Logout
                    </Menu.Item>
                  </Menu.Content>
                </Menu.Positioner>
              </Portal>
            </Menu.Root>
          ) : (
            <>
              <NextLink href="/login" passHref>
                <Button size="sm" variant="ghost">
                  Sign In
                </Button>
              </NextLink>
              <NextLink href="/registration" passHref>
                <Button size="sm" colorScheme="blue">
                  Sign Up
                </Button>
              </NextLink>
            </>
          )}
        </Flex>

        {/* Mobile Menu Button */}
        <Button
          display={{ base: "block", md: "none" }}
          onClick={() => setIsOpen(!isOpen)}
          aria-label="Toggle Menu"
          className="absolute right-4 z-[1101]"
        >
          {isOpen ? (
            <IoClose className="w-6 h-6" />
          ) : (
            <GiHamburgerMenu className="w-6 h-6" />
          )}
        </Button>
      </Flex>

      {/* Mobile Menu (Dropdown) */}
      {isOpen && (
        <Box
          className="fixed inset-0 bg-[#2B7FF9] shadow-lg md:hidden flex flex-col items-center justify-center"
          zIndex="1100"
          pointerEvents="auto"
        >
          <VStack gap={4} py={6}>
            {Links.map((link) => (
              <Link
                as={NextLink}
                key={link.name}
                href={link.href}
                className="block px-4 py-2 text-center hover:bg-gray-100 w-full"
                onClick={() => setIsOpen(false)}
              >
                {link.name}
              </Link>
            ))}
            <ColorModeButton />
            {user ? (
              <>
                {isAdmin && (
                  <NextLink href="/admin" passHref>
                    <Button size="sm" variant="ghost" className="w-full">
                      Admin
                    </Button>
                  </NextLink>
                )}
                <Button size="sm" variant="ghost" onClick={handleLogout} className="w-full">
                  Logout
                </Button>
                <NextLink href="/app" passHref>
                  <Button size="sm" variant="ghost" className="w-full">
                    Dashboard
                  </Button>
                </NextLink>
              </>
            ) : (
              <>
                <NextLink href="/login" passHref>
                  <Button size="sm" variant="ghost" className="w-full">
                    Sign In
                  </Button>
                </NextLink>
                <NextLink href="/registration" passHref>
                  <Button size="sm" colorScheme="blue" className="w-full">
                    Sign Up
                  </Button>
                </NextLink>
              </>
            )}
          </VStack>
        </Box>
      )}
    </Box>
  );
}
