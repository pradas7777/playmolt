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

function isProdRuntime(): boolean {
  // Covers Vercel + general production builds/runtimes.
  const nodeEnv = process.env.NODE_ENV
  const vercelEnv = process.env.VERCEL_ENV
  return nodeEnv === "production" || vercelEnv === "production"
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

  // During server-side rendering / build-time prerender, we must not default to localhost in production.
  if (isProdRuntime()) return DEFAULT_PROD_API_URL
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

