"use client"
import React, { useState, useRef, useCallback, useEffect } from "react"
import { Box, Heading, Text } from "@chakra-ui/react"
import { Global, css } from "@emotion/react"
import { ALL_BENEFICIARY_TABS } from "@/config/beneficiaryTypes"
import type { BeneficiaryTabType } from "@/config/beneficiaryTypes"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type HeroType = "ALL" | "CHILD_LABORER" | "SPECIAL_NEEDS" | "ANIMAL"

interface HeroContent {
  heading: React.ReactNode
  description: React.ReactNode
}

interface HomeHeroProps {
  activeType: BeneficiaryTabType | null
  onTypeChange: (type: BeneficiaryTabType | null) => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tabTypeToHeroType(type: BeneficiaryTabType | null): HeroType {
  if (!type || type === "CHILD") return "ALL"
  return type as HeroType
}

function heroTypeToTabType(type: HeroType): BeneficiaryTabType | null {
  if (type === "ALL") return null
  return type
}

// ---------------------------------------------------------------------------
// Brushstroke SVG
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
// Hero content per type
// ---------------------------------------------------------------------------

const HERO_CONTENT: Record<HeroType, HeroContent> = {
  ALL: {
    heading: (
      <>
        One child at a time,{" "}
        <Box as="br" display={{ base: "none", md: "initial" }} />
        love is{" "}
        <Box as="span" display="inline-block" position="relative">
          <Box as="span" style={{ position: "relative", zIndex: 1 }}>
            changing
          </Box>
          <BrushstrokeUnderline />
        </Box>{" "}
        thousands of lives
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
        has stewarded children&apos;s centers across Tanzania, creating home and
        family for hundreds of the most vulnerable children on earth. Here you
        can walk with a specific child, providing education, medical care, and
        the belief in their potential that changes everything.
      </>
    ),
  },

  CHILD_LABORER: {
    heading: (
      <>
        Give a child laborer{" "}
        <Box as="br" display={{ base: "none", md: "initial" }} />
        the chance to be a child again
      </>
    ),
    description: (
      <>
        Across Tanzania, thousands of children spend their days working instead
        of learning, carrying loads no child should carry. Your sponsorship
        covers school fees, daily meals, and safe housing, replacing hardship
        with possibility. One sponsor, one child, one life quietly turned
        around.
      </>
    ),
  },

  SPECIAL_NEEDS: {
    heading: (
      <>
        Every child deserves{" "}
        <Box as="br" display={{ base: "none", md: "initial" }} />
        to be seen, known, and loved
      </>
    ),
    description: (
      <>
        Children with special needs are too often the most invisible,
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
        Tanzania&apos;s streets are home to thousands of abandoned dogs with no
        food, no shelter, and no one in their corner. Your sponsorship provides
        veterinary care, a safe place to recover, and real hope for a dog that
        has known only hardship. Small life, enormous impact.
      </>
    ),
  },
}

// ---------------------------------------------------------------------------
// Nav links — derived from central config
// ---------------------------------------------------------------------------

const HERO_LINKS: { type: HeroType; label: string }[] =
  ALL_BENEFICIARY_TABS.filter(
    (tab) => !tab.isLegacyAlias && tab.isPubliclyVisible,
  ).map((tab) => ({
    type: (tab.type ?? "ALL") as HeroType,
    label: tab.label,
  }))

const EXIT_DURATION_MS = 200
const ENTER_DURATION_MS = 300

// ---------------------------------------------------------------------------
// Shared button reset style
// ---------------------------------------------------------------------------

const BTN_RESET: React.CSSProperties = {
  background: "none",
  border: "none",
  outline: "none",
  WebkitAppearance: "none",
  MozAppearance: "none",
  appearance: "none",
  padding: 0,
  fontFamily: "var(--font-reddit-sans), sans-serif",
  lineHeight: 1.25,
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const HomeHero = ({ activeType, onTypeChange }: HomeHeroProps) => {
  const heroType = tabTypeToHeroType(activeType)

  const [displayedType, setDisplayedType] = useState<HeroType>(heroType)
  const [phase, setPhase] = useState<"exit" | "idle">("idle")
  const [hoveredType, setHoveredType] = useState<HeroType | null>(null)

  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const raf1Ref = useRef<number | null>(null)
  const raf2Ref = useRef<number | null>(null)
  const prevHeroTypeRef = useRef<HeroType>(heroType)

  useEffect(() => {
    return () => {
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current)
      if (raf1Ref.current) cancelAnimationFrame(raf1Ref.current)
      if (raf2Ref.current) cancelAnimationFrame(raf2Ref.current)
    }
  }, [])

  useEffect(() => {
    if (heroType === prevHeroTypeRef.current) return
    prevHeroTypeRef.current = heroType

    if (exitTimerRef.current) clearTimeout(exitTimerRef.current)
    if (raf1Ref.current) cancelAnimationFrame(raf1Ref.current)
    if (raf2Ref.current) cancelAnimationFrame(raf2Ref.current)

    setPhase("exit")

    exitTimerRef.current = setTimeout(() => {
      setDisplayedType(heroType)
      raf1Ref.current = requestAnimationFrame(() => {
        raf2Ref.current = requestAnimationFrame(() => {
          setPhase("idle")
        })
      })
    }, EXIT_DURATION_MS)
  }, [heroType])

  const handleTypeClick = useCallback(
    (type: HeroType) => {
      if (type === heroType) return
      onTypeChange(heroTypeToTabType(type))
    },
    [heroType, onTypeChange],
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
        style={{
          width: "100vw",
          marginLeft: "calc(-50vw + 50%)",
          marginTop: "-88px",
          paddingTop: "88px",
          paddingBottom: "16px",
        }}
      >

        {/* ----------------------------------------------------------------
            Mobile: full-bleed horizontally scrollable tab strip.
            Uses the same 100vw + negative-margin escape as the hero
            background itself so the strip always touches both screen edges.
        ---------------------------------------------------------------- */}
        <Box
          display={{ base: "block", md: "none" }}
          overflowX="auto"
          overflowY="hidden"
          style={{
            position: "relative",
            zIndex: 1,
            width: "100vw",
            marginLeft: "calc(-50vw + 50%)",
            borderBottom: "1px solid #e5e7eb",
            scrollbarWidth: "none",
            msOverflowStyle: "none",
            animation: "pageContentFadeUp 0.45s 0.12s cubic-bezier(0.22, 1, 0.36, 1) both",
          }}
          className="[&::-webkit-scrollbar]:hidden"
        >
          <Box
            as="nav"
            aria-label="Beneficiary type"
            display="flex"
            style={{
              paddingLeft: "0.5rem",
              paddingRight: "0.5rem",
              width: "max-content",
              minWidth: "100%",
            }}
          >
            {HERO_LINKS.map(({ type, label }) => {
              const isActive = heroType === type
              return (
                <button
                  key={type}
                  onClick={() => handleTypeClick(type)}
                  aria-current={isActive ? "true" : undefined}
                  style={{
                    ...BTN_RESET,
                    position: "relative",
                    cursor: isActive ? "default" : "pointer",
                    paddingTop: "0.75rem",
                    paddingBottom: "0.875rem",
                    paddingLeft: "0.875rem",
                    paddingRight: "0.875rem",
                    fontSize: "0.875rem",
                    fontWeight: isActive ? 800 : 700,
                    color: isActive ? "#2b7ff9" : "#6b7280",
                    whiteSpace: "nowrap",
                    marginBottom: "-1px",
                    transition: "color 0.18s ease",
                  }}
                >
                  {label}
                  <span
                    style={{
                      position: "absolute",
                      bottom: 0,
                      left: "0.5rem",
                      right: "0.5rem",
                      height: "3px",
                      borderRadius: "99px",
                      background: isActive ? "#2b7ff9" : "transparent",
                      transition: "background 0.18s ease",
                    }}
                  />
                </button>
              )
            })}
          </Box>
        </Box>

        {/* ----------------------------------------------------------------
            Content row: desktop nav (left) + heading/description (right)
        ---------------------------------------------------------------- */}
        <Box
          className="max-w-[1200px] mx-auto px-6 md:px-8"
          style={{ position: "relative", zIndex: 1 }}
        >
          <Box
            display="flex"
            flexDirection="row"
            alignItems={{ base: "flex-start", md: "center" }}
            gap={{ base: 0, md: 10 }}
            pt={{ base: 8, md: 12 }}
            pb={{ base: 2, md: 2 }}
            minHeight={{ base: "180px", md: "0px" }}
          >
            {/* Desktop-only left nav — fixed width so font/bar animations
                never reflow the adjacent content column. */}
            <Box
              as="nav"
              aria-label="Beneficiary type"
              display={{ base: "none", md: "flex" }}
              flexDirection="column"
              gap={1}
              flexShrink={0}
              style={{
                width: "220px",
                animation: "pageContentFadeUp 0.5s 0.15s cubic-bezier(0.22, 1, 0.36, 1) both",
              }}
            >
              {HERO_LINKS.map(({ type, label }) => {
                const isActive = heroType === type
                const isHovered = hoveredType === type && !isActive
                return (
                  <button
                    key={type}
                    onClick={() => handleTypeClick(type)}
                    onMouseEnter={() => setHoveredType(type)}
                    onMouseLeave={() => setHoveredType(null)}
                    aria-current={isActive ? "true" : undefined}
                    style={{
                      ...BTN_RESET,
                      cursor: isActive ? "default" : "pointer",
                      textAlign: "left",
                    }}
                  >
                    {/* Fixed height prevents the nav column from shifting
                        vertically as the active bar animates between heights. */}
                    <Box
                      display="flex"
                      alignItems="center"
                      gap={2}
                      style={{ height: "2.75rem" }}
                    >
                      {/* Circled check — visible only when active */}
                      <Box
                        flexShrink={0}
                        style={{
                          width: "18px",
                          height: "18px",
                          opacity: isActive ? 1 : 0,
                          transform: isActive ? "scale(1)" : "scale(0.6)",
                          transition: `opacity ${EXIT_DURATION_MS}ms ease, transform ${EXIT_DURATION_MS}ms ease`,
                        }}
                      >
                        <svg viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" width="18" height="18">
                          <circle cx="9" cy="9" r="9" fill="#2b7ff9" />
                          <path d="M5 9.5L7.5 12L13 6.5" stroke="white" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </Box>

                      {/* Animated left bar */}
                      <Box
                        style={{
                          width: "3px",
                          flexShrink: 0,
                          borderRadius: "2px",
                          transition: `height ${EXIT_DURATION_MS}ms ease, background ${EXIT_DURATION_MS}ms ease, opacity ${EXIT_DURATION_MS}ms ease`,
                          height: isActive ? "2.25rem" : isHovered ? "1.375rem" : "0.875rem",
                          background: isActive ? "#2b7ff9" : isHovered ? "#5a84c1" : "#999",
                          opacity: isActive ? 1 : isHovered ? 0.85 : 0.55,
                        }}
                      />
                      <span
                        style={{
                          fontSize: "1.2rem",
                          fontWeight: 800,
                          color: isActive ? "#2b7ff9" : isHovered ? "#5a84c1" : "#888",
                          transition: `color ${EXIT_DURATION_MS}ms ease`,
                          display: "block",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {label}
                      </span>
                    </Box>
                  </button>
                )
              })}
            </Box>

            {/* Animated heading + description */}
            <Box
              flex={1}
              minW={0}
              maxW={{ base: "100%", md: "75%" }}
              style={{
                opacity: phase === "exit" ? 0 : 1,
                transform:
                  phase === "exit" ? "translateY(-12px)" : "translateY(0)",
                transition:
                  phase === "exit"
                    ? `opacity ${EXIT_DURATION_MS}ms ease, transform ${EXIT_DURATION_MS}ms ease`
                    : "none",
                // One-time page-load entrance. fill-mode: backwards keeps the
                // element at opacity-0 during the delay, then hands opacity back
                // to the inline style above once the animation completes so that
                // the phase-transition logic (exit → opacity:0) still works.
                animation: "pageContentFadeUp 0.5s 0.22s cubic-bezier(0.22, 1, 0.36, 1) backwards",
              }}
            >
              <Box
                key={displayedType}
                width="100%"
                style={{
                  animation:
                    phase !== "exit"
                      ? `heroFadeInUp ${ENTER_DURATION_MS}ms ease forwards`
                      : "none",
                }}
              >
                <Heading
                  as="h1"
                  fontSize={{ base: "2xl", md: "3xl", lg: "4xl" }}
                  fontWeight="800"
                  color="#2b7ff9"
                  lineHeight="1.15"
                  mb={5}
                  style={{ fontFamily: "var(--font-reddit-sans), sans-serif" }}
                >
                  {content.heading}
                </Heading>
                <Text
                  fontSize={{ base: "sm", md: "md" }}
                  color="#666666"
                  lineHeight="1.7"
                >
                  {content.description}
                </Text>
              </Box>
            </Box>
          </Box>
        </Box>
      </Box>
    </>
  )
}
