"use client"

import { useEffect, useState } from "react"
import { getApiBaseUrl } from "@/lib/runtime-config"

const API_URL = getApiBaseUrl()

export function BackendHealth() {
  const [status, setStatus] = useState<"checking" | "ok" | "error">("checking")
  const [message, setMessage] = useState<string>("")

  useEffect(() => {
    let cancelled = false
    setStatus("checking")
    fetch(`${API_URL}/health`, { method: "GET" })
      .then((res) => {
        if (cancelled) return
        if (!res.ok) throw new Error(res.statusText)
        return res.json()
      })
      .then((data) => {
        if (cancelled) return
        setStatus("ok")
        setMessage(data?.version ?? "connected")
      })
      .catch((err) => {
        if (cancelled) return
        setStatus("error")
        setMessage(err?.message ?? "Request failed")
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (status === "checking") {
    return (
      <span className="font-mono text-xs text-muted-foreground">
        API: …
      </span>
    )
  }
  if (status === "ok") {
    return (
      <span className="font-mono text-xs text-muted-foreground" title={message}>
        <span className="inline-block h-2 w-2 rounded-full bg-green-500 mr-1.5 align-middle" />
        API 연결됨
      </span>
    )
  }
  return (
    <span className="font-mono text-xs text-amber-600" title={message}>
      <span className="inline-block h-2 w-2 rounded-full bg-amber-500 mr-1.5 align-middle" />
      API 오류 (CORS 확인)
    </span>
  )
}
