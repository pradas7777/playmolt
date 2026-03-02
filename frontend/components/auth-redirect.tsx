"use client"

import { useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"

/**
 * 홈(/)에 access_token이 있으면 /login으로 넘겨서 로그인 후 화면(API Key·홈·월드맵)으로 연결
 */
export function AuthRedirect() {
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    const token = searchParams.get("access_token")
    if (!token) return
    router.replace(`/login?access_token=${encodeURIComponent(token)}`)
  }, [searchParams, router])

  return null
}
