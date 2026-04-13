"use client"
import React, { useState, useRef, useCallback, useEffect } from "react"
import { Box, Heading, Image, Text } from "@chakra-ui/react"
import { Global, css } from "@emotion/react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type HeroType = "ALL" | "CHILD_LABORER" | "SPECIAL_NEEDS" | "ANIMAL"

interface HeroContent {
  heading: React.ReactNode
  description: React.ReactNode
}

// ---------------------------------------------------------------------------
// Brushstroke SVG (unchanged from original)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Content for each hero type
// ---------------------------------------------------------------------------

const HERO_CONTENT: Record<HeroType, HeroContent> = {
  ALL: {
    heading: (
      <>
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
      </>
    ),
    description: (
      <>
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
        has stewarded children&apos;s centers across Tanzania, creating home
        and family for hundreds of the most vulnerable children on earth. Here
        you can walk with a specific child - providing education, medical care,
        and belief in their potential that changes everything.
      </>
    ),
  },

  CHILD_LABORER: {
    heading: (
      <>
        Give a child laborer
        <br />
        the chance to be
        <br />a child again
      </>
    ),
    description: (
      <>
        Across Tanzania, thousands of children spend their days working instead
        of learning - carrying loads no child should carry. Your sponsorship
        covers school fees, daily meals, and safe housing, replacing hardship
        with possibility. One sponsor, one child, one life quietly turned
        around.
      </>
    ),
  },

  SPECIAL_NEEDS: {
    heading: (
      <>
        Every child deserves
        <br />
        to be seen, known,
        <br />
        and loved
      </>
    ),
    description: (
      <>
        Children with special needs are too often the most invisible -
        overlooked, underestimated, and forgotten. Through your sponsorship, a
        child who might otherwise be hidden away receives specialized care,
        therapy, education, and the certainty that their life has worth. You do
        not change who they are. You change what becomes possible for them.
      </>
    ),
  },

  ANIMAL: {
    heading: (
      <>
        Every stray deserves
        <br />a second chance
        <br />
        at life
      </>
    ),
    description: (
      <>
        Tanzania&apos;s streets are home to thousands of abandoned dogs - no
        food, no shelter, and no one in their corner. Your sponsorship provides
        veterinary care, a safe place to recover, and real hope for a dog that
        has known only hardship. Small life, enormous impact.
      </>
    ),
  },
}

// ---------------------------------------------------------------------------
// Nav links
// ---------------------------------------------------------------------------

const HERO_LINKS: { type: HeroType; label: string }[] = [
  { type: "ALL", label: "All Opportunities" },
  { type: "CHILD_LABORER", label: "Child Labourers" },
  { type: "SPECIAL_NEEDS", label: "Special Needs" },
  { type: "ANIMAL", label: "Rescue Dogs" },
]

