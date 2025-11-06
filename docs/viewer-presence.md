# Visitor Viewing Indicators - Implementation Guide

## Overview

This feature displays real-time viewer counts on beneficiary profiles using Supabase Realtime Presence API. Users can see how many people are currently viewing each profile, both on individual profile pages and in the list view.

## Architecture

### Technology Stack
- **Supabase Realtime Presence API** - Real-time presence tracking
- **React Context API** - Global state management
- **WebSocket** - Persistent connection for real-time updates
- **Session Storage** - Anonymous user identification

### Key Components

```
┌─────────────────────────────────────────┐
│     PresenceProvider (Context)          │
│  - Manages WebSocket connections        │
│  - Tracks viewer state per profile      │
│  - Handles join/leave events            │
└─────────────────────────────────────────┘
                  │
                  ├──────────────────────────┐
                  ▼                          ▼
┌──────────────────────────┐  ┌──────────────────────────┐
│   Profile Page           │  │   List View (Cards)      │
│  - Joins presence        │  │  - Displays count only   │
│  - Shows badge indicator │  │  - Minimal badge         │
└──────────────────────────┘  └──────────────────────────┘
```

## Features

### Real-time Tracking
- ✅ Instant updates when users join/leave profiles
- ✅ Automatic cleanup when users close tabs
- ✅ Deduplication (same user across multiple tabs)
- ✅ Anonymous user tracking (no login required)

### Visual Indicators
- ✅ **Minimal variant** - Small badge with eye icon and count
- ✅ **Badge variant** - Larger badge with "viewers" text
- ✅ **Detailed variant** - Full info with "Popular now" label
- ✅ Pulse animation for active viewers
- ✅ 🔥 Fire emoji for popular profiles (threshold-based)

## Implementation Details

### 1. Core Hook (`src/hooks/usePresence.tsx`)

**Responsibilities:**
- Manages Supabase Presence channels
- Tracks viewer state per profile
- Provides join/leave functions
- Calculates viewer counts

**Key Functions:**
```typescript
joinProfilePresence(profileId: string)    // Join presence for a profile
leaveProfilePresence(profileId: string)   // Leave presence
getViewerCount(profileId: string)         // Get current viewer count
isViewingProfile(profileId: string)       // Check if viewing
```

**Session Management:**
- Generates unique session ID per tab
- Creates anonymous user ID if not logged in
- Stores IDs in `sessionStorage`

### 2. Viewer Indicator Component

**Location:** `src/components/presence/ViewerIndicator.tsx`

**Variants:**

**Minimal:**
```tsx
<ViewerIndicator 
  profileId={beneficiary.id}
  variant="minimal"
  showWhenZero={false}
/>
```
Displays: `👁️ 3`

**Badge (Default):**
```tsx
<ViewerIndicator 
  profileId={beneficiary.id}
  variant="badge"
  popularThreshold={5}
/>
```
Displays: `👁️ 8 viewers 🔥`

**Detailed:**
```tsx
<ViewerIndicator 
  profileId={beneficiary.id}
  variant="detailed"
  popularThreshold={10}
/>
```
Displays full card with popular badge and tab count

**Props:**
- `profileId` (required) - Beneficiary ID to track
- `variant` - "minimal" | "badge" | "detailed" (default: "badge")
- `showWhenZero` - Show when 0 viewers (default: false)
- `popularThreshold` - Viewer count for "popular" badge (default: 10)

### 3. Integration Points

**Profile Page (`src/app/sponsorships/[username]/page.tsx`):**
```typescript
// Auto-join presence when beneficiary loads
useEffect(() => {
  if (beneficiary?.id) {
    joinProfilePresence(beneficiary.id)
    return () => leaveProfilePresence(beneficiary.id)
  }
}, [beneficiary?.id])

// Display badge variant
<ViewerIndicator 
  profileId={beneficiary.id}
  variant="badge"
  popularThreshold={5}
/>
```

**List View (`src/app/sponsorships/components/SponsorshipCard/index.tsx`):**
```typescript
// Minimal indicator in top-left corner
<Box position="absolute" top="2" left="2" zIndex={10}>
  <ViewerIndicator
    profileId={beneficiary.id}
    variant="minimal"
    showWhenZero={false}
  />
</Box>
```

## Data Flow

### Join Flow
```
1. User opens profile page
2. useEffect calls joinProfilePresence(profileId)
3. Creates Supabase channel: `presence:${profileId}`
4. Tracks user presence with session data
5. Subscribes to sync/join/leave events
6. Broadcasts to all viewers of this profile
7. All clients update their viewer count
```

### Leave Flow
```
1. User closes tab or navigates away
2. useEffect cleanup calls leaveProfilePresence(profileId)
3. Untracks user from channel
4. Broadcasts leave event
5. All clients update their viewer count
6. Channel cleaned up
```

### Count Update Flow (Throttled)
```
1. Presence event received (join/leave/sync)
2. Extract current presence state
3. Schedule update with 500ms throttle
4. Calculate unique viewers (deduplicate by user_id)
5. Update React state
6. Component re-renders with new count
```

## Performance Optimizations

### Throttling
- Updates throttled to max 500ms
- Prevents excessive re-renders
- Batches rapid join/leave events

### Channel Management
- One channel per profile (not global)
- Only active for profiles being viewed
- Auto-cleanup on unmount

