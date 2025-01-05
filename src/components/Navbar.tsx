"use client";

import {
  Box,
  Flex,
  HStack,
  Link,
  Button,
  useColorModeValue,
  useColorMode,
  Image,
  Container,
} from "@chakra-ui/react";
import NextLink from "next/link";

const Links = [
  { name: "Home", href: "/" },
  { name: "Explore", href: "/explore" },
  { name: "Create", href: "/create" },
];

export function Navbar() {
  const { colorMode, toggleColorMode } = useColorMode();
  const bg = useColorModeValue("white", "gray.800");
  const borderColor = useColorModeValue("gray.200", "gray.700");

  return (
    <Box
      bg={bg}
      borderBottom="1px"
      borderColor={borderColor}
      position="sticky"
      top={0}
      zIndex={1000}
    >
      <Container maxW="container.xl">
        <Flex h={16} alignItems="center" justifyContent="space-between">
          <NextLink href="/" passHref>
            <Box>
              <Image
                src="/logo.svg"
                alt="Creator Share Logo"
                height="40px"
                width="auto"
              />
            </Box>
          </NextLink>

          <HStack spacing={8}>
            <HStack as="nav" spacing={4} display={{ base: "none", md: "flex" }}>
              {Links.map((link) => (
                <NextLink key={link.name} href={link.href} passHref>
                  <Link
                    px={2}
                    py={1}
                    rounded="md"
                    _hover={{
                      textDecoration: "none",
                      bg: useColorModeValue("gray.100", "gray.700"),
                    }}
                  >
                    {link.name}
                  </Link>
                </NextLink>
              ))}
            </HStack>

            <HStack spacing={4}>
              <Button size="sm" variant="ghost" onClick={toggleColorMode}>
                {colorMode === "light" ? "🌙" : "☀️"}
              </Button>
              <NextLink href="/signin" passHref>
                <Button variant="ghost" size="sm">
                  Sign In
                </Button>
              </NextLink>
              <NextLink href="/signup" passHref>
                <Button size="sm" colorScheme="blue">
                  Sign Up
                </Button>
              </NextLink>
            </HStack>
          </HStack>
        </Flex>
      </Container>
    </Box>
  );
}
