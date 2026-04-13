import { create } from "zustand"
import { GlassVariantId, DEFAULT_VARIANT_ID } from "@/config/glassStyles"

const STORAGE_KEY = "cs_glass_variant"

function readFromStorage(): GlassVariantId {
  if (typeof window === "undefined") return DEFAULT_VARIANT_ID
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? (parseInt(raw, 10) as GlassVariantId) : null
    if (parsed && parsed >= 1 && parsed <= 5) return parsed
  } catch {
    // ignore
  }
  return DEFAULT_VARIANT_ID
}

interface GlassStyleState {
  variantId: GlassVariantId
  setVariant: (id: GlassVariantId) => void
}

export const useGlassStyleStore = create<GlassStyleState>((set) => ({
  variantId: DEFAULT_VARIANT_ID,
  setVariant: (id) => {
    try {
      localStorage.setItem(STORAGE_KEY, String(id))
    } catch {
      // ignore
    }
    set({ variantId: id })
  },
}))

/** Call once on the client to hydrate from localStorage. */
export function hydrateGlassStyle() {
  useGlassStyleStore.setState({ variantId: readFromStorage() })
}
