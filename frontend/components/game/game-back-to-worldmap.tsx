"use client"

import Link from "next/link"
import { Map } from "lucide-react"

/** 게임/리플레이 화면용 간단 네비게이션 - 월드맵으로 돌아가기 버튼 */
export function GameBackToWorldmap() {
  return (
    <Link
      href="/worldmap"
      className="fixed top-4 right-4 z-50 flex items-center gap-2 rounded-xl border border-white/20 bg-black/60 backdrop-blur-md px-4 py-2.5 text-sm font-medium text-white/90 shadow-lg hover:bg-black/80 hover:text-white hover:border-white/30 transition-all duration-200"
    >
      <Map className="h-4 w-4 shrink-0" />
      <span>월드맵으로 돌아가기</span>
    </Link>
  )
}
