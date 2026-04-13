"use client"
import { useEffect, useState } from "react"

type BgId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10

const STORAGE_KEY = "cs_bg_v4"
function readId(): BgId {
  if (typeof window === "undefined") return 1
  try {
    const v = parseInt(localStorage.getItem(STORAGE_KEY) ?? "", 10)
    return v >= 1 && v <= 10 ? (v as BgId) : 1
  } catch { return 1 }
}

// ─────────────────────────────────────────────────────────────────────────────
// Colour palette drawn from the reference sunset image
//   amber-gold  rgb(245,196,66)
//   amber       rgb(240,152,48)
//   terracotta  rgb(212,96,30)
//   deep orange rgb(201,77,26)
//   dark terra  rgb(180,60,20)
//   warm orange rgb(224,112,34)
//
// All patterns use full-opacity colours; the 20% dim is applied to the
// container div so every variant reads at a consistent intensity.
// ─────────────────────────────────────────────────────────────────────────────

// 1 ─ AMBER TOPO ─ organic topo-map oval contour rings (crisp strokes, no fill)
const BG1_IMAGE = `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='320' height='240'><path d='M160,20 C220,-5 315,30 322,78 C335,144 290,214 214,228 C130,242 34,208 14,152 C-10,88 28,40 88,20 C118,8 132,32 160,20Z' fill='none' stroke='rgb(224,112,34)' stroke-width='1.8'/><path d='M160,46 C212,24 298,56 308,98 C322,158 284,213 214,222 C144,232 60,200 44,152 C24,98 60,58 108,44 C134,36 140,58 160,46Z' fill='none' stroke='rgb(212,96,30)' stroke-width='1.5'/><path d='M160,72 C205,52 284,76 292,112 C306,164 270,210 214,216 C156,223 88,192 76,152 C60,106 88,76 126,66 C148,59 148,84 160,72Z' fill='none' stroke='rgb(201,77,26)' stroke-width='1.3'/><path d='M160,98 C197,80 266,98 274,128 C284,170 256,207 214,210 C168,215 112,186 104,152 C92,116 112,94 138,88 C154,83 150,110 160,98Z' fill='none' stroke='rgb(180,60,20)' stroke-width='1.1'/></svg>")`
const BG1_SIZE = "320px 240px"

// 2 ─ GILDED SCALES ─ overlapping fish-scale / scallop arcs (r=50, tile 100×100)
// Scale A (golden) centred at (50,0): lower semicircle drawn on top
// Scale B (amber) centred at (0,50) and (100,50): left/right halves at edges
const BG2_IMAGE = `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100'><path d='M-50,50 A50,50 0 0 1 50,50Z' fill='rgb(240,152,48)' stroke='rgb(180,60,20)' stroke-width='1.3'/><path d='M50,50 A50,50 0 0 1 150,50Z' fill='rgb(240,152,48)' stroke='rgb(180,60,20)' stroke-width='1.3'/><path d='M0,0 A50,50 0 0 1 100,0Z' fill='rgb(245,196,66)' stroke='rgb(180,60,20)' stroke-width='1.3'/></svg>")`
const BG2_SIZE = "100px 100px"

// 3 ─ PUZZLE DUSK ─ interlocking puzzle pieces (200×200 tile, seamless tabs)
// TOP: indent  RIGHT: tab  BOTTOM: tab  LEFT: indent → tiles interlock perfectly
const BG3_IMAGE = (() => {
  const path = "M0,0 L80,0 A20,20 0 0 1 120,0 L200,0 L200,80 A20,20 0 0 0 200,120 L200,200 L120,200 A20,20 0 0 0 80,200 L0,200 L0,120 A20,20 0 0 1 0,80 Z"
  const a = `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><path d='${path}' fill='rgb(245,196,66)' stroke='rgb(180,60,20)' stroke-width='1.6'/></svg>")`
  const b = `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><path d='${path}' fill='rgb(212,96,30)' stroke='rgb(160,50,15)' stroke-width='1.6'/></svg>")`
  return `${a}, ${b}`
})()
const BG3_SIZE = "200px 200px"
const BG3_POS  = "0 0, 100px 100px"

