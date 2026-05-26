# Risk Analysis: Replace Supabase Image Transforms with Next.js `<Image>`

> Reviewed against codebase (2026-05-26) and [nextjs-image-transformation.md](./nextjs-image-transformation.md) plan, cross-referenced with [docs-findings.md](./docs-findings.md).

---

## 1. Rollback Complexity: LOW

**Verdict:** Reverting is straightforward, but only after a full deploy rollback.

**Evidence:**
- All image URLs are constructed at render time (client or server), not persisted in the database. There is no column in `media` storing a transformed URL. The single exception is the `public_url` field returned in the **API response** from `POST /api/admin/beneficiaries/images/create` — but even that is consumed immediately by the upload handler and not stored long-term.
- The `NEXT_PUBLIC_ENABLE_IMAGE_TRANSFORMS` flag is still fully functional in the current code. If the migration causes issues, you can re-enable the Supabase transform branch without reverting the entire codebase — just toggle the env var and delete the new `/_next/image` thumbnail code.
- The API route (`images/create/route.ts`) returns a `public_url` in its JSON response. If this changes from Supabase-transform URL to direct URL, the upload handler on the admin page receives a different-shaped URL. Old stored responses won't break because nothing reads them after upload completes.
- **Cached `/_next/image` URLs** from the new approach will 404 if you roll back to old code (since the `/_next/image` route won't recognize the old code's behavior). This is a transient visual issue — on rollback, all components re-render and regenerate Supabase URLs on the client, so the 404s are replaced within one render cycle. **Acceptable.**

**Action:** If deploying, ship as a single atomic deploy, not as incremental changes. The old code path is cleanly separable by the feature flag, so a canary deploy of just the new code behind the flag would be safest.

---

## 2. Migration Sequencing: SHOULD BE TWO-PHASE

**Verdict:** Do **not** go all-at-once. A canary-first sequence is easy and risk-free.

**Recommended sequence:**

```
Phase 1 — Add Next.js config (no behavior change)
├── Add `pathname: '/storage/v1/object/public/**'` to existing `*.supabase.co` remotePattern
│   (currently the hostname wildcard is sufficient, but explicit pathname removes ambiguity)
├── Deploy
└── Verify: existing images still load. No regression.

Phase 2 — Deploy the migration (flag-gated)
├── In `media.ts`: new `buildStorageUrl` always returns direct URL
├── In `imageTransform.ts`: `getTransformedImageUrl` returns direct URL
├── In `generateThumbnailUrl`: new `/_next/image?w=...` construction
├── Keep `NEXT_PUBLIC_ENABLE_IMAGE_TRANSFORMS=true` in production initially — but now it's a no-op
├── Deploy and verify on dev (where flag was always false — same behavior)
└── After 24h of monitoring: remove the flag from code and dotenv.sample
```

**Why this matters:** The flag path already works in dev (where transforms are disabled). Deploying Phase 2 with the flag still set in production means zero behavior change on day 1. You can then toggle the flag to `false` on a single staging instance to verify the new path works end-to-end before removing the flag entirely.

---

## 3. Thumbnail URL Construction (`/_next/image?url=...&w=20&q=20`): MEDIUM-HIGH RISK

**This is the most dangerous assumption in the plan.** Let's unwind it.

### Claim being made

The plan says `generateThumbnailUrl` should return a URL like:

```
/_next/image?url=https%3A%2F%2F<project>.supabase.co%2Fstorage%2Fv1%2Fobject%2Fpublic%2Fmedia%2F...&w=20&q=20
```

and ProgressiveImage will render it as an `<Image>` with `unoptimized={true}` (because the URL starts with `/`).

### Why this works in theory

1. `/_next/image` is a valid API endpoint in Next.js (both dev and production on Vercel).
2. It fetches the source URL, optimizes it to the requested width, and serves it back.
3. `w=20` gets rounded to the closest configured `imageSizes` value — `16` — which Next.js will serve.
4. Because `isThumbnailLocal` checks `thumbnailSrc?.startsWith('/')`, it returns `true`, so `unoptimized=true`, preventing the `<Image>` component from double-optimizing the already-optimized URL.

### Why this is risky

