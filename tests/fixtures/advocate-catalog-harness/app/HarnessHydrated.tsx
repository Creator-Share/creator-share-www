"use client"

import { useEffect } from "react"

/**
 * Marks the document once React has hydrated.
 *
 * The harness page itself is a server component, so this stays a separate
 * client-only marker rather than converting the page and changing what is
 * under test. Tests must wait for this before typing: a value filled into a
 * controlled input before hydration is discarded when React takes over, which
 * leaves dependent controls such as Save permanently disabled. A fast machine
 * hydrates first and hides the race; a loaded CI runner does not.
 */
export function HarnessHydrated() {
  useEffect(() => {
    document.documentElement.dataset.harnessHydrated = "true"
    return () => {
      delete document.documentElement.dataset.harnessHydrated
    }
  }, [])

  return null
}
