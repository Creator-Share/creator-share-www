# Research Findings: Supabase Storage Transforms & Next.js Image Optimization

> Compiled from official documentation. Date: 2026-05-26

---

## Table of Contents

1. [Supabase Storage Image Transformations](#1-supabase-storage-image-transformations)
2. [Next.js Image Optimization (`/_next/image`)](#2-nextjs-image-optimization-_nextimage)
3. [Cross-Cutting Concerns: Supabase → Next.js Migration](#3-cross-cutting-concerns-supabase--nextjs-migration)
4. [Source Index](#4-source-index)

---

## 1. Supabase Storage Image Transformations

### Official Docs URL

https://supabase.com/docs/guides/storage/serving/image-transformations

### URL Format

```
GET https://<project-ref>.supabase.co/storage/v1/render/image/public/<bucket>/<path>?width=500&height=600
```

- **Public bucket route:** `/storage/v1/render/image/public/{bucket}/{path}`
- **Signed/private route:** `/storage/v1/render/image/sign/{bucket}/{path}` (tokens appended as query params)
- Query parameters are the transformation options.

### Transformation Parameters

| Parameter | Type / Values | Description |
|-----------|--------------|-------------|
| `width` | integer (1–2500) | Output width in pixels. |
| `height` | integer (1–2500) | Output height in pixels. If only one is provided, the image is resized maintaining aspect ratio. |
| `resize` | `cover` (default), `contain`, `fill` | Resize mode. `cover` = crop to fill dimensions; `contain` = fit inside dimensions (letterbox); `fill` = stretch to dimensions. |
| `quality` | integer (1–100); default 75 | Output compression quality. |
| `format` | `origin` or omitted | If omitted → auto-selects modern format (WebP for supporting clients). `origin` → forces original format. |

> **Note on format auto-detection:** If the client sends `Accept: image/webp`, the transformed image is served as WebP automatically. AVIF is "coming soon." To force the original format, pass `format=origin`.

### Plan Requirements

> **"Image Resizing is currently enabled for Pro Plan and above."** — Official docs

- Free tier: **not available.** Neither `render/image` endpoint nor Smart CDN are accessible.
- Pro plan ($25/mo): enabled.
- Billing: usage-based package pricing (per 1000 origin images). Each unique source image + unique set of transformation params counts as one "origin image."
- Self-hosting option: deploy your own Imgproxy.

### Limitations & Gotchas

- **Width/height must be integers 1–2500.**
- **Only WebP output supported for auto-format** (AVIF pending).
- **Quality default is 75** — same as Next.js default.
- **The `render/image` endpoint does not support the full public URL path** — you must prepend the Supabase project domain yourself. There is no relative-path shorthand.
- **Transform endpoint does not respect `Cache-Control` headers from the origin image** in the same way as a direct object GET. Cache behavior is managed by the Smart CDN layer.
- **Stale-image edge case:** Smart CDN caches transformed images. If you replace the source image, cached transforms may serve the old version until TTL expires (default configurable).

### SDK Methods Return Transformed URLs

The Supabase JS SDK's `getPublicUrl()` and `createSignedUrl()` both accept a `transform` options object that generates the appropriate `render/image/` URL.

---

## 2. Next.js Image Optimization (`/_next/image`)

### Official Docs URLs

- **Image Component (App Router):** https://nextjs.org/docs/app/api-reference/components/image
- **Image Config (`next.config.js`):** https://nextjs.org/docs/app/api-reference/config/next-config-js/images
- **Getting Started (Images):** https://nextjs.org/docs/app/getting-started/images
- **Vercel Image Optimization (conceptual):** https://vercel.com/docs/image-optimization
- **Limits & Pricing:** https://vercel.com/docs/image-optimization/limits-and-pricing
- **Usage/Costs:** https://vercel.com/docs/image-optimization/managing-image-optimization-costs

### URL Format (Internal Optimization Endpoint)

The built-in Image Optimization API generates URLs in this format:

```
/_next/image?url=<encoded-source-url>&w=<width>&q=<quality>
```

- The `<url>` parameter is the **URL-encoded** source image URL (e.g., the Supabase public URL).
- The `<w>` parameter is one of the configured `deviceSizes` or `imageSizes` widths (rounded to nearest match).
- The `<q>` parameter is quality (default 75).

When manually constructing these URLs, you must ensure the source image domain is listed in `remotePatterns` — otherwise Next.js returns a 400 Bad Request.

### Image Component Props (Key Ones)

| Prop | Values | Description |
|------|--------|-------------|
| `placeholder` | `"empty"` (default) or `"blur"` | Placeholder behavior while loading. |
| `blurDataURL` | Data URL (base64) or path | Required when `placeholder="blur"` and the image is remote (not statically imported). Must be a tiny blurred preview. |
| `loader` | Function `({ src, width, quality }) => string` | Custom URL resolver. Overrides the default `/_next/image` optimization for this component instance. |
| `unoptimized` | `boolean` (default `false`) | When `true`, serves the source image as-is (no resizing, format conversion, or quality changes). |
| `priority` | `boolean` | Preloads the image (skip lazy loading). Use for LCP images. |

> **Note on `placeholder="blur"`:** For remote images, you must provide `blurDataURL` manually. Statically imported images get an automatic blurDataURL generated. Using a large blurDataURL (>~10KB) can hurt performance. Libraries like [Plaiceholder](https://plaiceholder.co) are commonly used for generation.

### `next.config.js` — Image Configuration

```js
// next.config.js
const config = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        port: '',
        pathname: '/storage/v1/render/image/public/**',
        search: '',
      },
    ],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],  // default
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],              // default
    formats: ['image/webp', 'image/avif'],                          // default
    minimumCacheTTL: 3600,                                          // default on Vercel
  },
}
```

**Key details about `remotePatterns`:**
- Each pattern requires `protocol` and `hostname`.
- `hostname` supports glob patterns: `*.supabase.co`, `**.supabase.co`.
- `pathname` supports glob patterns: `/storage/v1/render/**`.
- If `search` is set to `''` (empty string), **no query parameters are allowed** on the source URL. Omit `search` or set it to `'?'` to allow any query params.
- `remotePatterns` **replaced** the older `domains: [...]` array in Next.js 13+. `domains` is deprecated.

### Cache Behavior (Vercel)

| Setting | Default | Notes |
|---------|---------|-------|
| `minimumCacheTTL` | 3600s (1 hour) | Next.js configuration. Determines max-age of optimized images. |
| Vercel CDN TTL | Uses upstream `Cache-Control max-age` or `minimumCacheTTL`, **whichever is larger** | Source: https://vercel.com/docs/image-optimization |
| Optimized image size limit | 10 MB | Source: Vercel Limits docs |
| Source image max dimensions | 8192 × 8192 px | Source: Vercel Limits docs |

> **Key insight:** If the upstream image (Supabase) has no `Cache-Control` header or a very short one, Next.js falls back to `minimumCacheTTL` (1h). You can increase `minimumCacheTTL` to 31 days (`2678400`) if images are static, to reduce optimization costs.

### Pricing & Limits (Vercel Image Optimization)

| Plan | Included Source Images | Overage |
|------|----------------------|---------|
| Hobby (Free) | 1,000 source images/mo | Pay-as-you-go |
| Pro ($20/mo) | 5,000 source images/mo | $5 per 1,000 additional |

> **Important:** Each unique source image URL that gets optimized counts against this quota **once per cache-miss lifecycle** — re-optimization for an already-cached image doesn't re-count. But any new transformation dimensions count as new source images.

---

## 3. Cross-Cutting Concerns: Supabase → Next.js Migration

### What changes when moving to Next.js-only optimization

**Current setup (likely):** `<Image src={supabaseRenderUrl} ...>` where `supabaseRenderUrl` already includes transformation params. Next.js may or may not be re-optimizing these.

**Proposed setup:** `<Image src={publicUrl} ...>` where `publicUrl` is the **raw** Supabase object URL (no `render/image/` transform). Let Next.js handle all resizing/format/quality.

### Gotchas & Caveats

1. **Supabase Pro requirement goes away** — Image transformations handled by Next.js/Vercel, not Supabase. You can stay on Supabase Free plan for storage.

2. **Vercel Image Optimization costs are real** — If you have many unique images × many sizes, the "source image" quota can burn quickly. Each responsive variant doesn't re-count, but each unique original does.

3. **`remotePatterns` must be precise** — The current config uses `hostname: "*.supabase.co"`. This is sufficient for raw object URLs at `https://<project>.supabase.co/storage/v1/object/public/...`. **But** if you want to keep using the Supabase `render/image` transform URLs as Next.js *source* URLs, they must also be in `remotePatterns` (they go through the same Next.js optimization pipeline).

4. **Automatic format negotiation** — Supabase `render/image` auto-selects WebP via `Accept` header. Next.js does the same (to `format: ['image/webp', 'image/avif']`) **plus** generates AVIF if supported. Next.js actually wins here.

5. **blurDataURL for remote images** — If you want `placeholder="blur"`, you need a generated base64 blur hash per image. This means server-side processing (e.g., on upload, or at request time). Supabase doesn't provide blur hashes natively. Plaiceholder or a custom Edge Function would be needed.

6. **Cache layering** — With Supabase transforms + Next.js re-optimization, images go through: Supabase Smart CDN → Vercel Edge → Browser. This is two cache hops. If Next.js is handling everything, it's: Supabase origin (no cache) → Vercel Edge → Browser. Simpler, but puts more load on Vercel.

7. **Signed/private images** — The `render/image/sign/` endpoint for private buckets adds auth tokens. Next.js Image Optimization can't authenticate those requests unless you implement a custom loader that attaches the token server-side. This is a significant complexity add.

8. **Width limit differences** — Supabase caps at 2500px; Next.js (Vercel) caps at 8192px. Not likely an issue, but worth noting.

9. **Default quality** — Both default to 75. Consistent.

10. **`unoptimized` for small/vector images** — Vercel recommends using `unoptimized` for images under 10 KB, SVG, and animated GIF to avoid unnecessary optimization costs.

---

## 4. Source Index

### Supabase

| Page | URL | Key Content |
|------|-----|-------------|
| Storage Image Transformations | https://supabase.com/docs/guides/storage/serving/image-transformations | Primary docs: parameters, URL format, Pro requirement, Next.js loader example |
| Manage Storage Image Transformations usage | https://supabase.com/docs/guides/platform/manage-your-usage/storage-image-transformations | Billing details (per 1000 origin images, package pricing) |
| Features: Image Transformations | https://supabase.com/features/image-transformations | Marketing overview, mentions Imgproxy self-hosting |
| Blog: Storage v2 (Smart CDN + resizing) | https://supabase.com/blog/storage-image-resizing-smart-cdn | Original announcement, explains stale-cache edge case |
| Blog: Storage v3 (quality & format) | https://supabase.com/blog/storage-v3-resumable-uploads | Added `quality` and `format` parameters, Next.js loader example |
| GitHub source (.mdx) | https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/storage/serving/image-transformations.mdx | Raw source of the docs page |

### Next.js / Vercel

| Page | URL | Key Content |
|------|-----|-------------|
| Image Component (App Router) | https://nextjs.org/docs/app/api-reference/components/image | Full API reference: all props (`placeholder`, `blurDataURL`, `loader`, `unoptimized`, `priority`, `sizes`, etc.) |
| Image Config (`next.config.js`) | https://nextjs.org/docs/app/api-reference/config/next-config-js/images | `remotePatterns`, `deviceSizes`, `imageSizes`, `formats`, `minimumCacheTTL`, `loaderFile` |
| Getting Started: Images | https://nextjs.org/docs/app/getting-started/images | Quickstart, explains `remotePatterns` and why it's required |
| Vercel Image Optimization | https://vercel.com/docs/image-optimization | Overview, caching behavior, TTL logic, custom loader support |
| Limits & Pricing | https://vercel.com/docs/image-optimization/limits-and-pricing | Source image dimension limits (8192px), max optimized size (10MB), quotas per plan |
| Managing Usage & Costs | https://vercel.com/docs/image-optimization/managing-image-optimization-costs | Cost-saving tips: `unoptimized` for small images, caching strategy, `minimumCacheTTL` |
| Vercel Changelog (Hobby limits increased) | https://vercel.com/changelog/increased-hobby-usage-limits-for-image-optimization | Current Hobby tier limits |
| `next-image-unconfigured-host` error | https://nextjs.org/docs/messages/next-image-unconfigured-host | Explains the `search: ''` gotcha and `remotePatterns` |

### Additional References

| Page | URL | Why |
|------|-----|-----|
| Nuxt Image - Supabase Provider | https://image.nuxt.com/providers/supabase | Confirms Supabase resize modes (`cover`, `contain`, `fill`) |
| Plaiceholder | https://plaiceholder.co | Recommended by Next.js docs for `blurDataURL` generation |
