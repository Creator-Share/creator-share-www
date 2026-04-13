// ─────────────────────────────────────────────────────────────────────────────
// Page background: smooth white-to-gray transition at the top of the page.
//
// The deep-amber edge halos are commented out below — uncomment to re-enable.
// ─────────────────────────────────────────────────────────────────────────────

// const HALO_IMAGE = [
//   "radial-gradient(ellipse 32% 94% at 0%   44%, rgb(245,196,66) 0%, rgb(240,152,48) 38%, transparent 96%)",
//   "radial-gradient(ellipse 32% 94% at 100% 44%, rgb(245,196,66) 0%, rgb(240,152,48) 38%, transparent 96%)",
// ].join(", ")
//
// const OUTER_MASK = "linear-gradient(to bottom, black 0%, black 45%, transparent 100%)"
// const INNER_MASK = "linear-gradient(to right, black 0%, transparent 9%, transparent 91%, black 100%)"
//
// const MAX_W = 1440  // px — full opacity above this
// const MIN_W = 1100  // px — zero opacity below this
// const MAX_OPACITY = 0.20
//
// function clampedOpacity(vw: number): number {
//   if (vw >= MAX_W) return MAX_OPACITY
//   if (vw <= MIN_W) return 0
//   return ((vw - MIN_W) / (MAX_W - MIN_W)) * MAX_OPACITY
// }

export function HomeBgPicker() {
  return (
    <>
      {/* ── Halo layer (disabled) ───────────────────────────────────────── */}
      {/* <div aria-hidden style={{ position: "absolute", top: "-88px", ... }} /> */}

      {/* White-to-gray transition below the hero */}
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