**Risk A — `imageSizes` rounding makes 20px → 16px, not 20px.** The default `imageSizes` array is `[16, 32, 48, 64, 96, 128, 256, 384]`. A requested width of 20 rounds to 16. The blur-up technique still works at 16px (it's small enough), but the actual request is for a different width than the code expresses. **Currently acceptable for blur-up but worth documenting.**

**Risk B — The unoptimized logic is fragile.** ProgressiveImage's `unoptimized={isThumbnailLocal}` check only works because `/_next/image?...` starts with `/`. If the URL format ever changes (e.g., absolute URL with the deployment domain), the guard breaks and the `<Image>` component would try to re-optimize `/_next/image?url=/_next/image?...` — a double-nested URL that would almost certainly fail or behave unexpectedly. **This is not defensive code.**

**Risk C — The thumbnail URL is constructed client-side but the `/_next/image` endpoint is server-side.** There is no client-side validation that the constructed URL is valid. If the source URL encoding has edge cases (unicode characters, special chars in the path), the `/_next/image` endpoint may reject the request with a 400. Supabase handles encoding internally; manual construction is error-prone.

**Risk D — Vercel Image Optimization quota applies.** Even though the thumbnail is 16px at quality 20, each unique source image still counts against the Vercel plan's source image quota. The thumbnail and the full image are the same source URL being optimized to different sizes, so they count as two source images. **This is within expected behavior but should be budgeted.**

### Safer alternative

Instead of constructing `/_next/image` URLs manually, use Next.js's built-in `placeholder="blur"` + `blurDataURL` mechanism:

```tsx
// Generate a tiny base64 blur hash server-side (or at build time)
// Plaiceholder is the recommended tool: https://plaiceholder.co
import { getPlaiceholder } from "plaiceholder"

const { base64 } = await getPlaiceholder(imageUrl)
// Store base64 in the media table column, or compute at request time
```

This is the standard Next.js approach and avoids all the hand-rolled URL construction risks. It does require either:
- Computing blur hashes at image upload time (store in DB)
- Computing them at request time (server-side, cached)
- Using an edge function

**Recommendation:** Either use `placeholder="blur"` + `blurDataURL` (Server Components), or keep the current ProgressiveImage approach (client component) but construct the `/_next/image` URLs **server-side** in `generateThumbnailUrl` where encoding is handled more safely. Accept the 20→16px rounding but document it.

---

## 4. Cache Invalidation: LOW RISK

**Verdict:** No conflict between old and new URLs. Separate URL spaces.

**Evidence:**
- Old URLs: `https://<project>.supabase.co/storage/v1/render/image/public/...?width=40&height=40&quality=20`
- New URLs: `/_next/image?url=<encoded-supabase-url>&w=16&q=20`

These are completely different origins and paths. No cache key collision possible.

**Subtle cache consideration:** The Vercel CDN caches optimized images with a `minimumCacheTTL` (default 3600s). If an image changes on Supabase (same key, new content), the `/_next/image` cache will serve the old version for up to the TTL. This is **the same behavior as today** with Supabase's Smart CDN caching transformed images. No regression.

**Action:** Consider increasing `images.minimumCacheTTL` in `next.config.ts` to match the expected update frequency of beneficiary photos (e.g., 1 day = 86400) to reduce optimization costs on Vercel.

---

## 5. The `blurDataURL` / SVG Placeholder Approach: ACCEPTABLE but COSTLY

**Verdict:** Skipping `blurDataURL` and using the SVG placeholder is acceptable but degrades UX. The current ProgressiveImage approach (LQIP via tiny thumbnail + CSS blur) is already a solid middle ground.

### How production apps handle this

| Approach | Examples | Cost |
|----------|----------|------|
| `placeholder="blur"` with `blurDataURL` | Next.js docs, Vercel templates | Requires server-side blur hash generation |
| LQIP (low-quality image placeholder) — tiny thumbnail + CSS blur | Medium, Pinterest, Airbnb | Two HTTP requests per image (cheap) |
| Dominant color placeholder | Facebook, Google Images | Single color extraction, no HTTP overhead |
| Generic SVG/icon placeholder | Default fallbacks, loading spinners | Simplest, worst UX |

The current approach is standard **LQIP** — already used in production at scale. The plan proposes keeping this exact approach but swapping the thumbnail source from Supabase transform → `/_next/image`. This is perfectly acceptable.

**The SVG placeholder exists as the fallback** (when thumbnail fails or is unavailable). It's not a replacement for the LQIP — it's the safety net. The plan correctly avoids touching `ProgressiveImage.tsx` and keeps the SVG fallback in place.

**One concern:** The SVG placeholder (`/placeholder-person.svg`) is a generic silhouette. All beneficiary cards show the same shape before the image loads. This is already the current behavior. No regression.

---

## 6. Broken Image Detection (502/503 from Supabase): LOW-MEDIUM RISK

**Verdict:** Graceful degradation exists, but the double-load pattern in `ProgressiveImage` adds complexity.

### What happens on failure

| Failure scenario | Current behavior | Post-migration behavior | Outcome |
|---|---|---|---|
| Supabase storage returns 502 | Image fails → fallback shows | Same | OK — fallback SVG shows |
| Supabase storage is slow (>10s) | Image takes long to load | Same — plus `/_next/image` adds an extra hop | Worse latency for first uncached image |
| Supabase is reachable but `/_next/image` fails | N/A | The `/_next/image` URL would return a 400/500. The `<Image>` for the thumbnail triggers `handleThumbnailError`, which sets `thumbnailError = true`, and `shouldShowImageImmediately = true`. The full image `<Image>` also tries to load via `/_next/image` URL (not manually constructed — the component constructs it) | Degraded but functional — no blur-up, but full image loads when available |
| Supabase is down entirely | Both thumbnail and full image fail → fallback SVG | Same | OK |

**Critical edge case — `/_next/image` upstream fetch failure:** If the source (Supabase) is reachable but the Vercel edge optimization crashes or times out for a specific image, the `/_next/image` URL returns a 500. The `<Image>` component fires `onError`, which sets `imageError = true`, and the fallback SVG placeholder shows. **This is acceptable** — the same behavior as a Supabase transform failure today.

### Existing issue (not introduced by this plan)

The `useEffect` in ProgressiveImage creates a **native `window.Image`** and sets `img.src = src`. This loads the raw Supabase URL directly (bypassing `/_next/image`). Meanwhile, the `<Image>` component renders with `src={displaySrc}` and goes through `/_next/image`. These are **two separate HTTP requests** for the same image. If one succeeds and the other fails before the handlers are nullified, the component state could briefly be inconsistent (one handler sets `imageLoaded`, the other sets `imageError`). The net result is transient — both handlers are idempotent — but it's wasted bandwidth.

**Not blocking this migration.** The double-load pre-exists and is minor.

---

## 7. Race Conditions in ProgressiveImage: LOW RISK (pre-existing)

**Verdict:** No new race conditions are introduced by this migration. Existing races are benign.

### Existing races (all benign)

**Race A — src change during load:**
When the carousel changes images, the `useEffect` cleanup nullifies `img.onload` and `img.onerror`. A new effect runs with the new `src`. Between cleanup and the new effect, the old image might finish loading — but the handlers are already null, so nothing fires. This is correct.

**Race B — useEffect handler vs Component onLoad handler:**
The `useEffect` creates a native `window.Image` with anonymous handlers, and the `<Image>` component has `onLoad={handleImageLoad}` / `onError={handleImageError}`. Both `setImageLoaded(true)` calls are harmless duplicates. This is fine.

**Race C — Thumbnail loads after full image:**
When `thumbnailSrc` is present, the full image `<Image>` has `opacity: 0` until `imageLoaded`. If the full image loads before the thumbnail, it stays invisible until the thumbnail also loads (since `handleThumbnailLoad` doesn't gate the full image visibility — only `handleImageLoad` does). Actually wait — the full image visibility is only gated by `imageLoaded`, not by `thumbnailLoaded`. So the full image would fade in once it loads, regardless of thumbnail state. The thumbnail continues to show (but fades out via opacity transition). This is fine.

### New concern (post-migration)

**If thumbnail `/_next/image` URL construction fails** (bad encoding, unsupported format), the thumbnail receives a 400 from the `/_next/image` endpoint. The thumbnail `<Image>` fires `onError`, which calls `handleThumbnailError`. This sets `thumbnailError = true`, which makes `hasThumbnail = false`, which makes `shouldShowImageImmediately = true`. The full image then shows immediately (no blur-up). The user sees a flash from SVG placeholder to full image. **Acceptable degradation.**

---

## 8. Missed Supabase Image Endpoint References: NO NEW FINDINGS

**Verdict:** The `grep` for `render/image` returned zero matches in `src/`. All current transform URLs are generated through the Supabase JS SDK (`getPublicUrl` with `transform` option), not by manually constructing `render/image` URLs.

### All touchpoints of the transform code

| File | Current approach | What changes |
|---|---|---|
| `src/utils/supabase/media.ts` | `buildStorageUrl` uses SDK transform branch | Remove transform branch entirely, always return direct URL |
| `src/utils/supabase/imageTransform.ts` | `getTransformedImageUrl` uses SDK transform branch | Remove transform logic, return direct URL |
| `src/app/api/admin/beneficiaries/images/create/route.ts` | Calls `getTransformedImageUrl` for response `public_url` | After change, same function returns direct URL → response changes shape |
| `src/utils/email.ts` | Calls `generatePublicUrl` (which uses transform) | After change, email gets full-resolution original instead of 800x800 WebP |

**Email risk (minor but real):** The email template uses `<img>` tags (not Next.js `<Image>`), so it never used `/_next/image`. After migration, `generatePublicUrl` returns the full-resolution original image instead of a transformed 800x800 WebP version. Email clients download the full file, which could be:
- Slower to load in the email
- Rejected by some email clients with file size limits (Gmail: ~25MB, Outlook: ~10MB)

**Recommendation:** In the email utility, either:
1. Continue to use a resize query (e.g., `buildStorageUrl(key, { width: 800 })` but always use the direct URL path — this is no longer a Supabase Pro feature, it's just... wait, no, direct URLs don't support query params for resizing.
2. Upload a properly sized version for email use.
3. Accept that email images will load at full resolution (most beneficiary photos are <500KB JPEGs — acceptable).

**This is a real but minor migration gap the plan didn't mention.**

### Dead code check

| Function | Used elsewhere? | Safe to remove? |
|---|---|---|
| `getImageVariants` | Not imported anywhere in `src/` | ✅ Yes |
| `getSignedTransformedUrl` | Not imported anywhere in `src/` | ✅ Yes |
| `uploadImageForTransformation` | Only called within `imageTransform.ts` itself (`uploadImagesForTransformation`) | ✅ Yes (if both removed) |
| `uploadImagesForTransformation` | Not imported anywhere in `src/` | ✅ Yes |
| `deleteTransformedImages` | Not imported anywhere in `src/` | ✅ Yes |

---

## Summary of Blockers

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| 1 | Manual `/_next/image` URL construction with unvalidated encoding | **High** | Use URL constructor (`new URL()`) or server-side encoding. Verify Supabase object key encoding edge cases. |
| 2 | Email gets full-res images instead of 800x800 WebP | **Medium** | Evaluate email image sizes. Add explicit sizing if needed. |
| 3 | Thumbnail width 20 → rounds to 16px | **Low** | Document the rounding. Accept for blur-up. Or add `16` explicitly in the thumbnail URL. |
| 4 | Vercel Image Optimization quota from thumbnail + full image | **Low** | Ensure budget accounts for ~2x source images (1 thumbnail + 1 full). Use `minimumCacheTTL` to reduce re-optimizations. |
| 5 | `isThumbnailLocal` / `unoptimized` guard is fragile | **Medium** | Add an explicit `unoptimized={true}` prop to the thumbnail `<Image>` in ProgressiveImage instead of relying on the `startsWith('/')` heuristic. This is defensive regardless of migration. |
| 6 | `public_url` in upload API response changes format | **Low** | Confirm the admin upload handler doesn't persist or rely on the URL format. It uses it for immediate display only. |

## Friday-Deployment Checklist

- [ ] `remotePatterns` in `next.config.ts` — confirm `*.supabase.co` covers `/storage/v1/object/public/**` (it does with the wildcard, but add explicit pathname for clarity)
- [ ] Test that `/_next/image` actually serves a 20px-requested image (verify it rounds to 16px, and that 16px is acceptable for blur-up)
- [ ] Test one email after migration to verify image loads in Gmail/Outlook within acceptable size limits
- [ ] Set `NEXT_PUBLIC_ENABLE_IMAGE_TRANSFORMS=false` in dev and staging before production — simulate the full migration path
- [ ] Verify the admin image upload flow returns usable `public_url` values
- [ ] Verify dotenv.sample is updated (remove deprecated flag)
- [ ] Add `16` to the thumbnail URL explicitly (`w=16`) since that's what it rounds to anyway — be honest about what's being requested
- [ ] Verify thumbnail `<Image>` doesn't double-optimize: check the actual rendered HTML in dev tools
