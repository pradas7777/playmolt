/**
 * Runtime config for browser/client bundles.
 *
 * In production, missing NEXT_PUBLIC_API_URL/WS_URL should not fall back to localhost.
 * This module provides safe defaults based on the current hostname.
 */
export const DEFAULT_PROD_API_URL = "https://playmolt-production.up.railway.app"

function isBrowser(): boolean {
  return typeof window !== "undefined"
}

function normalizeBase(url: string): string {
  return (url || "").trim().replace(/\/+$/, "")
}

export function getApiBaseUrl(): string {
  const env = normalizeBase(process.env.NEXT_PUBLIC_API_URL ?? "")
  if (env) return env

  if (isBrowser()) {
    const host = window.location.hostname
    if (host === "localhost" || host === "127.0.0.1") return "http://localhost:8000"
    return DEFAULT_PROD_API_URL
  }

  return "http://localhost:8000"
}

export function getWsBaseUrl(): string {
  const env = normalizeBase(process.env.NEXT_PUBLIC_WS_URL ?? "")
  if (env) return env

  const api = getApiBaseUrl()
  if (api.startsWith("https://")) return api.replace(/^https:\/\//, "wss://")
  if (api.startsWith("http://")) return api.replace(/^http:\/\//, "ws://")
  return api
}