### Deduplication
- Tracks unique `user_id` (not sessions)
- Same user in multiple tabs = 1 unique viewer
- Provides both `total` (tabs) and `unique` (users)

## Presence Data Structure

### Tracked State
```typescript
{
  user_id: "anonymous_abc123",    // Anonymous or logged-in ID
  viewing_at: 1699123456789,      // Timestamp
  profile_id: "uuid-here",        // Beneficiary ID
  session_id: "session_xyz_789"   // Unique per tab
}
```

### Viewer Count
```typescript
{
  total: 5,      // Total tabs viewing
  unique: 3,     // Unique users
  anonymous: 2   // Anonymous users
}
```

## Privacy Considerations

### Anonymous Tracking
- No PII collected for anonymous users
- Session IDs are random, not traceable
- User IDs stored in sessionStorage only
- No server-side logging of viewer identities

### Data Retention
- Presence data exists only in memory
- No database storage
- Automatically cleared when user leaves
- 30-second heartbeat timeout

## Configuration

### Environment Variables
None required! Uses existing Supabase configuration.

### Supabase Requirements
1. ✅ Realtime enabled (already configured for reservations)
2. ✅ Presence feature enabled
3. ✅ No additional RLS policies needed

## Testing

### Manual Testing

**Test 1: Single User**
1. Open a profile page
2. Verify indicator shows "1 viewer"
3. Open same profile in new tab
4. Verify count increases to "2 viewers" (but 1 unique)
5. Close one tab
6. Verify count decreases

**Test 2: Multiple Users**
1. Open profile in Browser A
2. Open same profile in Browser B (different session)
3. Verify both show "2 viewers"
4. Close Browser A
5. Verify Browser B shows "1 viewer"

**Test 3: List View**
1. Navigate to sponsorships list
2. Verify minimal indicators on cards
3. Open a profile
4. Return to list
5. Verify that profile's card shows updated count

**Test 4: Popular Badge**
1. Open profile in 5+ browsers (or tabs with different sessions)
2. Verify 🔥 "Popular now" badge appears
3. Close browsers until below threshold
4. Verify badge disappears

### Browser Console Logs

Expected logs:
```
[Presence] Joining presence for profile: uuid-here
[Presence] Channel uuid-here status: SUBSCRIBED
[Presence] Sync for uuid-here: 1 viewers
[Presence] User joined uuid-here: {...}
[Presence] User left uuid-here: {...}
```

## Troubleshooting

### Issue: Viewer count not updating

**Check:**
1. Browser console for `[Presence]` logs
2. Supabase dashboard → Realtime → Active connections
3. Network tab for WebSocket connection
4. No errors in console

**Solutions:**
- Hard refresh (Cmd+Shift+R)
- Check Supabase Realtime is enabled
- Verify no ad blockers blocking WebSocket

### Issue: Count shows wrong number

**Likely Causes:**
- Multiple tabs same user = expected (shows total tabs)
- Check `unique` vs `total` in detailed variant
- Stale sessions from crashes (will timeout in 30s)

**Debug:**
```typescript
// Add to component
const viewerCount = getViewerCount(profileId)
console.log('Viewer count:', viewerCount)
// Check total vs unique
```

### Issue: Performance slow with many profiles

**Optimization:**
- List view only displays counts (doesn't join presence)
- Only profile page joins presence
- Channels are per-profile (isolated)
- Consider lazy loading indicators

## Monitoring

### Metrics to Track

**User Engagement:**
- Average viewers per profile
- Peak concurrent viewers
- Most popular profiles
- Average view duration

**Performance:**
- WebSocket connection stability
- Presence join/leave latency
- Memory usage per channel
- Update propagation time

**Technical:**
```typescript
// Add to PresenceProvider for analytics
console.log('Active channels:', channels.current.size)
console.log('Tracked profiles:', Object.keys(presenceState).length)
```

## Future Enhancements

### Potential Features
- [ ] Viewer list (who's viewing)
- [ ] Authenticated user names
- [ ] Historical viewer analytics
- [ ] "Trending" section based on viewer counts
- [ ] Admin dashboard with live viewer map
- [ ] Viewer demographics (if logged in)
- [ ] Push notifications for profile owners

### Analytics Integration
```typescript
// Track viewer events
analytics.track('profile_viewed', {
  profileId: beneficiary.id,
  viewerCount: getViewerCount(beneficiary.id),
  timestamp: Date.now()
})
```

## Migration Notes

### No Breaking Changes
- Feature is additive (no existing functionality modified)
- Works alongside existing reservation system
- No database migrations needed
- No API changes required

### Rollback Plan
If issues arise:
1. Remove `<PresenceProvider>` from `Providers.tsx`
2. Remove `<ViewerIndicator>` components
3. Remove imports
4. Feature gracefully degrades (no errors)

## Best Practices

### Do's ✅
- Always join presence in useEffect
- Always cleanup in useEffect return
- Use minimal variant in list views
- Throttle updates appropriately
- Handle zero viewers gracefully

### Don'ts ❌
- Don't join presence for every card in list
- Don't update state on every presence event
- Don't track PII in presence state
- Don't forget cleanup on unmount
- Don't create global channels (per-profile only)

## Support

For issues or questions:
1. Check browser console for errors
2. Verify Supabase Realtime is working
3. Test with incognito windows
4. Review this documentation
5. Contact development team

---

**Last Updated:** November 6, 2025
**Version:** 1.0.0
**Status:** ✅ Production Ready
