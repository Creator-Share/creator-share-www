// ─────────────────────────────────────────────────────────────────────────────
// Honeycomb background — golden hex tile at 12% opacity, edge-only visibility.
//
// Tile geometry (r = 7.5, 50% larger than the previous r = 5):
//   DX = 7.5·√3 ≈ 12.99 px   (horizontal stride)
//   DY = 7.5·1.5 = 11.25 px  (vertical stride)
//   Tile: 3·DX × 3r  →  38.97 × 22.5 px — two staggered rows, 3-tone cycle
//
// CSS background-image (data URI) is used instead of SVG <pattern> because
// -webkit-mask-image on parent divs breaks url(#id) references inside SVGs.
// ─────────────────────────────────────────────────────────────────────────────

const HEX_TILE_URI = (() => {
  const s =
    `<svg xmlns='http://www.w3.org/2000/svg' width='38.97' height='22.5'>` +
    // row 0
    `<path d='M12.99,11.25 L6.495,15 L0,11.25 L0,3.75 L6.495,0 L12.99,3.75Z' fill='%23f7c94a' stroke='%23c8940a' stroke-width='.3'/>` +
    `<path d='M25.98,11.25 L19.485,15 L12.99,11.25 L12.99,3.75 L19.485,0 L25.98,3.75Z' fill='%23fbdf72' stroke='%23c8940a' stroke-width='.3'/>` +
    `<path d='M38.97,11.25 L32.475,15 L25.98,11.25 L25.98,3.75 L32.475,0 L38.97,3.75Z' fill='%23fef0a8' stroke='%23c8940a' stroke-width='.3'/>` +
    // row 1 (offset by DX/2)
    `<path d='M6.495,22.5 L0,26.25 L-6.495,22.5 L-6.495,15 L0,11.25 L6.495,15Z' fill='%23fbdf72' stroke='%23c8940a' stroke-width='.3'/>` +
    `<path d='M19.485,22.5 L12.99,26.25 L6.495,22.5 L6.495,15 L12.99,11.25 L19.485,15Z' fill='%23fef0a8' stroke='%23c8940a' stroke-width='.3'/>` +
    `<path d='M32.475,22.5 L25.98,26.25 L19.485,22.5 L19.485,15 L25.98,11.25 L32.475,15Z' fill='%23f7c94a' stroke='%23c8940a' stroke-width='.3'/>` +
    // right boundary — same tone as left boundary (same physical hex)
    `<path d='M45.465,22.5 L38.97,26.25 L32.475,22.5 L32.475,15 L38.97,11.25 L45.465,15Z' fill='%23fbdf72' stroke='%23c8940a' stroke-width='.3'/>` +
    `</svg>`
  return `url("data:image/svg+xml,${s}")`
})()

// OUTER mask: bottom fade — solid top 65%, dissolves to transparent at 100%
const OUTER_MASK = "linear-gradient(to bottom, black 0%, black 65%, transparent 100%)"

// INNER mask: side-edge only — center band is transparent (white shows through),
// hexes visible only in the ~9% margins outside the 1200px content rail.
const INNER_MASK =
  "linear-gradient(to right, black 0%, transparent 9%, transparent 91%, black 100%)"

export function HomeBgPicker() {
  return (
    <>
      {/* ── Hex zone: full-width, starts behind the navbar (top: -88px) ── */}
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
        {/* Solid white base so hexes sit on white, not gray */}
        <div style={{ position: "absolute", inset: 0, background: "#ffffff" }} />

        {/* Masked hex layer */}
        <div
          style={{
            width: "100%",
            height: "100%",
            WebkitMaskImage: OUTER_MASK,
            maskImage: OUTER_MASK,
          }}
        >
          <div
            style={{
              width: "100%",
              height: "100%",
              WebkitMaskImage: INNER_MASK,
              maskImage: INNER_MASK,
            }}
          >
            <div
              style={{
                width: "100%",
                height: "100%",
                backgroundImage: HEX_TILE_URI,
                backgroundSize: "38.97px 22.5px",
                backgroundRepeat: "repeat",
                backgroundPosition: "0 0",
                opacity: 0.20,
              }}
            />
          </div>
        </div>
      </div>

      {/* White-to-gray transition below the hex zone */}
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
