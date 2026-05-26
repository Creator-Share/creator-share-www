# Technical Feasibility Review: Replace Supabase Transforms with Next.js Image Optimization

**Plan:** `nextjs-image-transformation.md`
**Reference:** `docs-findings.md`
**Date:** 2026-05-26

---

## Findings

### 1. ✅ Can `/_next/image` URLs be constructed manually for a 20px thumbnail?

**Yes.** The `/_next/image` endpoint is a standalone HTTP API — it is *not* exclusive to the `<Image>` component. The docs confirm the URL format:

> `/_next/image?url=<encoded-source-url>&w=<width>&q=<quality>` — docs-findings.md:87

The two guards are:
1. The source URL's hostname must be in `remotePatterns` — ✅ already present (`*.supabase.co`)
2. The `w` parameter should match a configured size (it's rounded to nearest) — see Finding 2

**How it flows through ProgressiveImage:**
- `generateThumbnailUrl` returns `/_next/image?w=16&q=20&url=<encoded-direct-url>`
- This is a local path (starts with `/`) → `isThumbnailLocal` = `true` → `unoptimized` = `true` (ProgressiveImage.tsx:139)
- The `<Image>` renders `<img src="/_next/image?w=16&q=20&url=..." />` directly
- The browser fetches `/_next/image?w=16&q=20&url=...` from the Next.js server
- The server validates against `remotePatterns`, fetches from Supabase, resizes to 16px at quality 20, returns it

This works end-to-end. The `unoptimized={true}` on the `<Image>` component is correct here — it prevents the component from double-wrapping the already-optimized URL.

### 2. 🔴 BUG IN PLAN: `w=20` rounds down to `16`px — plan says `20`

The plan proposes `w=20&q=20` for the blur thumbnail. The docs state:

> The `<w>` parameter is one of the configured `deviceSizes` or `imageSizes` widths (rounded to nearest match). — docs-findings.md:88

The default `imageSizes` are `[16, 32, 48, 64, 96, 128, 256, 384]` (docs-findings.md:120). `20` rounds to `16` (nearest match), not `20`. The plan should use `w=16` for clarity and predictability.

**Impact:** Negligible in practice (it's a blur placeholder), but the plan makes an incorrect claim about the exact width. Fix: change `w=20` to `w=16` in the proposal.

### 3. ✅ `remotePatterns` works for direct Supabase storage URLs — no `search: ''` gotcha

The docs highlight a gotcha:

> If `search` is set to `''` (empty string), **no query parameters are allowed** on the source URL. Omit `search` or set it to `'?'` to allow any query params. — docs-findings.md:133

**The current config omits `search` entirely** (next.config.ts:39-50), so query parameters ARE allowed on source URLs. The direct storage URL `https://<project>.supabase.co/storage/v1/object/public/media/...` has no query params anyway, so even if `search: ''` were set, it would still match.

The existing `hostname: "*.supabase.co"` pattern (next.config.ts:49) matches `https://<project-id>.supabase.co/storage/v1/object/public/...` with no restrictions. ✅

### 4. ✅ Vercel dimension/image size limits are well within bounds

Docs reference:

> Source image max dimensions: 8192 × 8192 px — docs-findings.md:159
> Optimized image size limit: 10 MB — docs-findings.md:160

Beneficiary profile photos are typically < 5 MB and < 4000px on the longest side. No risk of hitting these limits for any images in the codebase.

### 5. ✅ `getSignedTransformedUrl` removal is safe — zero callers

**Codebase search:** The only matches for `getSignedTransformedUrl` are in `nextjs-image-transformation.md` (the plan) and the definition in `imageTransform.ts:166`. No file anywhere imports or calls this function. Zero callers. ✅ Safe to remove.

### 6. ✅ `getImageVariants` removal is safe — zero callers

**Codebase search:** The only matches are the plan and the definition in `imageTransform.ts:71`. Not imported elsewhere. ✅ Safe to remove.

### 7. ✅ CORS is a non-issue — server-to-server requests

The `/_next/image` endpoint fetches source images server-side (Next.js server → Supabase origin). This is a server-to-server request, not subject to browser CORS. Supabase public buckets accept all requests with no referrer restrictions.

> The docs confirm: "Direct Supabase URLs used as `/_next/image` source URLs must be fetchable by the Next.js server. Since the storage bucket is public and Supabase doesn't restrict fetching by referrer, this should work" — docs-findings.md:178-179

### 8. 🔴 `getTransformedImageUrl` IS used — plan missed this caller

The plan says to "Remove transform logic, return direct URL always" for `getTransformedImageUrl` but doesn't mention that it's **actively used** in the admin upload API route:

**`src/app/api/admin/beneficiaries/images/create/route.ts:82`**:
```ts
public_url: getTransformedImageUrl('media', `${beneficiaryId}/IMAGE/${mediaRow.id}.${extension}`, {
  width: 800,
  height: 800,
  quality: 90,
  resize: 'cover'
}),
```

After the change, this would return a direct object URL instead of a transformed URL. The endpoint returns the URL to the admin UI after upload. Functionally this works (the admin sees the untransformed image), but it's a behavioral change not called out in the plan. The plan should:
- Document this impact explicitly
- Consider whether the response should instead use `generatePublicUrl` (which already handles images with appropriate sizing params)

### 9. 🔴 COST OMISSION: "Free (Vercel edge, included in plan)" is misleading

The plan says "Cost | Pro plan required → Free (Vercel edge, included in plan)." This is inaccurate. Vercel Image Optimization has real quotas and costs:

| Plan | Included Source Images | Overage |
|------|----------------------|---------|
| Hobby (Free) | 1,000 source images/mo | Pay-as-you-go |
| Pro ($20/mo) | 5,000 source images/mo | $5 per 1,000 additional |

— docs-findings.md:168-174

**Each unique source image URL optimized by `/_next/image` counts against this quota once per cache-miss lifecycle.** This means:
- Each beneficiary photo = 1 source image
- Each thumbnail (`/_next/image?w=16&q=20&url=<same>`) = a **separate** optimization (different `w`/`q` params), so each photo generates **2 source image counts** (full-size + thumbnail)
- If the codebase has hundreds of beneficiary photos with multiple display sizes, the quota burns proportionally

The plan should acknowledge the actual cost structure, including that thumbnail generation doubles per-image optimization costs.

### 10. 🔴 PLANNING GAP: No `next.config.ts` changes mentioned for default `imageSizes` or `minimumCacheTTL`

The plan says "next.config.ts (if any image optimization config is needed)" without specifying what. Two recommendations the plan misses:

**a) Add `w=16` to `imageSizes` explicitly** — While 16 is already in the default set (docs-findings.md:120), being explicit makes the configuration self-documenting and prevents future confusion about which sizes are used.

**b) Consider `minimumCacheTTL`** — Default is 3600s (1 hour) on Vercel (docs-findings.md:157). For static beneficiary photos that never change, increasing this to 31 days (`2678400`) would reduce optimization costs significantly by extending cache lifetime. Not required, but a notable cost-saving opportunity the plan doesn't mention.

