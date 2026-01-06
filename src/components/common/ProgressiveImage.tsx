"use client"
import React, { useState, useEffect } from "react"
import Image from "next/image"
import { Box } from "@chakra-ui/react"
import { PERSON_PLACEHOLDER_PATH } from "@/utils/placeholders"

interface ProgressiveImageProps {
  src: string
  thumbnailSrc?: string
  alt: string
  className?: string
  fallbackSrc?: string
  style?: React.CSSProperties
  width?: number
  height?: number
  fill?: boolean
  sizes?: string
}

/**
 * ProgressiveImage component that loads a low-quality thumbnail first,
 * then transitions to the full-quality image for a smooth loading experience.
 * Ensures consistent placeholder sizes even before images are loaded.
 */
export const ProgressiveImage: React.FC<ProgressiveImageProps> = ({
  src,
  thumbnailSrc,
  alt,
  className = "",
  fallbackSrc,
  style,
  width,
  height,
  fill = true,
  sizes,
}) => {
  const [imageLoaded, setImageLoaded] = useState(false)
  const [imageError, setImageError] = useState(false)
  const [thumbnailLoaded, setThumbnailLoaded] = useState(false)
  const [thumbnailError, setThumbnailError] = useState(false)

  // Default placeholder - use SVG directly from public folder
  const defaultPlaceholder = PERSON_PLACEHOLDER_PATH

  // Reset states when src changes
  useEffect(() => {
    setImageLoaded(false)
    setImageError(false)
    setThumbnailLoaded(false)
    setThumbnailError(false)
    
    // Check if image is already loaded (for cached images)
    const img = new window.Image()
    img.onload = () => {
      setImageLoaded(true)
    }
    img.onerror = () => {
      setImageError(true)
      setImageLoaded(true)
    }
    img.src = src
    
    // Cleanup
    return () => {
      img.onload = null
      img.onerror = null
    }
  }, [src])

  const handleImageLoad = () => {
    setImageLoaded(true)
  }

  const handleImageError = () => {
    setImageError(true)
    setImageLoaded(true) // Stop showing loading state
  }

  const handleThumbnailLoad = () => {
    setThumbnailLoaded(true)
  }

  const handleThumbnailError = () => {
    setThumbnailError(true)
    // If thumbnail fails, skip it and show full image immediately
  }

  const displaySrc = imageError && fallbackSrc ? fallbackSrc : src
  const hasThumbnail = !!thumbnailSrc && !thumbnailError
  
  // If no thumbnail, show image immediately without progressive loading
  const shouldShowImageImmediately = !hasThumbnail
  
  // Determine final fallback - prefer provided fallback, then default placeholder
  const finalFallback = fallbackSrc || defaultPlaceholder
  
  // Ensure we have a valid src
  if (!displaySrc || displaySrc.trim() === '') {
    return (
      <Box
        position="relative"
        width="100%"
        height="100%"
        overflow="hidden"
        className={className}
        style={style}
        bg="gray.200"
        display="flex"
        alignItems="center"
        justifyContent="center"
        color="gray.500"
        fontSize="sm"
      >
        {fill ? (
          <Image
            src={finalFallback}
            alt={alt}
            fill
            className="object-cover"
            sizes={sizes || "100vw"}
            unoptimized
          />
        ) : (
          <Image
            src={finalFallback}
            alt={alt}
            width={width || 400}
            height={height || 400}
            className="object-cover"
            unoptimized
          />
        )}
      </Box>
    )
  }

  // Check if src is a local path (starts with /) or external URL
  const isLocalImage = displaySrc.startsWith('/')
  const isThumbnailLocal = thumbnailSrc?.startsWith('/')

  return (
    <Box
      position="relative"
      width="100%"
      height="100%"
      overflow="hidden"
      className={className}
      style={style}
      bg="gray.100"
      minHeight={fill ? undefined : height || 200}
      minWidth={fill ? undefined : width || 200}
    >
      {/* Placeholder background - ensures consistent sizing before any image loads */}
      <Box
        position="absolute"
        top={0}
        left={0}
        width="100%"
        height="100%"
        bg="gray.100"
        zIndex={0}
        display="flex"
        alignItems="center"
        justifyContent="center"
      >
        {!thumbnailLoaded && !imageLoaded && (
          <Image
            src={defaultPlaceholder}
            alt=""
            fill={fill}
            width={fill ? undefined : width || 200}
            height={fill ? undefined : height || 200}
            className="object-cover opacity-30"
            sizes={sizes || "100vw"}
            unoptimized
            aria-hidden="true"
          />
        )}
      </Box>

      {/* Thumbnail/Placeholder - Only show if we have a separate thumbnail and it hasn't errored */}
      {hasThumbnail && thumbnailSrc && (
        <Box
          position="absolute"
          top={0}
          left={0}
          width="100%"
          height="100%"
          zIndex={1}
          style={{
            filter: thumbnailLoaded && !imageLoaded ? "blur(10px)" : "none",
            transform: thumbnailLoaded && !imageLoaded ? "scale(1.1)" : "scale(1)",
            transition: "filter 0.3s ease-out, transform 0.3s ease-out, opacity 0.3s ease-out",
            opacity: imageLoaded ? 0 : 1,
          }}
        >
          {fill ? (
            <Image
              src={thumbnailSrc}
              alt={alt}
              fill
              className="object-cover"
              sizes={sizes || "100vw"}
              onLoad={handleThumbnailLoad}
              onError={handleThumbnailError}
              unoptimized={isThumbnailLocal}
              style={{ objectPosition: "center" }}
            />
          ) : (
            <Image
              src={thumbnailSrc}
              alt={alt}
              width={width || 400}
              height={height || 400}
              className="object-cover"
              onLoad={handleThumbnailLoad}
              onError={handleThumbnailError}
              unoptimized={isThumbnailLocal}
              style={{ objectPosition: "center" }}
            />
          )}
        </Box>
      )}

      {/* Full Quality Image - Always try to load, fades in when loaded */}
      <Box
        position="absolute"
        top={0}
        left={0}
        width="100%"
        height="100%"
        zIndex={2}
        style={{
          opacity:
            shouldShowImageImmediately 
              ? 1 // Show immediately if no thumbnail
              : imageLoaded 
                ? 1 
                : thumbnailLoaded 
                  ? 0 
                  : 0.5, // Show partially if thumbnail hasn't loaded yet
          transition: "opacity 0.3s ease-in",
        }}
      >
        {fill ? (
          <Image
            key={displaySrc} // Force re-render when src changes
            src={displaySrc}
            alt={alt}
            fill
            className="object-cover"
            loading="eager"
            onLoad={handleImageLoad}
            onError={handleImageError}
            sizes={sizes || "100vw"}
            unoptimized={isLocalImage}
            style={{ objectPosition: "center" }}
          />
        ) : (
          <Image
            key={displaySrc}
            src={displaySrc}
            alt={alt}
            width={width || 400}
            height={height || 400}
            className="object-cover"
            loading="eager"
            onLoad={handleImageLoad}
            onError={handleImageError}
            unoptimized={isLocalImage}
            style={{ objectPosition: "center" }}
          />
        )}
      </Box>

      {/* Fallback - Shows if main image fails and no fallbackSrc */}
      {imageError && !fallbackSrc && (
        <Box
          position="absolute"
          top={0}
          left={0}
          width="100%"
          height="100%"
          bg="gray.200"
          display="flex"
          alignItems="center"
          justifyContent="center"
          color="gray.500"
          fontSize="sm"
          zIndex={3}
        >
          {fill ? (
            <Image
              src={defaultPlaceholder}
              alt={alt}
              fill
              className="object-cover"
              sizes={sizes || "100vw"}
              unoptimized
            />
          ) : (
            <Image
              src={defaultPlaceholder}
              alt={alt}
              width={width || 400}
              height={height || 400}
              className="object-cover"
              unoptimized
            />
          )}
        </Box>
      )}
    </Box>
  )
}

