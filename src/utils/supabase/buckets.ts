// Assumptions:
// - The storage bucket is public.
// - Files are stored under the pattern: media/{parent_id}/{type}/{id}.{extension}
// - NEXT_PUBLIC_SUPABASE_URL must be set in the environment for public URL generation.

export const STORAGE_BUCKET = 'media';