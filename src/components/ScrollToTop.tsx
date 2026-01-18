"use client"
import React, { useState, useEffect, useCallback } from "react"
import { Box } from "@chakra-ui/react"
import { FaArrowUp } from "react-icons/fa"

/**
 * Floating scroll-to-top button that appears after scrolling down
 * Essential UX improvement for infinite scroll pages
 */
export function ScrollToTop() {
  const [isVisible, setIsVisible] = useState(false)

  // Show button after scrolling down 500px
  const handleScroll = useCallback(() => {
    const scrollTop = window.scrollY || document.documentElement.scrollTop
    setIsVisible(scrollTop > 500)
  }, [])

  useEffect(() => {
    window.addEventListener("scroll", handleScroll, { passive: true })
    handleScroll() // Check initial position
    
    return () => window.removeEventListener("scroll", handleScroll)
  }, [handleScroll])

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    })
  }

  return (
    <Box
      as="button"
      onClick={scrollToTop}
      position="fixed"
      bottom={{ base: "24px", md: "32px" }}
      right={{ base: "24px", md: "32px" }}
      zIndex={999}
      width="48px"
      height="48px"
      borderRadius="full"
      bg="#2B7FF9"
      color="white"
      display="flex"
      alignItems="center"
      justifyContent="center"
      boxShadow="lg"
      cursor="pointer"
      opacity={isVisible ? 1 : 0}
      visibility={isVisible ? "visible" : "hidden"}
      transform={isVisible ? "translateY(0)" : "translateY(20px)"}
      transition="all 0.3s ease"
      _hover={{
        bg: "#1C6EE8",
        transform: isVisible ? "translateY(-2px)" : "translateY(20px)",
        boxShadow: "xl",
      }}
      _active={{
        transform: isVisible ? "translateY(0)" : "translateY(20px)",
      }}
      aria-label="Scroll to top"
    >
      <FaArrowUp className="w-5 h-5" />
    </Box>
  )
}
