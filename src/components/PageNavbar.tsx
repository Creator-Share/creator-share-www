"use client";

import {
  Box,
  Flex,
  HStack,
  Link,
  Button,
  Image,
  Container,
  Text,
} from "@chakra-ui/react";
import NextLink from "next/link";
import { ColorModeButton } from "./ui/color-mode";
import { useState, useEffect } from "react";
import { useAuthStore } from "@/stores/authStore";

const Links = [
  { name: "Lives", href: "/lives" },
  { name: "Projects", href: "/projects" },
  { name: "Causes", href: "/causes" },
  { name: "My Community", href: "/local" },
  { name: "Share Abundance", href: "/share" },
];

export function PageNavbar() {
  const [isScrolled, setIsScrolled] = useState(false);
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 0);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <Box
      position="sticky"
      top={0}
      zIndex={1000}
      transition="box-shadow 0.2s"
      boxShadow={isScrolled ? "lg" : "none"}
      backdropFilter="blur(10px)"
    >
      <Container maxW="container.xl">
        <Flex h={16} alignItems="center" justifyContent="space-between">
          <NextLink href="/" passHref>
            <Box>
              <Image
                src="/logo_text.svg"
                alt="Creator Share Logo"
                height="60px"
                width="auto"
              />
            </Box>
          </NextLink>

          <HStack gap="2">
            <HStack as="nav" gap="1" display={{ base: "none", md: "flex" }}>
              {Links.map((link) => (
                <Link
                  as={NextLink}
                  key={link.name}
                  href={link.href}
                  px={2}
                  py={1}
                  rounded="md"
                  _hover={{
                    textDecoration: "none",
                    bg: "gray.100",
                  }}
                >
                  {link.name}
                </Link>
              ))}
            </HStack>

            <HStack gap={4}>
              <ColorModeButton />
              {user ? (
                <>
                  <Button variant="ghost" size="sm" onClick={logout}>
                    Logout
                  </Button>
                  <Text fontSize="sm">{user}</Text>
                </>
              ) : (
                <>
                  <NextLink href="/signIn" passHref>
                    <Button variant="ghost" size="sm">
                      Sign In
                    </Button>
                  </NextLink>
                  <NextLink href="/signup" passHref>
                    <Button size="sm" colorScheme="blue">
                      Sign Up
                    </Button>
                  </NextLink>
                </>
              )}
            </HStack>
          </HStack>
        </Flex>
      </Container>
    </Box>
  );
}