const EXIT_DURATION_MS = 200
const ENTER_DURATION_MS = 300

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const HomeHero = () => {
  // The type the user has clicked (drives link highlight immediately)
  const [activeType, setActiveType] = useState<HeroType>("ALL")
  // The type whose content is actually rendered (lags during exit animation)
  const [displayedType, setDisplayedType] = useState<HeroType>("ALL")
  // "exit" = fading out old content; "idle" = showing/entering new content
  const [phase, setPhase] = useState<"exit" | "idle">("idle")

  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const raf1Ref = useRef<number | null>(null)
  const raf2Ref = useRef<number | null>(null)

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current)
      if (raf1Ref.current) cancelAnimationFrame(raf1Ref.current)
      if (raf2Ref.current) cancelAnimationFrame(raf2Ref.current)
    }
  }, [])

  const handleTypeClick = useCallback(
    (type: HeroType) => {
      if (type === activeType) return

      // Cancel any in-flight animation
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current)
      if (raf1Ref.current) cancelAnimationFrame(raf1Ref.current)
      if (raf2Ref.current) cancelAnimationFrame(raf2Ref.current)

      setActiveType(type)
      setPhase("exit")

      exitTimerRef.current = setTimeout(() => {
        // Swap the rendered content while it is invisible
        setDisplayedType(type)
        // Double rAF: first lets React commit the new content (key change
        // puts the enter animation at frame 0), second triggers the
        // transition from "enter" keyframe to idle.
        raf1Ref.current = requestAnimationFrame(() => {
          raf2Ref.current = requestAnimationFrame(() => {
            setPhase("idle")
          })
        })
      }, EXIT_DURATION_MS)
    },
    [activeType],
  )

  const content = HERO_CONTENT[displayedType]

  return (
    <>
      <Global
        styles={css`
          @keyframes heroFadeInUp {
            from {
              opacity: 0;
              transform: translateY(16px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
        `}
      />

      <Box
        className="relative"
        background={{
          base: "linear-gradient(to bottom, white 0%, #ebebeb 60%, #F5F5F5 100%)",
          md: "linear-gradient(to bottom, white 0%, #f5f9ff 25%, #e8eefb 55%, #dce6f7 75%, #F5F5F5 100%)",
        }}
        style={{
          width: "100vw",
          marginLeft: "calc(-50vw + 50%)",
        }}
      >
        <Box className="max-w-[1200px] mx-auto px-6 md:px-8">
          <Box
            className="flex flex-col md:flex-row items-start md:items-center gap-6 md:gap-10 py-10 md:py-16"
          >
            {/* ----------------------------------------------------------------
                Left column: type selector links
                Desktop: vertical stack | Mobile: horizontal wrap row
            ---------------------------------------------------------------- */}
            <Box
              as="nav"
              aria-label="Beneficiary type"
              className="flex flex-row flex-wrap md:flex-col gap-x-5 gap-y-2 md:gap-y-1 shrink-0"
              style={{ minWidth: 0 }}
            >
              {/* Mobile separator line hidden on desktop; left border on desktop */}
              {HERO_LINKS.map(({ type, label }) => {
                const isActive = activeType === type
                return (
                  <button
                    key={type}
                    onClick={() => handleTypeClick(type)}
                    style={{
                      // Reset button defaults
                      background: "none",
                      border: "none",
                      padding: 0,
                      cursor: isActive ? "default" : "pointer",
                      // Text styles
                      fontFamily: "var(--font-reddit-sans), sans-serif",
                      textAlign: "left",
                      lineHeight: 1.25,
                      transition: "color 0.18s ease, opacity 0.18s ease",
                    }}
                    aria-current={isActive ? "true" : undefined}
                  >
                    {/* Desktop: left-border indicator + large type */}
                    <Box display={{ base: "none", md: "flex" }} alignItems="center" gap={3}>
                      {/* Animated left bar */}
                      <Box
                        style={{
                          width: "3px",
                          borderRadius: "2px",
                          flexShrink: 0,
                          transition: `height ${EXIT_DURATION_MS}ms ease, background ${EXIT_DURATION_MS}ms ease, opacity ${EXIT_DURATION_MS}ms ease`,
                          height: isActive ? "2.25rem" : "0.75rem",
                          background: isActive ? "#2b7ff9" : "#d1d5db",
                          opacity: isActive ? 1 : 0.5,
                        }}
                      />
                      <span
                        style={{
                          fontSize: isActive ? "1.25rem" : "1rem",
                          fontWeight: isActive ? 700 : 500,
                          color: isActive ? "#2b7ff9" : "#9ca3af",
                          transition: `font-size ${EXIT_DURATION_MS}ms ease, color ${EXIT_DURATION_MS}ms ease, font-weight ${EXIT_DURATION_MS}ms ease`,
                          display: "block",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {label}
                      </span>
                    </Box>

                    {/* Mobile: compact inline pills */}
                    <Box display={{ base: "block", md: "none" }}>
                      <span
                        style={{
                          fontSize: "0.875rem",
                          fontWeight: isActive ? 700 : 500,
                          color: isActive ? "#2b7ff9" : "#6b7280",
                          borderBottom: isActive ? "2px solid #2b7ff9" : "2px solid transparent",
                          paddingBottom: "2px",
                          transition: "color 0.18s ease, border-color 0.18s ease",
                          display: "inline-block",
                        }}
                      >
                        {label}
                      </span>
                    </Box>
                  </button>
                )
              })}
            </Box>

            {/* ----------------------------------------------------------------
                Center: animated heading + description
            ---------------------------------------------------------------- */}
            <Box
              flex={1}
              minW={0}
              className="text-center md:text-left"
              style={{
                // Exit: fade out and drift slightly upward
                opacity: phase === "exit" ? 0 : 1,
                transform: phase === "exit" ? "translateY(-12px)" : "translateY(0)",
                transition:
                  phase === "exit"
                    ? `opacity ${EXIT_DURATION_MS}ms ease, transform ${EXIT_DURATION_MS}ms ease`
                    : "none",
              }}
            >
              {/* Key on displayedType causes remount → CSS enter animation plays */}
              <Box
                key={displayedType}
                style={{
                  animation:
                    phase !== "exit"
                      ? `heroFadeInUp ${ENTER_DURATION_MS}ms ease forwards`
                      : "none",
                }}
              >
                <Heading
                  as="h1"
                  fontSize={{ base: "3xl", md: "4xl", lg: "5xl" }}
                  fontWeight="800"
                  color="#2b7ff9"
                  lineHeight="1.15"
                  mb={5}
                  style={{ fontFamily: "var(--font-reddit-sans), sans-serif" }}
                >
                  {content.heading}
                </Heading>
                <Text
                  fontSize={{ base: "md", md: "lg" }}
                  color="#18181b"
                  lineHeight="1.7"
                  maxW={{ base: "none", md: "xl", lg: "2xl" }}
                >
                  {content.description}
                </Text>
              </Box>
            </Box>

            {/* ----------------------------------------------------------------
                Right: hero image (desktop only)
            ---------------------------------------------------------------- */}
            <Box className="hidden md:flex flex-shrink-0 items-center justify-center">
              <Box
                className="relative"
                width={{ base: "280px", md: "320px", lg: "380px" }}
                height={{ base: "320px", md: "360px", lg: "430px" }}
              >
                <Image
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
    </>
  )
}
