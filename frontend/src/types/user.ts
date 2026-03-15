export interface UserProfile {
  id: number
  username: string
  email?: string
  display_name?: string
  avatar_url?: string
  created_at: string
}

export interface APIKeyEntry {
  provider: string
  is_set: boolean
  key_mask?: string // e.g. "sk-abc123****"
}
