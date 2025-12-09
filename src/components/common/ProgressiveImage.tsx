"use client"
import React, { useState, useEffect } from "react"
import { Image, Box } from "@chakra-ui/react"

interface ProgressiveImageProps {
  src: string
  thumbnailSrc?: string
  alt: string
  className?: string
  fallbackSrc?: string
  style?: React.CSSProperties
}

/**
 * ProgressiveImage component that loads a low-quality thumbnail first,
 * then transitions to the full-quality image for a smooth loading experience.
 */
export const ProgressiveImage: React.FC<ProgressiveImageProps> = ({
  src,
  thumbnailSrc,
  alt,
  className = "",
  fallbackSrc,
  style,
}) => {
  const [imageLoaded, setImageLoaded] = useState(false)
  const [imageError, setImageError] = useState(false)
  const [thumbnailLoaded, setThumbnailLoaded] = useState(false)
  const [thumbnailError, setThumbnailError] = useState(false)

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
        No image
      </Box>
    )
  }

  return (
    <Box
      position="relative"
      width="100%"
      height="100%"
      overflow="hidden"
      className={className}
      style={style}
    >
      {/* Thumbnail/Placeholder - Only show if we have a separate thumbnail and it hasn't errored */}
      {hasThumbnail && thumbnailSrc && (
        <Image
          src={thumbnailSrc}
          alt={alt}
          position="absolute"
          top={0}
          left={0}
          width="100%"
          height="100%"
          objectFit="cover"
          filter={thumbnailLoaded && !imageLoaded ? "blur(10px)" : "none"}
          transform={thumbnailLoaded && !imageLoaded ? "scale(1.1)" : "scale(1)"}
          transition="filter 0.3s ease-out, transform 0.3s ease-out, opacity 0.3s ease-out"
          opacity={imageLoaded ? 0 : 1}
          onLoad={handleThumbnailLoad}
          onError={handleThumbnailError}
          style={{
            objectPosition: "center",
            zIndex: 0,
          }}
        />
      )}

      {/* Full Quality Image - Always try to load, fades in when loaded */}
      <Image
        key={displaySrc} // Force re-render when src changes
        src={displaySrc}
        alt={alt}
        position="absolute"
        top={0}
        left={0}
        width="100%"
        height="100%"
        objectFit="cover"
        loading="eager" // Load immediately
        opacity={
          shouldShowImageImmediately 
            ? 1 // Show immediately if no thumbnail
            : imageLoaded 
              ? 1 
              : thumbnailLoaded 
                ? 0 
                : 1 // Show if thumbnail hasn't loaded yet
        }
        transition="opacity 0.3s ease-in"
        onLoad={handleImageLoad}
        onError={handleImageError}
        style={{
          objectPosition: "center",
          zIndex: 1, // Always on top
          display: 'block', // Ensure it's displayed
        }}
      />

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
        >
          Image unavailable
        </Box>
      )}
    </Box>
  )
}

