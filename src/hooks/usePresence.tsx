"use client"

import { createContext, useContext, useState, useEffect, useCallback, useRef } from "react"
import { createClient } from "@/utils/supabase/client"
import type { RealtimeChannel } from "@supabase/supabase-js"
import type { PresenceUser, ViewerCount, PresenceState } from "@/types/presence.types"

interface PresenceContextType {
  joinProfilePresence: (profileId: string) => void
  leaveProfilePresence: (profileId: string) => void
  getViewerCount: (profileId: string) => ViewerCount
  isViewingProfile: (profileId: string) => boolean
}

const PresenceContext = createContext<PresenceContextType | undefined>(undefined)

export const usePresence = () => {
  const context = useContext(PresenceContext)
  if (!context) {
    throw new Error("usePresence must be used within a PresenceProvider")
  }
  return context
}

// Generate session ID (unique per tab)
const getSessionId = (): string => {
  if (typeof window === "undefined") return ""
  
  let sessionId = sessionStorage.getItem("presence_session_id")
  if (!sessionId) {
    sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    sessionStorage.setItem("presence_session_id", sessionId)
  }
  return sessionId
}

// Generate user ID (anonymous or logged-in)
const getUserId = (): string => {
  if (typeof window === "undefined") return "anonymous"
  
  // Try to get from session storage first
  let userId = sessionStorage.getItem("presence_user_id")
  if (!userId) {
    // Generate anonymous ID
    userId = `anonymous_${Math.random().toString(36).substr(2, 11)}`
    sessionStorage.setItem("presence_user_id", userId)
  }
  return userId
}

export const PresenceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [presenceState, setPresenceState] = useState<PresenceState>({})
  const [supabase] = useState(() => createClient())
  const channels = useRef<Map<string, RealtimeChannel>>(new Map())
  const updateTimeouts = useRef<Map<string, NodeJS.Timeout>>(new Map())
  
  const sessionId = useRef(getSessionId())
  const userId = useRef(getUserId())

  // Calculate viewer count from presence state
  const calculateViewerCount = (viewers: Map<string, PresenceUser>): ViewerCount => {
    const uniqueUsers = new Set<string>()
    const uniqueSessions = new Set<string>()
    let anonymousCount = 0

    viewers.forEach((viewer) => {
      // Only count each user once per profile
      if (!uniqueUsers.has(viewer.user_id)) {
        uniqueUsers.add(viewer.user_id)
        if (viewer.user_id.startsWith("anonymous_")) {
          anonymousCount++
        }
      }
      uniqueSessions.add(viewer.session_id)
    })

    return {
      total: uniqueSessions.size, // Total number of open sessions/tabs
      unique: uniqueUsers.size,   // Number of unique users
      anonymous: anonymousCount,  // Number of anonymous users
    }
  }

  // Throttled update function
  const schedulePresenceUpdate = useCallback((profileId: string, newViewers: Map<string, PresenceUser>) => {
    // Clear existing timeout
    const existingTimeout = updateTimeouts.current.get(profileId)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
    }

    // Schedule new update
    const timeout = setTimeout(() => {
      setPresenceState(prev => ({
        ...prev,
        [profileId]: {
          viewers: newViewers,
          count: calculateViewerCount(newViewers),
          lastUpdated: Date.now(),
        },
      }))
      updateTimeouts.current.delete(profileId)
    }, 500) // Throttle updates to every 500ms

    updateTimeouts.current.set(profileId, timeout)
  }, [])

  // Join presence for a profile
  const joinProfilePresence = useCallback((profileId: string) => {
    if (!profileId || channels.current.has(profileId)) {
      return // Already joined
    }

    console.log(`[Presence] Joining presence for profile: ${profileId}`)

    const channel = supabase.channel(`presence:${profileId}`, {
      config: {
        presence: {
          key: sessionId.current,
        },
      },
    })

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<PresenceUser>()
        const viewers = new Map<string, PresenceUser>()

        Object.values(state).forEach((presences) => {
          presences.forEach((presence) => {
            viewers.set(presence.session_id, presence)
          })
        })

        console.log(`[Presence] Sync for ${profileId}: ${viewers.size} viewers`)
        schedulePresenceUpdate(profileId, viewers)
      })
      .on("presence", { event: "join" }, ({ newPresences }) => {
        console.log(`[Presence] User joined ${profileId}:`, newPresences)
        
        const state = channel.presenceState<PresenceUser>()
        const viewers = new Map<string, PresenceUser>()
        
        Object.values(state).forEach((presences) => {
          presences.forEach((presence) => {
            viewers.set(presence.session_id, presence)
          })
        })
        
        schedulePresenceUpdate(profileId, viewers)
      })
      .on("presence", { event: "leave" }, ({ leftPresences }) => {
        console.log(`[Presence] User left ${profileId}:`, leftPresences)
        
        const state = channel.presenceState<PresenceUser>()
        const viewers = new Map<string, PresenceUser>()
        
        Object.values(state).forEach((presences) => {
          presences.forEach((presence) => {
            viewers.set(presence.session_id, presence)
          })
        })
        
        schedulePresenceUpdate(profileId, viewers)
      })
      .subscribe(async (status) => {
        console.log(`[Presence] Channel ${profileId} status:`, status)
        
        if (status === "SUBSCRIBED") {
          // Track this user's presence
          await channel.track({
            user_id: userId.current,
            viewing_at: Date.now(),
            profile_id: profileId,
            session_id: sessionId.current,
          })
        }
      })

    channels.current.set(profileId, channel)
  }, [supabase, schedulePresenceUpdate])

  // Leave presence for a profile
  const leaveProfilePresence = useCallback((profileId: string) => {
    const channel = channels.current.get(profileId)
    if (!channel) return

    console.log(`[Presence] Leaving presence for profile: ${profileId}`)

    // Untrack and unsubscribe
    channel.untrack()
    supabase.removeChannel(channel)
    channels.current.delete(profileId)

    // Clear any pending updates
    const timeout = updateTimeouts.current.get(profileId)
    if (timeout) {
      clearTimeout(timeout)
      updateTimeouts.current.delete(profileId)
    }

    // Remove from state
    setPresenceState(prev => {
      const newState = { ...prev }
      delete newState[profileId]
      return newState
    })
  }, [supabase])

  // Get viewer count for a profile
  const getViewerCount = useCallback((profileId: string): ViewerCount => {
    const profilePresence = presenceState[profileId]
    
    if (!profilePresence) {
      return { total: 0, unique: 0, anonymous: 0 }
    }

    return profilePresence.count
  }, [presenceState])

  // Check if currently viewing a profile
  const isViewingProfile = useCallback((profileId: string): boolean => {
    return channels.current.has(profileId)
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    const channelsMap = channels.current
    const timeoutsMap = updateTimeouts.current
    
    return () => {
      // Unsubscribe from all channels
      channelsMap.forEach((channel, profileId) => {
        console.log(`[Presence] Cleaning up channel: ${profileId}`)
        channel.untrack()
        supabase.removeChannel(channel)
      })
      channelsMap.clear()

      // Clear all timeouts
      timeoutsMap.forEach(timeout => clearTimeout(timeout))
      timeoutsMap.clear()
    }
  }, [supabase])

  const contextValue = {
    joinProfilePresence,
    leaveProfilePresence,
    getViewerCount,
    isViewingProfile,
  }

  return (
    <PresenceContext.Provider value={contextValue}>
      {children}
    </PresenceContext.Provider>
  )
}
