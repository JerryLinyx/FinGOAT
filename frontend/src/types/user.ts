export interface UserProfile {
  id: number
  username: string
  email?: string
  email_verified?: boolean
  display_name?: string
  avatar_url?: string
  role: string  // "user" | "admin"
  created_at: string
}

export interface APIKeyEntry {
  provider: string
  is_set: boolean
  key_mask?: string // e.g. "sk-abc123****"
}
