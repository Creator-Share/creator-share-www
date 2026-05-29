"use client"
import React, { useState, useEffect } from "react"
import Image from "next/image"
import { Box } from "@chakra-ui/react"
import { PERSON_PLACEHOLDER_PATH } from "@/utils/placeholders"

interface ProgressiveImageProps {
  src: string
  alt: string
  className?: string
  fallbackSrc?: string
  style?: React.CSSProperties
  width?: number
  height?: number
  fill?: boolean
  sizes?: string
  priority?: boolean
}

const shouldBypassImageOptimization = (src: string): boolean =>
  src.startsWith("blob:") ||
  src.startsWith("data:") ||
  /\.svg(?:$|\?)/i.test(src)

export const ProgressiveImage: React.FC<ProgressiveImageProps> = ({
  src,
  alt,
  className = "",
  fallbackSrc,
  style,
  width,
  height,
  fill = true,
  sizes,
  priority = false,
}) => {
  const [imageLoaded, setImageLoaded] = useState(false)
  const [imageError, setImageError] = useState(false)

  const defaultPlaceholder = PERSON_PLACEHOLDER_PATH

  useEffect(() => {
    setImageLoaded(false)
    setImageError(false)
  }, [src])

  const handleImageLoad = () => {
    setImageLoaded(true)
  }

  const handleImageError = () => {
    setImageError(true)
    setImageLoaded(true)
  }

  const displaySrc = imageError && fallbackSrc ? fallbackSrc : src
  const finalFallback = fallbackSrc || defaultPlaceholder

  if (!displaySrc || displaySrc.trim() === "") {
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
            unoptimized={shouldBypassImageOptimization(finalFallback)}
          />
        ) : (
          <Image
            src={finalFallback}
            alt={alt}
            width={width || 400}
            height={height || 400}
            className="object-cover"
            unoptimized={shouldBypassImageOptimization(finalFallback)}
          />
        )}
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
      bg="gray.100"
      minHeight={fill ? undefined : height || 200}
      minWidth={fill ? undefined : width || 200}
    >
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
        {!imageLoaded && (
          <Image
            src={defaultPlaceholder}
            alt=""
            fill={fill}
            width={fill ? undefined : width || 200}
            height={fill ? undefined : height || 200}
            className="object-cover opacity-30"
            sizes={sizes || "100vw"}
            unoptimized={shouldBypassImageOptimization(defaultPlaceholder)}
            aria-hidden="true"
          />
        )}
      </Box>

      <Box
        position="absolute"
        top={0}
        left={0}
        width="100%"
        height="100%"
        zIndex={2}
        style={{
          opacity: imageLoaded ? 1 : 0,
          transition: "opacity 0.5s ease-in",
        }}
      >
        {fill ? (
          <Image
            key={displaySrc}
            src={displaySrc}
            alt={alt}
            fill
            className="object-cover"
            loading={priority ? undefined : "lazy"}
            priority={priority}
            onLoad={handleImageLoad}
            onError={handleImageError}
            sizes={sizes || "100vw"}
            unoptimized={shouldBypassImageOptimization(displaySrc)}
            style={{ objectPosition: "center 5%" }}
          />
        ) : (
          <Image
            key={displaySrc}
            src={displaySrc}
            alt={alt}
            width={width || 400}
            height={height || 400}
            className="object-cover"
            loading={priority ? undefined : "lazy"}
            priority={priority}
            onLoad={handleImageLoad}
            onError={handleImageError}
            unoptimized={shouldBypassImageOptimization(displaySrc)}
            style={{ objectPosition: "center 5%" }}
          />
        )}
      </Box>

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
              unoptimized={shouldBypassImageOptimization(defaultPlaceholder)}
            />
          ) : (
            <Image
              src={defaultPlaceholder}
              alt={alt}
              width={width || 400}
              height={height || 400}
              className="object-cover"
              unoptimized={shouldBypassImageOptimization(defaultPlaceholder)}
            />
          )}
        </Box>
      )}
    </Box>
  )
}
