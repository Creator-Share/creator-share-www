"use client"
import React, { useEffect, useState } from "react"
import { GLASS_VARIANTS, GlassVariantId } from "@/config/glassStyles"
import { useGlassStyleStore, hydrateGlassStyle } from "@/store/glassStyleStore"

export function GlassStylePicker() {
  const [open, setOpen] = useState(false)
  const { variantId, setVariant } = useGlassStyleStore()

  // Hydrate from localStorage on first client render.
  useEffect(() => {
    hydrateGlassStyle()
  }, [])

  return (
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
            background: "rgba(15,15,20,0.88)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 14,
            padding: "12px 14px",
            color: "#fff",
            boxShadow: "0 8px 32px rgba(0,0,0,0.40)",
            minWidth: 200,
          }}
        >
          <p
            style={{
              margin: "0 0 10px",
              fontSize: 10,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.45)",
              fontWeight: 600,
            }}
          >
            Glass Style
          </p>

          {GLASS_VARIANTS.map((v) => {
            const active = variantId === v.id
            return (
              <label
                key={v.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "5px 0",
                  cursor: "pointer",
                  opacity: active ? 1 : 0.65,
                  transition: "opacity 0.15s",
                }}
              >
                <input
                  type="radio"
                  name="glass-variant"
                  value={v.id}
                  checked={active}
                  onChange={() => setVariant(v.id as GlassVariantId)}
                  style={{ accentColor: "#4b9fff", width: 14, height: 14, cursor: "pointer" }}
                />

                {/* Mini swatch */}
                <span
                  style={{
                    display: "inline-block",
                    width: 22,
                    height: 22,
                    borderRadius: 6,
                    flexShrink: 0,
                    background: `linear-gradient(to bottom, ${v.swatchTop}, ${v.swatchBottom})`,
                    border: "1.5px solid rgba(255,255,255,0.25)",
                    boxShadow: active ? "0 0 0 2px rgba(75,159,255,0.70)" : "none",
                  }}
                />

                <span>
                  <strong style={{ fontWeight: 600, fontSize: 12 }}>{v.name}</strong>
                  <br />
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.45)" }}>{v.description}</span>
                </span>
              </label>
            )
          })}
        </div>
      )}

      <button
        onClick={() => setOpen((o) => !o)}
        title="Glass style picker"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "7px 13px",
          background: open ? "rgba(75,159,255,0.90)" : "rgba(15,15,20,0.80)",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          border: "1px solid rgba(255,255,255,0.18)",
          borderRadius: 20,
          color: "#fff",
          cursor: "pointer",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.04em",
          boxShadow: "0 4px 16px rgba(0,0,0,0.30)",
          transition: "background 0.2s",
          lineHeight: 1,
        }}
      >
        <span style={{ fontSize: 14 }}>✦</span>
        <span>Glass {variantId}</span>
      </button>
    </div>
  )
}
