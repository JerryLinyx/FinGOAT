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
  return { 'Content-Type': 'application/json', Authorization: bearer }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    throw new Error(body.error ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export interface ProviderBreakdown {
  provider: string
  tokens: number
  cost: number
  tasks: number
}

export interface UsageSummary {
  total_tokens: number
  total_cost: number
  total_tasks: number
  by_provider: ProviderBreakdown[]
}

export interface AdminUsageSummary {
  total_tokens: number
  total_cost: number
  total_tasks: number
  total_users: number
}

export interface AdminUserUsage {
  user_id: number
  username: string
  role: string
  tokens: number
  cost: number
  tasks: number
}

export async function getUserUsageSummary(): Promise<UsageSummary> {
  const res = await fetch(`${API_BASE_URL}/api/usage/summary`, {
    headers: getAuthHeaders(),
  })
  return handleResponse<UsageSummary>(res)
}

export async function getAdminUsageSummary(): Promise<AdminUsageSummary> {
  const res = await fetch(`${API_BASE_URL}/api/admin/usage/summary`, {
    headers: getAuthHeaders(),
  })
  return handleResponse<AdminUsageSummary>(res)
}

export async function getAdminUserUsage(): Promise<AdminUserUsage[]> {
  const res = await fetch(`${API_BASE_URL}/api/admin/usage/users`, {
    headers: getAuthHeaders(),
  })
  const data = await handleResponse<{ users: AdminUserUsage[] }>(res)
  return data.users
}
