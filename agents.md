# Agent Guidelines for Creator Share

This document provides coding standards and development workflows for AI agents working in this repository.

## Project Overview

Creator Share is a Next.js 15 sponsorship platform built with TypeScript, Supabase, Chakra UI, and Tailwind CSS. The app connects sponsors with vulnerable children through a modern web interface with payment processing via Stripe and optional PayPal.

**Stack**: Next.js 15 (App Router), TypeScript, Supabase (PostgreSQL), Chakra UI, Tailwind CSS, Zustand, TanStack Query, Playwright

## Commands

### Development
```bash
npm run dev          # Start dev server with Turbopack
npm run build        # Production build
npm run start        # Production server
```

### Testing
```bash
npm run test         # Run all Playwright tests
npm run test:ui      # Interactive test UI
npm run test:headed  # Run tests with visible browser

# Run a single test file
npx playwright test tests/homepage.spec.ts

# Run a single test by name
npx playwright test -g "embed page loads successfully"
```

### Linting & Formatting
```bash
npm run lint         # ESLint check
npm run format       # Format with Prettier
```

### Database
```bash
# Generate TypeScript types from Supabase schema
export SUPABASE_PROJECT_ID="your-project-id"
npm run update-types-dev
```

## Code Style Guidelines

### TypeScript

- **Strict mode enabled** - All types must be properly defined
- **No explicit `any`** - Use proper types or `unknown` with type guards
- **Async/await** - Preferred over `.then()` chains
- **Path aliases** - Use `@/` for imports from `src/`

```typescript
// Good
import { createClient } from "@/utils/supabase/server"
const response = await fetch("/api/auth/login")

// Bad
import { createClient } from "../../utils/supabase/server"
fetch("/api/auth/login").then(...)
```

### Imports

Order imports as follows:
1. React/Next.js core imports
2. Third-party libraries
3. Internal components/utils (use `@/` alias)
4. Types
5. Styles/assets

```typescript
import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Box, Button, Flex } from "@chakra-ui/react"
import { createClient } from "@/utils/supabase/server"
import { useAuthStore } from "@/store/authStore"
import type { Database } from "@/lib/types/db.types"
```

### Formatting

- **No semicolons** - Configured in Prettier (`.prettierrc.json`)
- **Double quotes** - For strings
- **2 spaces** - For indentation
- **Trailing commas** - Off (per ESLint config)

### Components

- **Client components** - Must have `"use client"` directive at top
- **Server components** - Default in App Router, no directive needed
- **File naming** - PascalCase for components, camelCase for utilities
- **Component structure** - Hooks first, then handlers, then JSX

```typescript
"use client"
import { useState } from "react"
import { Box } from "@chakra-ui/react"

export function MyComponent() {
  // Hooks
  const [state, setState] = useState(false)
  
  // Handlers
  const handleClick = () => setState(true)
  
  // JSX
  return <Box onClick={handleClick}>Content</Box>
}
```

### API Routes

- **Type request/response** - Use NextResponse and proper types
- **Validate inputs** - Check for required fields early
- **Error handling** - Return appropriate status codes with error messages
- **Use Supabase clients correctly**:
  - `createClient()` from `@/utils/supabase/server` for authenticated requests
  - `createServiceRoleClient()` for admin operations bypassing RLS

```typescript
import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"

export async function POST(request: Request) {
  const supabase = await createClient()
  const body = await request.json()
  const { email, password } = body

  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password are required." },
      { status: 400 }
    )
  }

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 401 }
      )
    }

    return NextResponse.json(
      { message: "Login successful." },
      { status: 200 }
    )
  } catch (error) {
    console.error("Error:", error)
    return NextResponse.json(
      { error: "Failed to login." },
      { status: 500 }
    )
  }
}
```

### State Management

- **Zustand stores** - Located in `src/store/`
- **Store pattern** - Create state, actions, and async operations in one place
- **Client-side only** - Stores should only be used in client components

```typescript
import { create } from "zustand"

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  
  logout: async () => {
    const response = await fetch("/api/auth/logout", { method: "POST" })
    if (response.ok) {
      set({ user: null })
    }
  },
  
  fetchUser: async () => {
    const { data } = await supabase.auth.getUser()
    set({ user: data.user || null })
  },
}))
```

### Error Handling

- **API errors** - Always return proper HTTP status codes
- **Try-catch** - Wrap async operations that can fail
- **Console logging** - Use `console.error()` for errors, avoid `console.log()` in production code
- **User feedback** - Return meaningful error messages to the client

### Naming Conventions

- **Components** - PascalCase (`PageNavbar.tsx`, `SignInModal.tsx`)
- **Utilities** - camelCase (`supabase/server.ts`, `dateFormatter.ts`)
- **Constants** - UPPER_SNAKE_CASE
- **Hooks** - Prefix with `use` (`useAuthStore`, `useBeneficiaryPagination`)
- **Types/Interfaces** - PascalCase, suffix with specific type when helpful

### Database

- **Supabase client creation** - Always `await createClient()` in server components/routes
- **Type safety** - Use generated types from `src/lib/types/db.types.ts`
- **RLS policies** - Respect Row Level Security; use service role client only when necessary
- **Migrations** - See `scripts/db/README.md` for schema management

## Project Structure

```
src/
├── app/                      # Next.js App Router
│   ├── (admin)/             # Admin routes (role-protected)
│   ├── (app)/               # User dashboard routes
│   ├── api/                 # API endpoints
│   ├── sponsorships/        # Public sponsorship pages
│   └── embed/               # Embeddable widget
├── components/              # React components
│   ├── ui/                  # Base UI components (Chakra)
│   ├── admin-ui/            # Admin-specific components
│   └── common/              # Shared components
├── actions/                 # Server actions
├── hooks/                   # Custom React hooks
├── store/                   # Zustand stores
├── utils/                   # Helper functions
│   └── supabase/            # Supabase client utilities
├── services/                # External integrations (Telegram, etc.)
├── types/                   # TypeScript type definitions
└── middleware.ts            # Next.js middleware
```

## Key Patterns

### Supabase Authentication
- Client-side: Use `createClient()` from `@/utils/supabase/client`
- Server-side: Use `await createClient()` from `@/utils/supabase/server`
- Admin operations: Use `createServiceRoleClient()` (bypasses RLS)

### Routing
- Use `useRouter()` from `next/navigation` (App Router)
- Route groups: `(admin)` and `(app)` for layout isolation
- Dynamic routes: `[username]` for beneficiary profiles

### Testing
- E2E tests with Playwright in `tests/` directory
- Test files: `*.spec.ts`
- Wait for network idle: `await page.waitForLoadState("networkidle")`

## Common Tasks

### Adding a new API route
1. Create file in `src/app/api/[your-route]/route.ts`
2. Export HTTP method handlers (GET, POST, etc.)
3. Use `await createClient()` for database access
4. Return `NextResponse.json()` with proper status codes

### Adding a new page
1. Create file in `src/app/[route]/page.tsx`
2. Server components by default (no `"use client"`)
3. Use `"use client"` if hooks/state/browser APIs needed

### Updating database schema
1. Make changes in Supabase dashboard or SQL editor
2. Run `npm run update-types-dev` to regenerate types
3. Update queries/mutations to use new schema

## Additional Resources

- See `README.md` for setup and environment configuration
- See `docs/` directory for detailed documentation
- See `scripts/db/README.md` for database management
