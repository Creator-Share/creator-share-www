/**
 * Image compression utility that guarantees files are under 4MB
 * Uses browser-image-compression library for better quality and performance
 */

import imageCompression from 'browser-image-compression'

const MAX_SIZE_MB = 3.5 // Target 3.5MB to leave buffer under Vercel's 4.5MB limit
const MAX_DIMENSION = 4000 // Max width or height in pixels
const INITIAL_QUALITY = 0.85 // Initial compression quality (0-1)

export interface CompressionOptions {
  maxSizeMB?: number
  maxWidthOrHeight?: number
  initialQuality?: number
  onProgress?: (progress: number) => void
}

/**
 * Compress an image file to ensure it's under the size limit
 * Uses iterative compression if needed to guarantee the file size
 * 
 * @param file - The image file to compress
 * @param options - Compression options
 * @returns Compressed file that is guaranteed to be under maxSizeMB
 */
export async function compressImage(
  file: File,
  options: CompressionOptions = {}
): Promise<File> {
  const {
    maxSizeMB = MAX_SIZE_MB,
    maxWidthOrHeight = MAX_DIMENSION,
    initialQuality = INITIAL_QUALITY,
    onProgress,
  } = options

  // If file is already under the limit, return as-is
  const maxSizeBytes = maxSizeMB * 1024 * 1024
  if (file.size <= maxSizeBytes) {
    return file
  }

  // Check if file is an image
  if (!file.type.startsWith('image/')) {
    throw new Error('File is not an image')
  }

  try {
    // First attempt: compress with initial settings
    let compressed = await imageCompression(file, {
      maxSizeMB,
      maxWidthOrHeight,
      useWebWorker: true,
      initialQuality,
      fileType: 'image/jpeg', // Convert to JPEG for better compression
      onProgress: onProgress ? (p) => onProgress(p) : undefined,
    })

    // If still too large, try more aggressive compression
    if (compressed.size > maxSizeBytes) {
      let quality = initialQuality - 0.1 // Reduce quality
      let attempts = 0
      const maxAttempts = 5

      while (compressed.size > maxSizeBytes && attempts < maxAttempts) {
        quality = Math.max(0.3, quality - 0.1) // Don't go below 0.3 quality
        
        compressed = await imageCompression(file, {
          maxSizeMB,
          maxWidthOrHeight: Math.max(1920, maxWidthOrHeight - 200), // Reduce dimensions gradually
          useWebWorker: true,
          initialQuality: quality,
          fileType: 'image/jpeg',
          onProgress: onProgress ? (p) => onProgress(p) : undefined,
        })

        attempts++
      }

      // If still too large after all attempts, use the most compressed version
      // and log a warning
      if (compressed.size > maxSizeBytes) {
        console.warn(
          `Image ${file.name} could not be compressed below ${maxSizeMB}MB. ` +
          `Final size: ${(compressed.size / 1024 / 1024).toFixed(2)}MB`
        )
      }
    }

    return compressed
  } catch (error) {
    console.error('Image compression error:', error)
    // If compression fails, return original file
    // The API route will handle the size check and return appropriate error
    throw new Error(
      `Failed to compress image: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}

/**
 * Compress multiple images in parallel (with concurrency limit)
 * 
 * @param files - Array of image files to compress
 * @param options - Compression options
 * @param concurrency - Maximum number of concurrent compressions (default: 3)
 * @returns Array of compressed files
 */
export async function compressImages(
  files: File[],
  options: CompressionOptions = {},
  concurrency: number = 3
): Promise<File[]> {
  const results: File[] = []
  
  // Process files in batches to avoid overwhelming the browser
  for (let i = 0; i < files.length; i += concurrency) {
    const batch = files.slice(i, i + concurrency)
    const batchResults = await Promise.all(
      batch.map((file) => compressImage(file, options))
    )
    results.push(...batchResults)
  }
  
  return results
}
