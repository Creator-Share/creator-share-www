import React from "react"
import { Box, Heading, Text } from "@chakra-ui/react"

const BrushstrokeUnderline = () => (
  <svg
    viewBox="0 0 368 28"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={{
      position: "absolute",
      bottom: "-4px",
      left: "-3%",
      width: "106%",
      height: "auto",
      pointerEvents: "none",
      zIndex: 0,
    }}
  >
    <g clipPath="url(#brushClip)">
      <path
        d="M295.775 11.1961C287.817 10.4394 106.655 7.35562 48.2304 8.32877C23.2951 8.74803 31.4173 14.1242 46.1741 15.6624C65.065 17.6478 79.2217 15.0664 226.172 18.2296C285.063 19.4673 302.447 19.0882 306.125 16.4046C308.358 14.7753 302.407 11.8264 295.775 11.1961Z"
        fill="#FFB700"
      />
      <path
        d="M311.572 18.3493C282.722 21.0648 281.826 21.2457 290.269 24.0841C306.742 29.5815 380.96 27.8798 372.741 22.133C364.895 16.6294 343.522 15.2678 311.572 18.3493Z"
        fill="#FFB700"
      />
    </g>
    <defs>
      <clipPath id="brushClip">
        <rect width="368" height="28" fill="white" />
      </clipPath>
    </defs>
  </svg>
)

export const HomeHero = () => {
  return (
    <Box
      className="relative"
      style={{
        width: "100vw",
        marginLeft: "calc(-50vw + 50%)",
        background:
          "linear-gradient(to bottom, white 0%, #f5f9ff 25%, #e8eefb 55%, #dce6f7 75%, #F5F5F5 100%)",
      }}
    >
      <Box className="max-w-[1200px] mx-auto px-6 md:px-8">
        <Box className="flex flex-col md:flex-row items-center md:items-center gap-8 md:gap-12 py-12 md:py-16">
          {/* Text Content - Left */}
          <Box className="flex-1 text-center md:text-left">
            <Heading
              as="h1"
              fontSize={{ base: "3xl", md: "4xl", lg: "5xl" }}
              fontWeight="800"
              color="#2b7ff9"
              lineHeight="1.15"
              mb={5}
              style={{ fontFamily: "var(--font-reddit-sans), sans-serif" }}
            >
              One child at a time,
              <br />
              love is{" "}
              <Box as="span" display="inline-block" position="relative">
                <Box as="span" style={{ position: "relative", zIndex: 1 }}>
                  changing
                </Box>
                <BrushstrokeUnderline />
              </Box>{" "}
              thousands
              <br />
              of lives
            </Heading>
            <Text
              fontSize={{ base: "md", md: "lg" }}
              color="#18181b"
              lineHeight="1.7"
              maxW={{ base: "none", md: "xl", lg: "2xl" }}
            >
              For over a decade, the{" "}
              <a
                href="https://tanzania.creatorshare.com"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: "#2b7ff9",
                  textDecoration: "underline",
                  textUnderlineOffset: "2px",
                }}
              >
                Creator Share Foundation
              </a>{" "}
              has stewarded children&apos;s centers across Tanzania, creating
              home and family for hundreds of the most vulnerable children on
              earth. Here you can walk with a specific child - providing
              education, medical care, and belief in their potential that
              changes everything.
            </Text>
          </Box>

          {/* Photo - Right */}
          <Box className="hidden md:flex flex-shrink-0 items-center justify-center">
            <Box
              className="relative"
              width={{ base: "280px", md: "340px", lg: "400px" }}
              height={{ base: "320px", md: "380px", lg: "450px" }}
            >
              <img
                src="/hero-child-tanzania.png"
                alt="A child smiling in a photo shaped like the map of Tanzania"
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                }}
              />
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  )
}
