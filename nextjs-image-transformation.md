# Proposal: Replace Supabase Image Transformations with Next.js Image Optimization

**Status:** Tentative (updated with review findings)
**Reviewed by:** 3 subagent reviews + official docs exploration
**Date:** 2026-05-26
**Reference docs:** `docs-findings.md` (raw documentation compilation)

---

## Problem

Supabase Image Transformation (the `/render/image/` endpoint) is a Pro-plan-only feature. The free development Supabase project cannot serve transformed images, causing inconsistent behavior:

- **Development (free plan):** Direct storage URLs via `/storage/v1/object/public/` — images display at original resolution
- **Production (paid plan):** Transformed URLs via `/render/image/` — WebP, resized, quality-optimized

Current workaround (just implemented): a `NEXT_PUBLIC_ENABLE_IMAGE_TRANSFORMS` feature flag that conditionally enables transforms. On dev, thumbnails are disabled entirely.

### Additionally: we are currently double-optimizing

Every image today goes through **both** Supabase transforms **and** Next.js `/_next/image`:

```
Supabase original → Supabase /render/image (transform #1) → Vercel /_next/image (transform #2) → browser
```

This is wasteful — two optimization passes for the same image, burning both Supabase origin-image quota and Vercel source-image quota unnecessarily.

---

## Proposal

Eliminate Supabase Image Transformation entirely. Serve all images as direct `/storage/v1/object/public/` URLs, and rely solely on Next.js `<Image>`'s built-in optimization (`/_next/image`) for resizing, format conversion (WebP), and quality control.

The new pipeline:

```
Supabase original → Vercel /_next/image (single transform) → browser
```

## How It Would Work

| Concern | Current (Supabase transform) | Proposed (Next.js only) |
|---------|------------------------------|------------------------|
| Resizing | Supabase `/render/image/` endpoint | Next.js `/_next/image` edge CDN |
| Format (WebP) | Supabase auto-converts | Next.js auto-converts (browser negotiation, also supports AVIF) |
| Quality | Supabase param | Next.js `?q=` param (both default to 75) |
| Thumbnail (blur-up) | 40x40 Supabase-transformed + CSS blur | `/_next/image?w=16&q=20` + CSS blur |
| Cost | None — Supabase Pro kept for DB, transforms are a bundled perk | Vercel quota unchanged (already burning it today) |
| Dev/prod parity | Different behavior per env | Identical everywhere |

## Changes Required

### 1. `src/utils/supabase/media.ts`

- **`buildStorageUrl`**: Remove the Supabase-transform branch entirely. Always construct the direct `/storage/v1/object/public/` URL.
- **`generatePublicUrl`**: Unchanged signature, always returns direct URL. Remove `NEXT_PUBLIC_ENABLE_IMAGE_TRANSFORMS` check.
- **`generateThumbnailUrl`**: Return an `/_next/image?w=16&q=20&url=<encoded-direct-url>` URL using the server-side URL constructor for safe encoding. Include the `unoptimized` caveat documentation.

### 2. `src/utils/supabase/imageTransform.ts`

- **`getTransformedImageUrl`**: Strip transform logic, return direct URL always. **Note: still actively called** from `src/app/api/admin/beneficiaries/images/create/route.ts` for the API response `public_url` field. After change, the response will contain a direct URL instead of a Supabase-transform URL. The admin upload handler consumes this for immediate display only — no stored dependency — so it's safe.
- **`getImageVariants`**: Remove (all variants point to the same URL — no value). Zero callers in the codebase.
- **`getSignedTransformedUrl`**: Remove (private bucket transform — not used). Zero callers.
- **`uploadImageForTransformation`**, **`uploadImagesForTransformation`**, **`deleteTransformedImages`**: These are storage operations unrelated to transforms. Evaluate whether they have value as standalone upload helpers; if not, remove them too.

### 3. Feature flag

- Remove `NEXT_PUBLIC_ENABLE_IMAGE_TRANSFORMS` from code and `dotenv.sample`. No longer needed.

### 4. `next.config.ts`

- No `remotePatterns` change needed — the existing `hostname: "*.supabase.co"` glob already covers `/storage/v1/object/public/**`.
- **Add `images.minimumCacheTTL`** to extend cache lifetime and reduce Vercel source-image quota burn:
  ```ts
  images: {
    minimumCacheTTL: 604800, // 7 days for static beneficiary photos
    // ... existing remotePatterns
  }
  ```
- Explicitly document which `imageSizes` will be used for thumbnails (add a comment).

### 5. `ProgressiveImage.tsx`

- No structural changes needed. Already handles missing thumbnails gracefully.
- **Defensive fix (recommended):** Replace the `unoptimized={isThumbnailLocal}` heuristic with an explicit `unoptimized={true}` prop on the thumbnail `<Image>`. The existing heuristic works only because `/_next/image` URLs start with `/`, but this is fragile.

### 6. Email exception — keep Supabase transforms for email only

Email clients render raw `<img>` tags with no Next.js `/_next/image` wrapper. Without Supabase transforms, emails would embed full-resolution originals (potentially 500KB+ JPEGs instead of 50KB WebP).

**Approach:** Create a separate email-specific helper that uses the Supabase transform endpoint. The main rendering pipeline (`media.ts`, `imageTransform.ts`) drops Supabase transforms entirely.

