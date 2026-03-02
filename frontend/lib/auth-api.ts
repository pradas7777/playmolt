/**
 * Auth API: 토큰 저장/조회, /api/auth/me, /api/auth/api-key
 * 백엔드: JWT Bearer (Authorization header)
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"
const TOKEN_KEY = "playmolt_access_token"
const API_KEY_STORAGE_KEY = "playmolt_api_key_value"

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null
  return localStorage.getItem(TOKEN_KEY)
}

export function setStoredToken(token: string): void {
  if (typeof window === "undefined") return
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearStoredToken(): void {
  if (typeof window === "undefined") return
  localStorage.removeItem(TOKEN_KEY)
}

/** 발급 시 한 번만 받은 API Key를 마이페이지 표시용으로 로컬 저장 (선택) */
export function getStoredApiKey(): string | null {
  if (typeof window === "undefined") return null
  return localStorage.getItem(API_KEY_STORAGE_KEY)
}

export function setStoredApiKey(apiKey: string): void {
  if (typeof window === "undefined") return
  localStorage.setItem(API_KEY_STORAGE_KEY, apiKey)
}

export function clearStoredApiKey(): void {
  if (typeof window === "undefined") return
  localStorage.removeItem(API_KEY_STORAGE_KEY)
}

export interface UserMe {
  id: string
  email: string
  username: string
  has_api_key: boolean
}

export async function fetchMe(token: string): Promise<UserMe> {
  const res = await fetch(`${API_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json() as Promise<UserMe>
}

export interface ApiKeyInfo {
  has_api_key: boolean
  api_key_last4: string | null
}

export async function fetchApiKeyInfo(token: string): Promise<ApiKeyInfo> {
  const res = await fetch(`${API_URL}/api/auth/api-key`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json() as Promise<ApiKeyInfo>
}

export interface ApiKeyResponse {
  api_key: string
  message?: string
}

export async function issueApiKey(token: string): Promise<ApiKeyResponse> {
  const res = await fetch(`${API_URL}/api/auth/api-key`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const text = await res.text()
    try {
      const j = JSON.parse(text)
      throw new Error(j.detail ?? text)
    } catch (e) {
      if (e instanceof Error) throw e
      throw new Error(text)
    }
  }
  return res.json() as Promise<ApiKeyResponse>
}

/** 팝업으로 열 때 사용할 구글 로그인 URL (백엔드 리디렉트) */
export function getGoogleLoginUrl(): string {
  return `${API_URL}/api/auth/google`
}
