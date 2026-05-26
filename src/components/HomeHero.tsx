"use client"
import React, { useState, useRef, useCallback, useEffect } from "react"
import { Box, Heading, Text } from "@chakra-ui/react"
import { ALL_BENEFICIARY_TABS } from "@/config/beneficiaryTypes"
import type { BeneficiaryTabType } from "@/config/beneficiaryTypes"
import { HeartHandMark } from "@/components/common/HeartHandMark"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HeroContent {
  heading: React.ReactNode
  description: React.ReactNode
}

interface HomeHeroProps {
  activeType: BeneficiaryTabType | null
  onTypeChange: (type: BeneficiaryTabType | null) => void
}

// "ALL" is the display key used when activeType is null or the legacy "CHILD" alias.
type DisplayKey = "ALL" | BeneficiaryTabType

function toDisplayKey(type: BeneficiaryTabType | null): DisplayKey {
  if (!type || type === "CHILD") return "ALL"
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
// Hero content per display key
// ---------------------------------------------------------------------------

const HERO_CONTENT: Record<DisplayKey, HeroContent> = {
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

  CHILD: {
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

  IN_OUR_CARE: {
    heading: (
      <>
        A home, a family,{" "}
        <Box as="br" display={{ base: "none", md: "initial" }} />
        and a future to embrace
      </>
    ),
    description: (
      <>
        Every child in our care was once alone. Now they have a home, a
        school, and adults who show up with loving care. Your sponsorship
        changes lives.
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

const HIDDEN_HOME_LINK_TYPES = new Set<BeneficiaryTabType>(["IN_OUR_CARE"])

const HERO_LINKS: { type: BeneficiaryTabType | null; label: string }[] =
  ALL_BENEFICIARY_TABS.filter(
    (tab) =>
      !tab.isLegacyAlias &&
      tab.isPubliclyVisible &&
      (tab.type === null || !HIDDEN_HOME_LINK_TYPES.has(tab.type)),
  ).map((tab) => ({
    type: tab.type,
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
  const displayKey = toDisplayKey(activeType)

  const [displayedKey, setDisplayedKey] = useState<DisplayKey>(displayKey)
  const [phase, setPhase] = useState<"exit" | "idle">("idle")
  const [hoveredType, setHoveredType] = useState<
    BeneficiaryTabType | null | undefined
  >(undefined)

  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const raf1Ref = useRef<number | null>(null)
  const raf2Ref = useRef<number | null>(null)
  const prevDisplayKeyRef = useRef<DisplayKey>(displayKey)
  const contentMeasureRef = useRef<HTMLDivElement>(null)
  const [mobileContentHeight, setMobileContentHeight] = useState<number | null>(
    null,
  )
  // Default false → desktop layout on first paint; flips on mount via matchMedia.
  const [isMobile, setIsMobile] = useState(false)
  // Suppresses the height transition on the very first measured frame after
  // mounting on mobile, so the SSR-default desktop height doesn't visibly
  // animate down to the mobile measured value.
  const hasMeasuredOnceRef = useRef(false)
  const [allowHeightTransition, setAllowHeightTransition] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 47.99em)")
    const update = () => setIsMobile(mq.matches)
    update()
    mq.addEventListener("change", update)
    return () => mq.removeEventListener("change", update)
  }, [])

  useEffect(() => {
    return () => {
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current)
      if (raf1Ref.current) cancelAnimationFrame(raf1Ref.current)
      if (raf2Ref.current) cancelAnimationFrame(raf2Ref.current)
    }
  }, [])

  useEffect(() => {
    if (displayKey === prevDisplayKeyRef.current) return
    prevDisplayKeyRef.current = displayKey

    if (exitTimerRef.current) clearTimeout(exitTimerRef.current)
    if (raf1Ref.current) cancelAnimationFrame(raf1Ref.current)
    if (raf2Ref.current) cancelAnimationFrame(raf2Ref.current)

    setPhase("exit")

    exitTimerRef.current = setTimeout(() => {
      setDisplayedKey(displayKey)
      raf1Ref.current = requestAnimationFrame(() => {
        raf2Ref.current = requestAnimationFrame(() => {
          if (contentMeasureRef.current) {
            setMobileContentHeight(contentMeasureRef.current.scrollHeight)
          }
          setPhase("idle")
        })
      })
    }, EXIT_DURATION_MS)
  }, [displayKey])

  useEffect(() => {
    if (contentMeasureRef.current && mobileContentHeight === null) {
      setMobileContentHeight(contentMeasureRef.current.scrollHeight)
    }
  }, [mobileContentHeight])

  useEffect(() => {
    if (isMobile === false) {
      setMobileContentHeight(null)
      hasMeasuredOnceRef.current = false
      setAllowHeightTransition(false)
    }
  }, [isMobile])

  // Enable height transitions only after the first measured frame on mobile.
  // The first measurement snaps to the natural content height with no animation;
  // subsequent measurements (tab change, viewport resize) animate.
  useEffect(() => {
    if (
      !allowHeightTransition &&
      isMobile &&
      mobileContentHeight !== null &&
      !hasMeasuredOnceRef.current
    ) {
      hasMeasuredOnceRef.current = true
      const id = requestAnimationFrame(() => setAllowHeightTransition(true))
      return () => cancelAnimationFrame(id)
    }
  }, [isMobile, mobileContentHeight, allowHeightTransition])

  useEffect(() => {
    const el = contentMeasureRef.current
    if (!el || !isMobile) return
    const ro = new ResizeObserver(() => {
      setMobileContentHeight(el.scrollHeight)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [isMobile])

  const handleTypeClick = useCallback(
    (type: BeneficiaryTabType | null) => {
      if (toDisplayKey(type) === displayKey) return
      onTypeChange(type)
    },
    [displayKey, onTypeChange],
  )

  const content = HERO_CONTENT[displayedKey]

  return (
    <Box
      className="relative"
      style={{
        width: "100vw",
        marginLeft: "calc(-50vw + 50%)",
        marginTop: "-88px",
        paddingTop: "88px",
        paddingBottom: "4px",
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
          animation:
            "pageContentFadeUp 0.45s 0.12s cubic-bezier(0.22, 1, 0.36, 1) both",
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
            const isActive = toDisplayKey(type) === displayKey
            return (
              <button
                key={type ?? "all"}
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
          pt={{ base: 6, md: 0 }}
          pb={{ base: 0 }}
          minH={{ base: 0, md: "240px" }}
          style={{
            ...(isMobile && mobileContentHeight != null
              ? {
                  height: `${mobileContentHeight + 24}px`,
                  overflow: "hidden",
                  transition: allowHeightTransition
                    ? "height 0.3s ease"
                    : "none",
                }
              : {}),
          }}
        >
          {/* Desktop-only left nav — fixed width so font/bar animations
              never reflow the adjacent content column. */}
          <Box
            as="nav"
            aria-label="Beneficiary type"
            display={{ base: "none", md: "flex" }}
            flexDirection="column"
            gap={0}
            flexShrink={0}
            style={{
              width: "220px",
              animation:
                "pageContentFadeUp 0.5s 0.15s cubic-bezier(0.22, 1, 0.36, 1) both",
            }}
          >
            {HERO_LINKS.map(({ type, label }, idx) => {
              const isActive = toDisplayKey(type) === displayKey
              const isHovered = hoveredType === type && !isActive
              const isFirstTypeItem =
                idx > 0 && HERO_LINKS[idx - 1].type === null
              return (
                <React.Fragment key={type ?? "all"}>
                  {isFirstTypeItem && (
                    <Box style={{ height: "14px" }} aria-hidden />
                  )}
                  <button
                    onClick={() => handleTypeClick(type)}
                    onMouseEnter={() => setHoveredType(type)}
                    onMouseLeave={() => setHoveredType(undefined)}
                    aria-current={isActive ? "true" : undefined}
                    style={{
                      ...BTN_RESET,
                      cursor: isActive ? "default" : "pointer",
                      textAlign: "left",
                    }}
                  >
                    <Box
                      display="flex"
                      alignItems="center"
                      gap={2}
                      style={{
                        height: type === null ? "2.75rem" : "1.75rem",
                      }}
                    >
                      {/* Heart-hand logo mark — solid on active, ghosted on hover */}
                      <Box
                        flexShrink={0}
                        style={{
                          width: "22px",
                          height: "20px",
                          opacity: isActive ? 1 : isHovered ? 0.45 : 0,
                          transform: isActive
                            ? "scale(1)"
                            : isHovered
                              ? "scale(0.65)"
                              : "scale(0.5)",
                          transition: `opacity ${EXIT_DURATION_MS}ms ease, transform ${EXIT_DURATION_MS}ms ease`,
                        }}
                      >
                        <HeartHandMark width={22} height={20} />
                      </Box>

                      <span
                        style={{
                          fontSize: "1.2rem",
                          fontWeight: 800,
                          color: isActive
                            ? "#2b7ff9"
                            : isHovered
                              ? "#5a84c1"
                              : "#888",
                          transition: `color ${EXIT_DURATION_MS}ms ease`,
                          display: "block",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {label}
                      </span>
                    </Box>
                  </button>
                </React.Fragment>
              )
            })}
          </Box>

          {/* Animated heading + description */}
          <Box
            ref={contentMeasureRef}
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
              animation:
                "pageContentFadeUp 0.5s 0.22s cubic-bezier(0.22, 1, 0.36, 1) backwards",
            }}
          >
            <Box
              key={displayedKey}
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
  )
}
