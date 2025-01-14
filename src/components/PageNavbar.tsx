"use client";

import {
  Box,
  Flex,
  HStack,
  Link,
  Button,
  Image,
  Container,
} from "@chakra-ui/react";
import NextLink from "next/link";
import { ColorModeButton } from "./ui/color-mode";

const Links = [
  { name: "Lives", href: "/lives" },
  { name: "Projects", href: "/projects" },
  { name: "Causes", href: "/causes" },
  { name: "My Community", href: "/local" },
  { name: "Share Abundance", href: "/share" },
];

export function PageNavbar() {
  return (
    <Box
      borderBottom="1px"
      borderColor="gray.200"
      position="sticky"
      top={0}
      zIndex={1000}
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
