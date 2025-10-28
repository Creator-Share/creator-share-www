import React, { createContext, useContext, useState, useEffect, useCallback } from "react"

interface SponsorshipReservation {
  timestamp: number
  userId?: string
}

interface SponsorshipContextType {
  sponsorshipInProgress: Set<string>
  setSponsorshipInProgress: (beneficiaryId: string, inProgress: boolean, userId?: string) => void
  getReservationInfo: (beneficiaryId: string) => SponsorshipReservation | null
  clearExpiredReservations: () => void
}

const SponsorshipContext = createContext<SponsorshipContextType | undefined>(undefined)

export const useSponsorship = () => {
  const context = useContext(SponsorshipContext)
  if (!context) {
    throw new Error('useSponsorship must be used within a SponsorshipProvider')
  }
  return context
}

export const SponsorshipProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [sponsorshipInProgress, setSponsorshipInProgressState] = useState<Set<string>>(new Set())
  const [reservations, setReservations] = useState<Map<string, SponsorshipReservation>>(new Map())
  const RESERVATION_TIMEOUT_MS = parseInt(process.env.NEXT_PUBLIC_RESERVATION_TIMEOUT_MINUTES || "15", 10) * 60 * 1000

  // Load sponsorship state and reservations from localStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        // Load simple sponsorship state (backward compatibility)
        const savedState = localStorage.getItem('sponsorship-in-progress')
        if (savedState) {
          const beneficiaryIds = JSON.parse(savedState)
          setSponsorshipInProgressState(new Set(beneficiaryIds))
        }

        // Load reservations with timestamps
        const savedReservations = localStorage.getItem('sponsorship-reservations')
        if (savedReservations) {
          const reservationsData = JSON.parse(savedReservations)
          const reservationsMap = new Map<string, SponsorshipReservation>()
          
          Object.entries(reservationsData).forEach(([beneficiaryId, reservation]) => {
            const reservationObj = reservation as SponsorshipReservation
            // Check if reservation is still valid (not expired)
            if (Date.now() - reservationObj.timestamp < RESERVATION_TIMEOUT_MS) {
              reservationsMap.set(beneficiaryId, reservationObj)
              setSponsorshipInProgressState(prev => new Set([...prev, beneficiaryId]))
            }
          })
          
          setReservations(reservationsMap)
        }
      } catch (error) {
        console.error('Error loading sponsorship state:', error)
      }
    }
  }, [RESERVATION_TIMEOUT_MS])

  // Save sponsorship state and reservations to localStorage whenever they change
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('sponsorship-in-progress', JSON.stringify([...sponsorshipInProgress]))
        
        const reservationsData = Object.fromEntries(reservations)
        localStorage.setItem('sponsorship-reservations', JSON.stringify(reservationsData))
      } catch (error) {
        console.error('Error saving sponsorship state:', error)
      }
    }
  }, [sponsorshipInProgress, reservations])

  // Clear expired reservations periodically
  useEffect(() => {
    const cleanupInterval = setInterval(() => {
      let hasExpired = false
      const now = Date.now()
      
      setReservations(prev => {
        const updated = new Map()
        prev.forEach((reservation, beneficiaryId) => {
          if (now - reservation.timestamp < RESERVATION_TIMEOUT_MS) {
            updated.set(beneficiaryId, reservation)
          } else {
            hasExpired = true
            // Also remove from sponsorshipInProgress
            setSponsorshipInProgressState(prevSet => {
              const newSet = new Set(prevSet)
              newSet.delete(beneficiaryId)
              return newSet
            })
          }
        })
        return updated
      })
      
      if (hasExpired) {
        console.log('Cleared expired sponsorship reservations')
      }
    }, 60000) // Check every minute

    return () => clearInterval(cleanupInterval)
  }, [reservations, RESERVATION_TIMEOUT_MS])

  const setSponsorshipInProgress = useCallback((beneficiaryId: string, inProgress: boolean, userId?: string) => {
    setSponsorshipInProgressState(prev => {
      const newSet = new Set(prev)
      if (inProgress) {
        newSet.add(beneficiaryId)
        // Create reservation with timestamp
        setReservations(prev => {
          const updated = new Map(prev)
          updated.set(beneficiaryId, { timestamp: Date.now(), userId })
          return updated
        })
      } else {
        newSet.delete(beneficiaryId)
        // Remove reservation
        setReservations(prev => {
          const updated = new Map(prev)
          updated.delete(beneficiaryId)
          return updated
        })
      }
      return newSet
    })
  }, [])

  const getReservationInfo = useCallback((beneficiaryId: string): SponsorshipReservation | null => {
    return reservations.get(beneficiaryId) || null
  }, [reservations])

  const clearExpiredReservations = useCallback(() => {
    const now = Date.now()
    setReservations(prev => {
      const updated = new Map()
      prev.forEach((reservation, beneficiaryId) => {
        if (now - reservation.timestamp < RESERVATION_TIMEOUT_MS) {
          updated.set(beneficiaryId, reservation)
        } else {
          // Also remove from sponsorshipInProgress
          setSponsorshipInProgressState(prevSet => {
            const newSet = new Set(prevSet)
            newSet.delete(beneficiaryId)
            return newSet
          })
        }
      })
      return updated
    })
  }, [RESERVATION_TIMEOUT_MS])

  const contextValue = {
    sponsorshipInProgress,
    setSponsorshipInProgress,
    getReservationInfo,
    clearExpiredReservations
  }

  return (
    <SponsorshipContext.Provider value={contextValue}>
      {children}
    </SponsorshipContext.Provider>
  )
}