### 11. 🔴 DEV MODE LIMITATION NOT CALLED OUT

The plan doesn't mention that in `next dev`, `/_next/image` does NOT actually transform images:

> "In `next dev`, your images will not be optimized. Images are optimized during the production build (`next build && next start`) or on Vercel." — docs-findings.md (Next.js docs, paraphrased)

In dev mode, `/_next/image?w=16&q=20&url=<big-image>` returns the original full-resolution image. The CSS blur (`filter: blur(10px)`) still applies, so the placeholder is a blurred full-resolution image — functionally correct but wasteful of bandwidth. This is cosmetic (not a blocker), but should be documented so developers understand why the blur placeholder doesn't shrink during local development.

### 12. ✅ ProgressiveImage already handles `/_next/image` URLs correctly

Confirmed: The `isThumbnailLocal` check (`thumbnailSrc?.startsWith('/')`) correctly identifies `/_next/image?w=...` as local. The `unoptimized={isThumbnailLocal}` passes the URL through as a raw `<img>` tag. The `/_next/image` endpoint on the server processes it. No code changes needed in `ProgressiveImage.tsx`. ✅

---

## Summary

| Claim | Verdict | Details |
|-------|---------|---------|
| `/_next/image` URLs work standalone | ✅ Yes | Server-side endpoint, not component-exclusive |
| Width rounding issue | 🔴 Fix: `w=20` → `w=16` | Rounds to nearest configured `imageSizes` (16) |
| `search: ''` gotcha | ✅ Not an issue | Current config omits `search`, so query params allowed |
| Vercel limits | ✅ Fine | 8192px / 10MB far above any usage |
| `getSignedTransformedUrl` removal | ✅ Safe | Zero callers |
| `getImageVariants` removal | ✅ Safe | Zero callers |
| CORS with Supabase | ✅ Non-issue | Server-to-server fetch, not browser |
| `getTransformedImageUrl` usage | 🔴 Plan missed | Active caller in admin upload route (line 82) |
| Cost claim | 🔴 Misleading | Not free — has quotas & overage ($5/1K) |
| `next.config.ts` changes | 🔴 Under-specified | No mention of `minimumCacheTTL` or explicit `imageSizes` |
| Dev mode behavior | 🔴 Not called out | `/_next/image` doesn't resize in `next dev` |

### Blockers

None. The plan is feasible. All issues are explanatory gaps or minor corrections.

### Required fixes before proceeding

1. **Plan: change `w=20` to `w=16`** for the thumbnail URL (or add 20 to `imageSizes`)
2. **Plan: document the active `getTransformedImageUrl` caller** in admin upload route (the function still works, it just returns a different URL format — this is a behavior change, not a breakage)
3. **Plan: correct "Free (Vercel edge)" to reflect actual pricing** (included quota, not free; thumbnails double per-image counts)

### Recommended additions to the plan

4. Add `imageSizes: [16, 32, 48, 64, 96, 128, 256, 384]` explicitly in `next.config.ts` for documentation
5. Consider adding `minimumCacheTTL: 2678400` (31 days) for static beneficiary photos to reduce optimization costs
6. Add a note that `/_next/image` doesn't resize in `next dev` mode (CSS-blur still works but uses full-resolution image)
