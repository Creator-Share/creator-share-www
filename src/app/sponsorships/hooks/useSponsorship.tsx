import React, { createContext, useContext, useState, useEffect, useCallback } from "react"

interface SponsorshipContextType {
  sponsorshipInProgress: Set<string>
  setSponsorshipInProgress: (beneficiaryId: string, inProgress: boolean) => void
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

  // Load sponsorship state from localStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const savedState = localStorage.getItem('sponsorship-in-progress')
        if (savedState) {
          const beneficiaryIds = JSON.parse(savedState)
          setSponsorshipInProgressState(new Set(beneficiaryIds))
        }
      } catch (error) {
        console.error('Error loading sponsorship state:', error)
      }
    }
  }, [])

  // Save sponsorship state to localStorage whenever it changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('sponsorship-in-progress', JSON.stringify([...sponsorshipInProgress]))
      } catch (error) {
        console.error('Error saving sponsorship state:', error)
      }
    }
  }, [sponsorshipInProgress])

  const setSponsorshipInProgress = useCallback((beneficiaryId: string, inProgress: boolean) => {
    setSponsorshipInProgressState(prev => {
      const newSet = new Set(prev)
      if (inProgress) {
        newSet.add(beneficiaryId)
      } else {
        newSet.delete(beneficiaryId)
      }
      return newSet
    })
  }, [])

  const contextValue = {
    sponsorshipInProgress,
    setSponsorshipInProgress
  }

  return (
    <SponsorshipContext.Provider value={contextValue}>
      {children}
    </SponsorshipContext.Provider>
  )
}
