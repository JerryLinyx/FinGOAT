import type { UserProfile, APIKeyEntry } from '../types/user'

const rawApiUrl = import.meta.env.VITE_API_URL
const API_BASE_URL = rawApiUrl ? rawApiUrl.replace(/\/$/, '') : ''
const TOKEN_STORAGE_KEY = 'fingoat_token'

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

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    throw new Error(body.error ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export async function getProfile(): Promise<UserProfile> {
  const res = await fetch(`${API_BASE_URL}/api/user/profile`, {
    headers: getAuthHeaders(),
  })
  return handleResponse<UserProfile>(res)
}

export async function updateProfile(data: {
  display_name?: string
  avatar_url?: string
}): Promise<UserProfile> {
  const res = await fetch(`${API_BASE_URL}/api/user/profile`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(data),
  })
  return handleResponse<UserProfile>(res)
}

export async function getAPIKeys(): Promise<APIKeyEntry[]> {
  const res = await fetch(`${API_BASE_URL}/api/user/api-keys`, {
    headers: getAuthHeaders(),
  })
  const data = await handleResponse<{ api_keys: APIKeyEntry[] }>(res)
  return data.api_keys
}

export async function upsertAPIKey(provider: string, key: string): Promise<APIKeyEntry> {
  const res = await fetch(`${API_BASE_URL}/api/user/api-keys/${encodeURIComponent(provider)}`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify({ key }),
  })
  return handleResponse<APIKeyEntry>(res)
}

export async function deleteAPIKey(provider: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/user/api-keys/${encodeURIComponent(provider)}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  })
  await handleResponse<unknown>(res)
}
