"use client"
import React, { useEffect, useState } from "react"

type BgId = 1 | 2 | 3 | 4 | 5

const STORAGE_KEY = "cs_bg_v3"

function readId(): BgId {
  if (typeof window === "undefined") return 1
  try {
    const v = parseInt(localStorage.getItem(STORAGE_KEY) ?? "", 10)
    return v >= 1 && v <= 5 ? (v as BgId) : 1
  } catch {
    return 1
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Hex grid geometry — precomputed once at module load
// R is 50% of the previous 29px → 15px (quarter of the original 58px)
// ─────────────────────────────────────────────────────────────────────────────

const HEX_R  = 15
const HEX_DX = HEX_R * Math.sqrt(3)   // ≈ 26.0 px — horizontal stride
const HEX_DY = HEX_R * 1.5            // = 22.5 px — vertical stride

// Three-tone fills — 50% brighter/more saturated than the previous pale golds
const HEX_FILLS = ["#f7c94a", "#fbdf72", "#fef0a8"]

// At this pitch we need ~62 cols × 40 rows to fully cover 1440 × 760.
const HEX_CELLS = Array.from({ length: 40 * 62 }, (_, idx) => {
  const row = Math.floor(idx / 62) - 1
  const col = (idx % 62) - 1
  const x = col * HEX_DX + (row % 2 === 1 ? HEX_DX / 2 : 0)
  const y = row * HEX_DY + HEX_R
  return { x, y, fill: HEX_FILLS[Math.abs(row * 3 + col) % 3] }
})

function hexPath(cx: number, cy: number): string {
  const pts = Array.from({ length: 6 }, (_, i) => {
    const a = ((i * 60 + 30) * Math.PI) / 180
    return `${(cx + HEX_R * Math.cos(a)).toFixed(1)},${(cy + HEX_R * Math.sin(a)).toFixed(1)}`
  })
  return `M${pts.join("L")}Z`
}

// ─────────────────────────────────────────────────────────────────────────────
// HiveGrid — the raw SVG at a given opacity (no background rect)
// The SVG is transparent everywhere except the hex cells themselves,
// so the page background shows through between / around cells.
// ─────────────────────────────────────────────────────────────────────────────

function HiveGrid({ opacity }: { opacity: number }) {
  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 0 1440 760"
      preserveAspectRatio="xMidYMid slice"
      opacity={opacity}
    >
      {HEX_CELLS.map((c, i) => (
        <path
          key={i}
          d={hexPath(c.x, c.y)}
          fill={c.fill}
          stroke="#c8940a"
          strokeWidth="0.75"
        />
      ))}
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Mask system — two nested divs for reliable cross-browser compositing.
//
// OUTER div  → bottom-fade mask: full-opacity at top, fades to transparent
//              below ~68% of the element height so the hive dissolves before
//              the white content card.
//
// INNER div  → side-edge mask: transparent across the full center band so the
//              white base layer shows through cleanly, then fades to opaque
//              only at the left/right extremes (outside the ~1200px content
//              rail).  At 1440 px viewport the content rail occupies ~83% of
//              the width, leaving ~8.5% margin each side — the fade zone sits
//              just inside those margins so hexes are invisible over content.
// ─────────────────────────────────────────────────────────────────────────────

const OUTER_MASK =
  "linear-gradient(to bottom, black 0%, black 65%, transparent 100%)"

// Side-edge only: transparent center, hexes visible only at far left/right
const INNER_MASK =
  "linear-gradient(to right, black 0%, transparent 9%, transparent 91%, black 100%)"

function MaskedHive({ opacity }: { opacity: number }) {
  return (
    // Outer: clips the bottom fade
    <div
      style={{
        width: "100%",
        height: "100%",
        WebkitMaskImage: OUTER_MASK,
        maskImage: OUTER_MASK,
      }}
    >
      {/* Inner: clears the center so hero text reads cleanly */}
      <div
        style={{
          width: "100%",
          height: "100%",
          WebkitMaskImage: INNER_MASK,
          maskImage: INNER_MASK,
        }}
      >
        <HiveGrid opacity={opacity} />
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Variant registry — 5 opacity tiers
// ─────────────────────────────────────────────────────────────────────────────

const OPACITIES: Record<BgId, number> = {
  1: 0.12,
  2: 0.26,
  3: 0.44,
  4: 0.62,
  5: 0.80,
}

const LABELS: Record<BgId, string> = {
  1: "Whisper",
  2: "Light",
  3: "Medium",
  4: "Bold",
  5: "Strong",
}

// Swatch color represents each tier — same hue, darker as opacity increases
const SWATCHES: Record<BgId, string> = {
  1: "#fdf4d0",
  2: "#fae59a",
  3: "#f5d550",
  4: "#e8c030",
  5: "#d4aa10",
}

// ─────────────────────────────────────────────────────────────────────────────
// Exported component
// ─────────────────────────────────────────────────────────────────────────────

export function HomeBgPicker() {
  const [selected, setSelected] = useState<BgId>(1)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    setSelected(readId())
  }, [])

  const select = (id: BgId) => {
    setSelected(id)
    try {
      localStorage.setItem(STORAGE_KEY, String(id))
    } catch { /* ignore */ }
  }

  return (
    <>
      {/* ── Background layers ─────────────────────────────────────── */}
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
        {/* White base: fully solid for the entire hex zone — no fade here.
            The transition to gray is handled by the extension div below. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "#ffffff",
          }}
        />
        {/* Hex pattern on top of white */}
        <MaskedHive opacity={OPACITIES[selected]} />
      </div>

      {/* White-to-gray transition — starts at the bottom edge of the hex
          container (top: -88px + 760px = 672px from Box top = 760px from
          viewport top) and fades white to transparent over 500px, so the
          gray page background only becomes visible well below the content. */}
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

      {/* ── Debug switcher ────────────────────────────────────────── */}
      <div
        style={{
          position: "fixed",
          bottom: 20,
          right: 20,
          zIndex: 9999,
          fontFamily: "system-ui, sans-serif",
          fontSize: 12,
          userSelect: "none",
        }}
      >
        {open && (
          <div
            style={{
              marginBottom: 8,
              padding: "14px 14px 12px",
              background: "rgba(12,12,18,0.92)",
              backdropFilter: "blur(16px)",
              WebkitBackdropFilter: "blur(16px)",
              border: "1px solid rgba(255,255,255,0.11)",
              borderRadius: 16,
              boxShadow: "0 10px 40px rgba(0,0,0,0.50)",
              color: "#fff",
            }}
          >
            <p
              style={{
                margin: "0 0 10px",
                fontSize: 9,
                letterSpacing: "0.10em",
                textTransform: "uppercase",
                color: "rgba(255,255,255,0.40)",
                fontWeight: 700,
              }}
            >
              Hive Opacity
            </p>

            {/* 5 swatches in a row */}
            <div style={{ display: "flex", gap: 7 }}>
              {([1, 2, 3, 4, 5] as BgId[]).map((id) => (
                <button
                  key={id}
                  onClick={() => select(id)}
                  title={LABELS[id]}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 10,
                    cursor: "pointer",
                    background: SWATCHES[id],
                    border: selected === id
                      ? "2.5px solid #fff"
                      : "2px solid rgba(255,255,255,0.18)",
                    boxShadow: selected === id
                      ? "0 0 0 2.5px rgba(75,159,255,0.65)"
                      : "none",
                    display: "flex",
                    alignItems: "flex-end",
                    justifyContent: "flex-end",
                    padding: "0 4px 3px 0",
                    transition: "border 0.12s, box-shadow 0.12s",
                  }}
                >
                  <span
                    style={{
                      fontSize: 9,
                      color: "rgba(0,0,0,0.50)",
                      fontWeight: 800,
                      lineHeight: 1,
                    }}
                  >
                    {id}
                  </span>
                </button>
              ))}
            </div>

            {/* Active label */}
            <div
              style={{
                marginTop: 10,
                paddingTop: 9,
                borderTop: "1px solid rgba(255,255,255,0.09)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                gap: 8,
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 600 }}>
                {LABELS[selected]}
              </span>
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.42)" }}>
                {Math.round(OPACITIES[selected] * 100)}% opacity
              </span>
            </div>
          </div>
        )}

        <button
          onClick={() => setOpen((o) => !o)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "7px 14px",
            background: open ? "rgba(75,159,255,0.92)" : "rgba(12,12,18,0.82)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
            border: "1px solid rgba(255,255,255,0.18)",
            borderRadius: 20,
            color: "#fff",
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.04em",
            boxShadow: "0 4px 18px rgba(0,0,0,0.32)",
            lineHeight: 1,
            transition: "background 0.2s",
          }}
        >
          <span style={{ fontSize: 13 }}>◈</span>
          <span>
            Hive {selected} · {Math.round(OPACITIES[selected] * 100)}%
          </span>
        </button>
      </div>
    </>
  )
}
