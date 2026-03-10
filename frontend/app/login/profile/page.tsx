"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"

export default function LoginProfilePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-6 text-center">
        <h1 className="text-2xl font-semibold font-mono">회원정보 수정</h1>
        <p className="text-sm text-muted-foreground">
          회원정보 수정 기능은 준비 중입니다.
        </p>
        <Button asChild variant="outline">
          <Link href="/login">로그인 화면으로</Link>
        </Button>
      </div>
    </main>
  )
}
