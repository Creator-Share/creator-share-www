/**
 * Supabase Image Transformation Utilities
 * 
 * This module provides utilities for using Supabase's built-in image transformation API
 * as documented at: https://supabase.com/docs/guides/storage/serving/image-transformations
 */

import { createClient } from "@/utils/supabase/client"

const supabase = createClient()

export interface ImageTransformOptions {
  width?: number
  height?: number
  quality?: number
  resize?: 'cover' | 'contain' | 'fill'
  format?: 'origin'
}

/**
 * Generate a transformed image URL using Supabase Image Transformation API
 * 
 * @param bucket - The storage bucket name
 * @param path - The path to the image in the bucket
 * @param options - Transformation options
 * @returns The transformed image URL
 * 
 * @example
 * ```typescript
 * const thumbnailUrl = getTransformedImageUrl('media', 'images/photo.jpg', {
 *   width: 300,
 *   height: 300,
 *   quality: 80,
 *   resize: 'contain'
 * })
 * ```
 */
export const getTransformedImageUrl = (
  bucket: string,
  path: string,
  options: ImageTransformOptions = {}
): string => {
  const transformOptions: {
    width: number;
    height: number;
    quality: number;
    resize?: 'cover' | 'contain' | 'fill';
    format?: 'origin';
  } = {
    width: options.width || 400,
    height: options.height || 400,
    quality: options.quality || 80,
  }
  
  if (options.resize) {
    transformOptions.resize = options.resize
  }
  
  if (options.format) {
    transformOptions.format = options.format
  }

  const { data } = supabase.storage
    .from(bucket)
    .getPublicUrl(path, {
      transform: transformOptions
    })

  return data.publicUrl
}

/**
 * Generate multiple transformed image URLs for different use cases
 */
export const getImageVariants = (bucket: string, path: string) => ({
  thumbnail: getTransformedImageUrl(bucket, path, {
    width: 150,
    height: 150,
    quality: 70
  }),
  small: getTransformedImageUrl(bucket, path, {
    width: 300,
    height: 300,
    quality: 80
  }),
  medium: getTransformedImageUrl(bucket, path, {
    width: 600,
    height: 600,
    quality: 85
  }),
  large: getTransformedImageUrl(bucket, path, {
    width: 1200,
    height: 1200,
    quality: 90
  }),
  original: getTransformedImageUrl(bucket, path, {
    format: 'origin' // Keep original format
  })
})

/**
 * Upload an image to Supabase storage for transformation
 * 
 * @param bucket - The storage bucket name
 * @param path - The path where to store the image
 * @param file - The image file to upload
 * @returns The uploaded file path
 */
export const uploadImageForTransformation = async (
  bucket: string,
  path: string,
  file: File
): Promise<string> => {
  
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, file, {
      cacheControl: '3600',
      upsert: true,
      contentType: file.type
    })

  if (error) {
    console.error('Upload error:', error)
    throw new Error(`Failed to upload image: ${error.message}`)
  }

  return path
}

/**
 * Batch upload multiple images for transformation
 */
export const uploadImagesForTransformation = async (
  bucket: string,
  files: File[],
  basePath: string = 'temp'
): Promise<string[]> => {
  const uploadPromises = files.map(async (file, index) => {
    const fileExt = file.name.split('.').pop()
    const fileName = `${Date.now()}-${index}-${Math.random().toString(36).substring(2)}.${fileExt}`
    const filePath = `${basePath}/${fileName}`
    
    return uploadImageForTransformation(bucket, filePath, file)
  })

  return Promise.all(uploadPromises)
}

/**
 * Delete images from Supabase storage
 */
export const deleteTransformedImages = async (
  bucket: string,
  paths: string[]
): Promise<void> => {
  const { error } = await supabase.storage
    .from(bucket)
    .remove(paths)

  if (error) {
    throw new Error(`Failed to delete images: ${error.message}`)
  }
}

/**
 * Get a signed URL for a transformed image (for private buckets)
 */
export const getSignedTransformedUrl = async (
  bucket: string,
  path: string,
  expiresIn: number = 3600,
  options: ImageTransformOptions = {}
): Promise<string> => {
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresIn, {
      transform: {
        width: options.width || 400,
        height: options.height || 400,
        quality: options.quality || 80,
        // Note: Supabase automatically optimizes to WebP when supported
        ...(options.format && { format: options.format })
      }
    })

  if (error) {
    throw new Error(`Failed to create signed URL: ${error.message}`)
  }

  return data.signedUrl
}
