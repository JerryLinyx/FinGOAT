const rawApiUrl = import.meta.env.VITE_API_URL
const API_BASE_URL = rawApiUrl ? rawApiUrl.replace(/\/$/, '') : ''
const TOKEN_STORAGE_KEY = 'fingoat_token'

type FeedTab = 'for-you' | 'following' | 'ai' | 'macro' | 'earnings' | 'stocks' | 'saved'

export interface FeedSource {
  id: number
  name: string
  base_url: string
  source_type: string
  fetch_mode: string
  priority: number
}

export interface FeedPreferences {
  topics: string[]
  tickers: string[]
  sources: string[]
}

export interface FeedItem {
  id: number
  title: string
  excerpt: string
  canonical_url: string
  cover_image_url?: string
  published_at?: string
  source_id: number
  source_name: string
  source_type: string
  primary_topic?: string
  primary_ticker?: string
  content_type: string
  topics?: string[]
  tickers?: string[]
  like_count: number
  save_count: number
  liked: boolean
  saved: boolean
  preference_hit: boolean
  source_priority: number
}

export interface FeedResponse {
  items: FeedItem[]
  next_cursor?: string
}

function getAuthHeaders(): HeadersInit {
  const token = localStorage.getItem(TOKEN_STORAGE_KEY)
  const bearer = token
    ? token.startsWith('Bearer ')
      ? token
      : `Bearer ${token}`
    : ''

  return {
    'Content-Type': 'application/json',
    Authorization: bearer,
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: `HTTP ${response.status}` }))
    const error = new Error(body.error ?? `HTTP ${response.status}`) as Error & { status?: number }
    error.status = response.status
    throw error
  }
  return response.json() as Promise<T>
}

class FeedService {
  async getBoard(params: {
    tab: FeedTab
    source?: string
    cursor?: string
    limit?: number
  }): Promise<FeedResponse> {
    const url = new URL(`${API_BASE_URL}/api/feed`, window.location.origin)
    url.searchParams.set('tab', params.tab)
    if (params.source && params.source !== 'all') {
      url.searchParams.set('source', params.source)
    }
    if (params.cursor) {
      url.searchParams.set('cursor', params.cursor)
    }
    if (params.limit) {
      url.searchParams.set('limit', String(params.limit))
    }

    const response = await fetch(url.toString(), {
      headers: getAuthHeaders(),
    })
    return handleResponse<FeedResponse>(response)
  }

  async getSources(): Promise<FeedSource[]> {
    const response = await fetch(`${API_BASE_URL}/api/feed/sources`, {
      headers: getAuthHeaders(),
    })
    const payload = await handleResponse<{ sources: FeedSource[] }>(response)
    return payload.sources
  }

  async getPreferences(): Promise<FeedPreferences> {
    const response = await fetch(`${API_BASE_URL}/api/feed/preferences`, {
      headers: getAuthHeaders(),
    })
    return handleResponse<FeedPreferences>(response)
  }

  async savePreferences(payload: FeedPreferences): Promise<FeedPreferences> {
    const response = await fetch(`${API_BASE_URL}/api/feed/preferences`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
    })
    return handleResponse<FeedPreferences>(response)
  }

  async toggleLike(itemId: number): Promise<{ id: number; liked: boolean; count: number }> {
    const response = await fetch(`${API_BASE_URL}/api/feed/items/${itemId}/like`, {
      method: 'POST',
      headers: getAuthHeaders(),
    })
    return handleResponse<{ id: number; liked: boolean; count: number }>(response)
  }

  async toggleSave(itemId: number): Promise<{ id: number; saved: boolean; count: number }> {
    const response = await fetch(`${API_BASE_URL}/api/feed/items/${itemId}/save`, {
      method: 'POST',
      headers: getAuthHeaders(),
    })
    return handleResponse<{ id: number; saved: boolean; count: number }>(response)
  }
}

export const feedService = new FeedService()
export type { FeedTab }