// 4 ─ DESERT WAVES ─ smooth sinuous wave bands with soft fills (400×120 tile)
const BG4_IMAGE = `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='120'><path d='M0,22 C80,8 160,36 240,22 C320,8 370,28 400,22 L400,52 C320,68 240,42 160,56 C80,70 30,50 0,54Z' fill='rgb(245,196,66)' stroke='rgb(212,96,30)' stroke-width='1'/><path d='M0,62 C70,50 170,76 270,60 C340,50 380,66 400,62 L400,90 C380,96 340,80 270,88 C170,102 70,78 0,88Z' fill='rgb(240,152,48)' stroke='rgb(201,77,26)' stroke-width='1'/><path d='M0,96 C100,84 220,108 340,94 C370,90 390,98 400,96 L400,120 L0,120Z' fill='rgb(212,96,30)' stroke='rgb(180,60,20)' stroke-width='1'/></svg>")`
const BG4_SIZE = "400px 120px"

// 5 ─ CANYON STRATA ─ jagged sedimentary rock layers, crisp edges (480×160 tile)
const BG5_IMAGE = `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='480' height='160'><path d='M0,28 L48,20 L96,30 L144,16 L192,26 L240,18 L288,28 L336,14 L384,24 L432,18 L480,26 L480,46 L432,52 L384,44 L336,50 L288,40 L240,48 L192,38 L144,46 L96,40 L48,48 L0,44Z' fill='rgb(245,196,66)' stroke='rgb(212,96,30)' stroke-width='1'/><path d='M0,60 L60,50 L110,62 L160,48 L210,60 L260,50 L310,62 L360,52 L410,62 L460,54 L480,60 L480,82 L460,88 L410,80 L360,88 L310,80 L260,86 L210,78 L160,84 L110,78 L60,84 L0,80Z' fill='rgb(240,152,48)' stroke='rgb(201,77,26)' stroke-width='1'/><path d='M0,96 L70,86 L120,98 L175,84 L225,96 L275,86 L325,98 L380,88 L430,100 L480,92 L480,118 L430,126 L380,118 L325,124 L275,116 L225,122 L175,114 L120,122 L70,116 L0,122Z' fill='rgb(212,96,30)' stroke='rgb(180,60,20)' stroke-width='1'/><path d='M0,132 L80,122 L140,134 L200,124 L260,136 L320,126 L380,134 L440,124 L480,132 L480,160 L0,160Z' fill='rgb(201,77,26)' stroke='rgb(160,50,15)' stroke-width='1'/></svg>")`
const BG5_SIZE = "480px 160px"

// 6 ─ HILL CRESTS ─ large sweeping mountain-crest arcs layered like rolling hills
const BG6_IMAGE = `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='480' height='200'><path d='M-40,160 Q120,40 240,100 Q360,160 520,60' fill='none' stroke='rgb(245,196,66)' stroke-width='2.2'/><path d='M-40,180 Q100,60 240,120 Q380,180 520,80' fill='none' stroke='rgb(240,152,48)' stroke-width='2'/><path d='M-40,200 Q80,80 240,140 Q400,200 520,100' fill='none' stroke='rgb(212,96,30)' stroke-width='1.8'/><path d='M-40,220 Q60,100 240,160 Q420,220 520,120' fill='none' stroke='rgb(201,77,26)' stroke-width='1.5'/><path d='M0,80 Q120,10 240,60 Q360,110 480,30' fill='none' stroke='rgb(224,112,34)' stroke-width='1.8'/><path d='M0,100 Q110,30 240,80 Q370,130 480,50' fill='none' stroke='rgb(212,96,30)' stroke-width='1.5'/></svg>")`
const BG6_SIZE = "480px 200px"

// 7 ─ WARM HALOS ─ CSS radial gradient edge blobs; no SVG tile needed
const BG7_IMAGE = [
  "radial-gradient(ellipse 38% 65% at 0% 25%, rgb(240,152,48) 0%, transparent 70%)",
  "radial-gradient(ellipse 38% 65% at 100% 25%, rgb(240,152,48) 0%, transparent 70%)",
  "radial-gradient(ellipse 28% 45% at 0% 65%, rgb(212,96,30) 0%, transparent 65%)",
  "radial-gradient(ellipse 28% 45% at 100% 65%, rgb(212,96,30) 0%, transparent 65%)",
  "radial-gradient(ellipse 20% 30% at 2% 10%, rgb(245,196,66) 0%, transparent 60%)",
  "radial-gradient(ellipse 20% 30% at 98% 10%, rgb(245,196,66) 0%, transparent 60%)",
].join(", ")
const BG7_SIZE = "100% 100%"

