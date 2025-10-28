"use client"

import React, { createContext, useContext, useState, useEffect, useCallback } from "react"
import { createClient } from "@/utils/supabase/client"
import type { RealtimeChannel } from "@supabase/supabase-js"

interface ReservationData {
  beneficiary_id: string
  expires_at: string
  reservation_token: string
  user_id: string | null
}

interface ReservationStatus {
  reserved: boolean
  mine?: boolean
  ttlMs?: number
  userId?: string | null
}

interface ReservationsContextType {
  getReservationStatus: (beneficiaryId: string) => ReservationStatus
  cleanupExpiredReservations: () => void
  isLoading: boolean
}

const ReservationsContext = createContext<ReservationsContextType | undefined>(undefined)

export const useReservations = () => {
  const context = useContext(ReservationsContext)
  if (!context) {
    throw new Error('useReservations must be used within a ReservationsProvider')
  }
  return context
}

export const ReservationsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [reservations, setReservations] = useState<Map<string, ReservationData>>(new Map())
  const [, setChannel] = useState<RealtimeChannel | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [supabase] = useState(() => createClient())

  // Get current reservation status for a beneficiary
  const getReservationStatus = (beneficiaryId: string): ReservationStatus => {
    const reservation = reservations.get(beneficiaryId)
    
    if (!reservation) {
      return { reserved: false }
    }

    const now = new Date().getTime()
    const expiresAt = new Date(reservation.expires_at).getTime()
    
    // Check if expired - don't update state during render, let periodic cleanup handle it
    if (expiresAt <= now) {
      console.log(`[Real-time] Reservation for ${beneficiaryId} is expired (${now - expiresAt}ms ago)`)
      return { reserved: false }
    }

    const ttlMs = expiresAt - now
    console.log(`[Real-time] Reservation for ${beneficiaryId} is active (${Math.floor(ttlMs/1000)}s remaining)`)
    
    return {
      reserved: true,
      ttlMs,
      userId: reservation.user_id,
    }
  }

  // Load initial reservations and subscribe
  useEffect(() => {
    let mounted = true
    let activeChannel: RealtimeChannel | null = null

    const initialize = async () => {
      try {
        // Load initial active reservations
        const { data, error } = await supabase
          .from('beneficiary_reservations')
          .select('beneficiary_id, expires_at, reservation_token, user_id')
          .gt('expires_at', new Date().toISOString())

        if (error) {
          console.error('Error loading initial reservations:', error)
        } else if (data && mounted) {
          const reservationsMap = new Map<string, ReservationData>()
          data.forEach(reservation => {
            reservationsMap.set(reservation.beneficiary_id, {
              beneficiary_id: reservation.beneficiary_id,
              expires_at: reservation.expires_at,
              reservation_token: reservation.reservation_token,
              user_id: reservation.user_id,
            })
          })
          setReservations(reservationsMap)
          console.log(`[Real-time] Loaded ${data.length} active reservations`)
        }

        // Subscribe to real-time changes
        activeChannel = supabase
          .channel('beneficiary_reservations_changes')
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'beneficiary_reservations',
            },
            (payload) => {
              if (!mounted) return

              console.log('[Real-time] Reservation change:', payload.eventType, payload)
              
              const { eventType, new: newRecord, old: oldRecord } = payload

              if (eventType === 'INSERT' && newRecord) {
                setReservations(prev => {
                  const updated = new Map(prev)
                  updated.set(newRecord.beneficiary_id, {
                    beneficiary_id: newRecord.beneficiary_id,
                    expires_at: newRecord.expires_at,
                    reservation_token: newRecord.reservation_token,
                    user_id: newRecord.user_id,
                  })
                  return updated
                })
              } else if (eventType === 'DELETE' && oldRecord) {
                setReservations(prev => {
                  const updated = new Map(prev)
                  updated.delete(oldRecord.beneficiary_id)
                  return updated
                })
              } else if (eventType === 'UPDATE' && newRecord) {
                setReservations(prev => {
                  const updated = new Map(prev)
                  updated.set(newRecord.beneficiary_id, {
                    beneficiary_id: newRecord.beneficiary_id,
                    expires_at: newRecord.expires_at,
                    reservation_token: newRecord.reservation_token,
                    user_id: newRecord.user_id,
                  })
                  return updated
                })
              }
            }
          )
          .subscribe((status) => {
            console.log('[Real-time] Subscription status:', status)
            if (mounted && status === 'SUBSCRIBED') {
              setIsLoading(false)
            }
          })

        if (mounted) {
          setChannel(activeChannel)
        }
      } catch (error) {
        console.error('[Real-time] Initialization error:', error)
        if (mounted) {
          setIsLoading(false)
        }
      }
    }

    initialize()

    // Cleanup on unmount
    return () => {
      mounted = false
      if (activeChannel) {
        console.log('[Real-time] Unsubscribing from channel')
        supabase.removeChannel(activeChannel)
      }
    }
  }, [supabase])

  // Clean up expired reservations periodically (fallback)
  useEffect(() => {
    const cleanupInterval = setInterval(() => {
      const now = new Date().getTime()
      setReservations(prev => {
        const updated = new Map()
        let cleaned = 0
        prev.forEach((reservation, beneficiaryId) => {
          const expiresAt = new Date(reservation.expires_at).getTime()
          if (expiresAt > now) {
            updated.set(beneficiaryId, reservation)
          } else {
            cleaned++
          }
        })
        if (cleaned > 0) {
          console.log(`[Real-time] Cleaned up ${cleaned} expired reservations`)
        }
        return updated
      })
    }, 5000) // Check every 5 seconds for more responsive cleanup

    return () => clearInterval(cleanupInterval)
  }, [])

  // Manual cleanup function for immediate expired reservation removal
  const cleanupExpiredReservations = useCallback(async () => {
    try {
      // Call API to force database cleanup (triggers real-time DELETE events)
      const response = await fetch('/api/sponsorships/reservations')
      if (response.ok) {
        const data = await response.json()
        console.log(`[Real-time] Database cleanup completed: ${data.activeReservations} active reservations`)
      }
    } catch (error) {
      console.error('[Real-time] Failed to call cleanup API:', error)
      
      // Fallback to local cleanup if API fails
      const now = new Date().getTime()
      setReservations(prev => {
        const updated = new Map()
        let cleaned = 0
        prev.forEach((reservation, beneficiaryId) => {
          const expiresAt = new Date(reservation.expires_at).getTime()
          if (expiresAt > now) {
            updated.set(beneficiaryId, reservation)
          } else {
            cleaned++
            console.log(`[Real-time] Fallback cleanup: removed expired reservation for ${beneficiaryId}`)
          }
        })
        if (cleaned > 0) {
          console.log(`[Real-time] Fallback cleanup: removed ${cleaned} expired reservations`)
        }
        return updated
      })
    }
  }, [])

  const contextValue = {
    getReservationStatus,
    cleanupExpiredReservations,
    isLoading,
  }

  return (
    <ReservationsContext.Provider value={contextValue}>
      {children}
    </ReservationsContext.Provider>
  )
}

