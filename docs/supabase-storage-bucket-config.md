# Supabase Storage Bucket Configuration per Environment

## Overview

This document describes the approach to configure Supabase storage bucket names dynamically per environment (development, staging, production) in the project. This allows different environments to use different storage buckets without changing the codebase.

## Current Situation

Currently, the Supabase storage bucket names (e.g., `"sponsor_people"`) are hardcoded in the code, particularly in the `EditDrawer` component. This makes it difficult to manage different buckets for different environments.

## Proposed Solution

1. **Environment Variables for Bucket Names**  
   Introduce environment variables to define storage bucket names, for example:  
   - `NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET`
   
   These variables will be used to configure bucket names dynamically.

2. **Centralized Bucket Name Constants**  
   Create a centralized module to export bucket name constants that read from environment variables with fallback defaults.  
   Example:  
   ```ts
   export const STORAGE_BUCKET = process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET;
   ```

3. **Refactor Code to Use Constants**  
   Refactor all code that uses hardcoded bucket names to import and use these constants instead.  
   For example, in `EditDrawer.tsx`:  
   ```ts
   import { STORAGE_BUCKET } from 'src/utils/supabase/buckets';

   supabase.storage.from(STORAGE_BUCKET).upload(...);
   ```

4. **Deployment Environment Setup**  
   Ensure that each deployment environment sets the appropriate environment variables to point to the correct bucket names.

5. **Documentation and Maintenance**  
   Document this configuration approach in the project documentation to guide developers and DevOps teams.

## Benefits

- Enables easy switching of storage buckets per environment without code changes.
- Improves maintainability and deployment flexibility.
- Centralizes bucket name configuration to avoid duplication and errors.

## Next Steps

- Implement the centralized bucket constants module.
- Refactor existing code to use these constants.
- Update deployment environment configurations.
- Test to verify correct bucket usage.

---

This approach aligns with best practices for environment-specific configuration and will improve the robustness of the project’s storage management.