// 8 ─ BRUSHSTROKE OVALS ─ large diagonal brush-mark ellipses (360×200 tile)
const BG8_IMAGE = `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='360' height='200'><ellipse cx='80' cy='55' rx='155' ry='26' transform='rotate(-20 80 55)' fill='rgb(245,196,66)' stroke='rgb(212,96,30)' stroke-width='1.3'/><ellipse cx='280' cy='145' rx='155' ry='26' transform='rotate(-20 280 145)' fill='rgb(245,196,66)' stroke='rgb(212,96,30)' stroke-width='1.3'/><ellipse cx='180' cy='100' rx='175' ry='20' transform='rotate(14 180 100)' fill='rgb(240,152,48)' stroke='rgb(201,77,26)' stroke-width='1.2'/><ellipse cx='30' cy='155' rx='130' ry='18' transform='rotate(-25 30 155)' fill='rgb(212,96,30)' stroke='rgb(180,60,20)' stroke-width='1.1'/><ellipse cx='330' cy='45' rx='130' ry='18' transform='rotate(-25 330 45)' fill='rgb(212,96,30)' stroke='rgb(180,60,20)' stroke-width='1.1'/></svg>")`
const BG8_SIZE = "360px 200px"

// 9 ─ TERRA DIAMONDS ─ rotated rhombus / diamond grid, two-tone warm fill (120×60 tile)
// Each tile = one gold diamond + two half-terra triangles at left/right edges
const BG9_IMAGE = `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='60'><path d='M0,0 L60,30 L0,60Z' fill='rgb(212,96,30)' stroke='rgb(160,50,15)' stroke-width='1.2'/><path d='M120,0 L60,30 L120,60Z' fill='rgb(212,96,30)' stroke='rgb(160,50,15)' stroke-width='1.2'/><path d='M60,0 L120,30 L60,60 L0,30Z' fill='rgb(245,196,66)' stroke='rgb(201,77,26)' stroke-width='1.2'/></svg>")`
const BG9_SIZE = "120px 60px"

// 10 ─ EMBER RINGS ─ concentric circle rings, bullseye on a warm palette (200×200 tile)
const BG10_IMAGE = `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><circle cx='100' cy='100' r='22' fill='none' stroke='rgb(245,196,66)' stroke-width='1.8'/><circle cx='100' cy='100' r='44' fill='none' stroke='rgb(240,152,48)' stroke-width='1.6'/><circle cx='100' cy='100' r='66' fill='none' stroke='rgb(212,96,30)' stroke-width='1.4'/><circle cx='100' cy='100' r='88' fill='none' stroke='rgb(201,77,26)' stroke-width='1.3'/><circle cx='100' cy='100' r='100' fill='none' stroke='rgb(180,60,20)' stroke-width='1.2'/></svg>")`
const BG10_SIZE = "200px 200px"

// ─────────────────────────────────────────────────────────────────────────────
// Variant registry
// ─────────────────────────────────────────────────────────────────────────────

interface BgConfig {
  label: string
  hint: string
  swatch: string
  image: string
  size: string
  position: string
  repeat: string
}

