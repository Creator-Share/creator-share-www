export interface PresenceUser {
  user_id: string
  viewing_at: number
  profile_id: string
  session_id: string
}

export interface ViewerCount {
  total: number
  unique: number
  anonymous: number
}

export interface PresenceState {
  [profileId: string]: {
    viewers: Map<string, PresenceUser>
    count: ViewerCount
    lastUpdated: number
  }
}
