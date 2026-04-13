"use client"
import { useEffect, useState } from "react"

// ─────────────────────────────────────────────────────────────────────────────
// Deep Amber warm-halo background.
//
// The gradient is a pair of wide radial halos anchored at the left and right
// edges — gold core fading through amber, dissolving at 96%.
//
// Viewport-responsive opacity:
//   ≥ 1440 px  →  full intensity (0.20)
//   1440→1100  →  linear fade
//   ≤ 1100 px  →  invisible (0.00)
//
// Below ~1200px the content rail fills the full viewport, leaving no margin
// for the edge halos to live in — so they should be invisible by then.
// ─────────────────────────────────────────────────────────────────────────────

const HALO_IMAGE = [
  "radial-gradient(ellipse 32% 94% at 0%   44%, rgb(245,196,66) 0%, rgb(240,152,48) 38%, transparent 96%)",
  "radial-gradient(ellipse 32% 94% at 100% 44%, rgb(245,196,66) 0%, rgb(240,152,48) 38%, transparent 96%)",
].join(", ")

const OUTER_MASK = "linear-gradient(to bottom, black 0%, black 45%, transparent 100%)"
const INNER_MASK = "linear-gradient(to right, black 0%, transparent 9%, transparent 91%, black 100%)"

const MAX_W = 1440  // px — full opacity above this
const MIN_W = 1100  // px — zero opacity below this
const MAX_OPACITY = 0.20

function clampedOpacity(vw: number): number {
  if (vw >= MAX_W) return MAX_OPACITY
  if (vw <= MIN_W) return 0
  return ((vw - MIN_W) / (MAX_W - MIN_W)) * MAX_OPACITY
}

export function HomeBgPicker() {
  // Start at MAX_W so SSR and first paint match the wide-screen default
  const [opacity, setOpacity] = useState(MAX_OPACITY)

  useEffect(() => {
    const update = () => setOpacity(clampedOpacity(window.innerWidth))
    update()
    window.addEventListener("resize", update)
    return () => window.removeEventListener("resize", update)
  }, [])

  return (
    <>
      {/* ── Halo layer ─────────────────────────────────────────────────── */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: "-88px",
          left: "calc(-50vw + 50%)",
          width: "100vw",
          height: "760px",
          zIndex: 0,
          pointerEvents: "none",
          overflow: "hidden",
        }}
      >
        <div style={{ position: "absolute", inset: 0, background: "#ffffff" }} />
        <div style={{ width: "100%", height: "100%", WebkitMaskImage: OUTER_MASK, maskImage: OUTER_MASK }}>
          <div style={{ width: "100%", height: "100%", WebkitMaskImage: INNER_MASK, maskImage: INNER_MASK }}>
            <div
              style={{
                width: "100%",
                height: "100%",
                backgroundImage: HALO_IMAGE,
                backgroundSize: "100% 100%",
                backgroundRepeat: "no-repeat",
                opacity,
                transition: "opacity 0.4s ease",
              }}
            />
          </div>
        </div>
      </div>

      {/* White-to-gray transition below the halo zone */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: "672px",
          left: "calc(-50vw + 50%)",
          width: "100vw",
          height: "500px",
          zIndex: 0,
          pointerEvents: "none",
          background: "linear-gradient(to bottom, white 0%, transparent 100%)",
        }}
      />
    </>
  )
}