```typescript
// src/utils/supabase/email-images.ts
import { createClient } from "@/utils/supabase/client"
import { STORAGE_BUCKET } from "@/utils/supabase/buckets"
import { getStorageKey, type MediaRow } from "@/utils/supabase/media"

export function getEmailImageUrl(media: MediaRow): string {
  const key = getStorageKey(media)
  const { data } = createClient().storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(key, {
      transform: { width: 800, height: 800, quality: 85, resize: "cover" },
    })
  return data.publicUrl
}
```

This is a net-zero complexity change — we replace one function call in `email.ts` with another, and the Supabase transform logic lives in exactly one file with a clearly scoped purpose.

## Cost Impact

**No direct cost savings from this change.** The Supabase Pro plan ($25/mo) is kept for database hosting — image transforms are a bundled perk that comes with it, not the reason for the plan. Vercel Pro ($20/mo) is also already in place. Both continue as-is.

What we do gain:

1. **Eliminate double-optimization waste.** Every image today passes through Supabase transforms **and then** Next.js `/_next/image` — two separate optimizations for the same image. This burns Vercel source-image quota unnecessarily. After the change, each image counts as ~2 source images for a *different reason* (thumbnail + main display), but the total quota burn is the same or slightly lower since we remove the Supabase transform overhead.

2. **Dev/prod parity.** No more conditional code paths, no more feature flag, no more broken thumbnails on dev.

3. **Simpler code.** Remove the feature flag, remove unused exports (`getImageVariants`, `getSignedTransformedUrl`, etc.), remove the Supabase transform branch from `buildStorageUrl`.

**Vercel source-image quota per original:** The thumbnail (`/_next/image?w=16&q=20`) and main image (`/_next/image?w=...&q=75`) use the same source URL with different widths. Vercel counts each unique (source URL + dimensions) pair as one source image. Each beneficiary photo burns **~2 source-image quota per cache-miss lifecycle** (one for thumbnail, one for main display). This is the same as today's behavior, just structured differently.

**Cold-cache latency:** The proposed approach fetches larger originals from Supabase (untransformed JPEG/PNG ~100-500KB vs ~30-60KB WebP). This adds ~50-100ms on the **first uncached request** per image while Vercel downloads and processes the original. After Vercel edge caches, latency is identical. Imperceptible at this traffic level.

## Deployment Sequence (Recommended)

**Phase 1 — Config hardening (no behavior change):**
- Add explicit `pathname: '/storage/v1/object/public/**'` to the Supabase `remotePatterns` entry in `next.config.ts`
- Set `minimumCacheTTL: 604800`
- Deploy and verify no regression

**Phase 2 — Migration (flag-gated):**
- Deploy the code changes behind the existing `NEXT_PUBLIC_ENABLE_IMAGE_TRANSFORMS` check — production still has the flag `true`, so behavior doesn't change
- Set the flag to `false` on staging/dev and verify end-to-end

**Phase 3 — Toggle & cleanup:**
- Toggle `NEXT_PUBLIC_ENABLE_IMAGE_TRANSFORMS=false` on production
- Monitor for 24-48 hours
- Remove the flag from code, `dotenv.sample`, and all env configs

## Edge Cases & Risks (from review)

### Corrected from original plan

| Issue | Original claim | Corrected fact |
|-------|---------------|----------------|
| Thumbnail width | `/_next/image?w=20` | `w=16` — rounds to nearest `imageSizes` entry (16, 32, 48...) |
| Cost | "Free (Vercel edge)" | Has source-image quotas (1,000/mo Hobby, 5,000/mo Pro) |
| `getTransformedImageUrl` removal | "Remove transform logic" | Function is active in admin upload route (still safe, just a different URL shape) |
| `next.config.ts` | "if any config is needed" | Needs `minimumCacheTTL` — potentially material cost impact |
| Dev mode | Not mentioned | `/_next/image` does NOT transform in `next dev` — thumbnails serve at full resolution. CSS blur still works, but wasteful. |

### Open risks

1. **Manual `/_next/image` URL construction** — Must use safe URL encoding server-side. Malformed paths could 400 from the optimization endpoint.
2. **`unoptimized` guard fragility** — ProgressiveImage's thumbnail `<Image>` relies on `startsWith('/')` to set `unoptimized={true}`. Works for now, but fragile.
3. **Email image sizes** — `src/utils/email.ts` gets full-res originals instead of 800x800 WebP. Likely fine but verify.
4. **Rollback cache** — Rolled-back code would see 404s on cached `/_next/image` URLs. Transient — clients re-render within one cycle.
5. **`next dev`** — Thumbnails load at full resolution (no `/render/image` *and* no `/_next/image` resize). CSS blur still applies.

### Confirmed safe (from review)

- `getSignedTransformedUrl` — zero callers in codebase ✅
- `getImageVariants` — zero callers in codebase ✅
- CORS — server-to-server fetch, not browser CORS concern ✅
- `remotePatterns` — existing `*.supabase.co` wildcard covers both old and new paths ✅
- ProgressiveImage race conditions — pre-existing, benign ✅

## Files to Modify
- `src/utils/supabase/media.ts`
- `src/utils/supabase/imageTransform.ts`
- `next.config.ts`
- `dotenv.sample`
- `src/components/common/ProgressiveImage.tsx` (optional: `unoptimized` hardening)

## Files to Remove
- `getImageVariants`, `getSignedTransformedUrl`, `deleteTransformedImages` from `imageTransform.ts`
- `uploadImageForTransformation`, `uploadImagesForTransformation` (if not used elsewhere)
