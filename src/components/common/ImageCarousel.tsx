import React, { useState, useEffect } from "react"
import { Box, Flex, Image, IconButton } from "@chakra-ui/react"
import { LuChevronLeft, LuChevronRight } from "react-icons/lu"

interface ImageCarouselProps {
  images: Array<{ id?: string; image_url?: string }>
  getImageSrc: (image: { id?: string; image_url?: string }) => string
  fallbackSrc: string
  alt: string
  className?: string
  showArrowsOnHover?: boolean
}

export const ImageCarousel: React.FC<ImageCarouselProps> = ({
  images,
  getImageSrc,
  fallbackSrc,
  alt,
  className = "",
  showArrowsOnHover = true,
}) => {
  const [currentImageIndex, setCurrentImageIndex] = useState(0)

  useEffect(() => {
    setCurrentImageIndex(0)
  }, [images])

  const nextImage = (e: React.MouseEvent) => {
    e.stopPropagation()
    setCurrentImageIndex((prev) => (prev + 1) % images.length)
  }

  const prevImage = (e: React.MouseEvent) => {
    e.stopPropagation()
    setCurrentImageIndex((prev) => (prev - 1 + images.length) % images.length)
  }

  const goToImage = (index: number) => {
    setCurrentImageIndex(index)
  }

  if (images.length === 0) {
    return <Image src={fallbackSrc} alt={alt} className={className} />
  }

  return (
    <Box position="relative" className="group">
      <Image
        src={getImageSrc(images[currentImageIndex]) || fallbackSrc}
        alt={alt}
        className={className}
      />
      
      {images.length > 1 && (
        <>
          <IconButton
            aria-label="Previous image"
            size="sm"
            position="absolute"
            left="2"
            top="50%"
            transform="translateY(-50%)"
            bg="rgba(0, 0, 0, 0.5)"
            color="white"
            _hover={{ bg: "rgba(0, 0, 0, 0.7)" }}
            onClick={prevImage}
            zIndex={20}
            opacity={showArrowsOnHover ? 0 : 1}
            _groupHover={showArrowsOnHover ? { opacity: 1 } : {}}
            transition="opacity 0.2s"
          >
            <LuChevronLeft />
          </IconButton>
          
          <IconButton
            aria-label="Next image"
            size="sm"
            position="absolute"
            right="2"
            top="50%"
            transform="translateY(-50%)"
            bg="rgba(0, 0, 0, 0.5)"
            color="white"
            _hover={{ bg: "rgba(0, 0, 0, 0.7)" }}
            onClick={nextImage}
            zIndex={20}
            opacity={showArrowsOnHover ? 0 : 1}
            _groupHover={showArrowsOnHover ? { opacity: 1 } : {}}
            transition="opacity 0.2s"
          >
            <LuChevronRight />
          </IconButton>
        </>
      )}

      {images.length > 1 && (
        <Flex
          position="absolute"
          bottom="2"
          left="50%"
          transform="translateX(-50%)"
          gap={1}
          zIndex={20}
        >
          {images.map((_, index) => (
            <Box
              key={index}
              w="6px"
              h="6px"
              borderRadius="50%"
              bg={index === currentImageIndex ? "white" : "rgba(255, 255, 255, 0.5)"}
              cursor="pointer"
              onClick={(e) => {
                e.stopPropagation()
                goToImage(index)
              }}
              transition="background-color 0.2s"
              _hover={{ bg: "white" }}
            />
          ))}
        </Flex>
      )}
    </Box>
  )
} 