const CONFIGS: Record<BgId, BgConfig> = {
  1: { label: "Amber Topo",      hint: "topo contour rings",    swatch: "#e07022", image: BG1_IMAGE,  size: BG1_SIZE,  position: "0 0",      repeat: "repeat" },
  2: { label: "Gilded Scales",   hint: "fish-scale arcs",       swatch: "#f5c442", image: BG2_IMAGE,  size: BG2_SIZE,  position: "0 0",      repeat: "repeat" },
  3: { label: "Puzzle Dusk",     hint: "interlocking pieces",   swatch: "#d4601e", image: BG3_IMAGE,  size: BG3_SIZE,  position: BG3_POS,    repeat: "repeat" },
  4: { label: "Desert Waves",    hint: "sinuous wave bands",    swatch: "#f09830", image: BG4_IMAGE,  size: BG4_SIZE,  position: "0 0",      repeat: "repeat" },
  5: { label: "Canyon Strata",   hint: "jagged rock layers",    swatch: "#c94d1a", image: BG5_IMAGE,  size: BG5_SIZE,  position: "0 0",      repeat: "repeat" },
  6: { label: "Hill Crests",     hint: "rolling horizon lines", swatch: "#e8901c", image: BG6_IMAGE,  size: BG6_SIZE,  position: "0 0",      repeat: "repeat" },
  7: { label: "Warm Halos",      hint: "radial edge glows",     swatch: "#f5a830", image: BG7_IMAGE,  size: BG7_SIZE,  position: "0 0",      repeat: "no-repeat" },
  8: { label: "Brushstrokes",    hint: "diagonal oval sweeps",  swatch: "#f7c030", image: BG8_IMAGE,  size: BG8_SIZE,  position: "0 0",      repeat: "repeat" },
  9: { label: "Terra Diamonds",  hint: "rhombus grid",          swatch: "#d4601e", image: BG9_IMAGE,  size: BG9_SIZE,  position: "0 0",      repeat: "repeat" },
 10: { label: "Ember Rings",     hint: "concentric circles",    swatch: "#e07022", image: BG10_IMAGE, size: BG10_SIZE, position: "0 0",      repeat: "repeat" },
}

// ─────────────────────────────────────────────────────────────────────────────
// Mask system (unchanged from hex version)
// ─────────────────────────────────────────────────────────────────────────────

const OUTER_MASK = "linear-gradient(to bottom, black 0%, black 65%, transparent 100%)"
const INNER_MASK = "linear-gradient(to right, black 0%, transparent 9%, transparent 91%, black 100%)"

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function HomeBgPicker() {
  const [selected, setSelected] = useState<BgId>(1)
  const [open, setOpen] = useState(false)

  useEffect(() => { setSelected(readId()) }, [])

  const select = (id: BgId) => {
    setSelected(id)
    try { localStorage.setItem(STORAGE_KEY, String(id)) } catch { /* ignore */ }
  }

  const cfg = CONFIGS[selected]

  return (
    <>
      {/* ── Background layer ───────────────────────────────────────────── */}
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
                backgroundImage: cfg.image,
                backgroundSize: cfg.size,
                backgroundPosition: cfg.position,
                backgroundRepeat: cfg.repeat,
                opacity: 0.20,
              }}
            />
          </div>
        </div>
      </div>

      {/* White-to-gray transition below hex zone */}
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

      {/* ── Debug picker ───────────────────────────────────────────────── */}
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
            <p style={{ margin: "0 0 10px", fontSize: 9, letterSpacing: "0.10em", textTransform: "uppercase", color: "rgba(255,255,255,0.40)", fontWeight: 700 }}>
              Background Style
            </p>
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap", maxWidth: 270 }}>
              {(Object.keys(CONFIGS) as unknown as BgId[]).map((id) => (
                <button
                  key={id}
                  onClick={() => select(id)}
                  title={`${CONFIGS[id].label} — ${CONFIGS[id].hint}`}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 10,
                    cursor: "pointer",
                    background: CONFIGS[id].swatch,
                    border: selected === id ? "2.5px solid #fff" : "2px solid rgba(255,255,255,0.18)",
                    boxShadow: selected === id ? "0 0 0 2.5px rgba(75,159,255,0.65)" : "none",
                    display: "flex",
                    alignItems: "flex-end",
                    justifyContent: "flex-end",
                    padding: "0 4px 3px 0",
                    transition: "border 0.12s, box-shadow 0.12s",
                    fontSize: 9,
                    color: "rgba(255,255,255,0.70)",
                    fontWeight: 800,
                    lineHeight: 1,
                  }}
                >
                  {id}
                </button>
              ))}
            </div>
            <div style={{ marginTop: 10, paddingTop: 9, borderTop: "1px solid rgba(255,255,255,0.09)", display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>{cfg.label}</span>
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.42)" }}>{cfg.hint}</span>
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
          <span>BG {selected} · {cfg.label}</span>
        </button>
      </div>
    </>
  )
}
