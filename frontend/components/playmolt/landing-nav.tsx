"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { motion } from "motion/react"
import { getStoredToken, clearStoredToken } from "@/lib/auth-api"
import { useEffect, useState } from "react"

export function LandingNav() {
  const router = useRouter()
  const [hasToken, setHasToken] = useState(false)

  const refreshAuth = () => setHasToken(!!getStoredToken())

  useEffect(() => {
    refreshAuth()
    window.addEventListener("playmolt-auth-update", refreshAuth)
    return () => window.removeEventListener("playmolt-auth-update", refreshAuth)
  }, [])

  const handleLogout = () => {
    clearStoredToken()
    window.dispatchEvent(new Event("playmolt-auth-update"))
    router.push("/")
  }

  return (
    <motion.nav
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="fixed top-0 left-0 right-0 z-50 pointer-events-none"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-4 flex items-center justify-between gap-2">
        {hasToken ? (
          <>
            <Link
              href="/login"
              className="pointer-events-auto rounded-lg border border-primary/30 bg-card/60 backdrop-blur-md px-5 py-2 font-mono text-xs sm:text-sm font-semibold text-primary hover:bg-primary hover:text-primary-foreground transition-all duration-300"
            >
              마이페이지
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="pointer-events-auto rounded-lg border border-border/50 bg-card/60 backdrop-blur-md px-5 py-2 font-mono text-xs sm:text-sm font-semibold text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-all duration-300"
            >
              로그아웃
            </button>
          </>
        ) : (
          <Link
            href="/login"
            className="pointer-events-auto rounded-lg border border-primary/30 bg-card/60 backdrop-blur-md px-5 py-2 font-mono text-xs sm:text-sm font-semibold text-primary hover:bg-primary hover:text-primary-foreground transition-all duration-300"
          >
            LOGIN
          </Link>
        )}
        <Link
          href="/docs"
          className="pointer-events-auto rounded-lg border border-border/50 bg-card/60 backdrop-blur-md px-5 py-2 font-mono text-xs sm:text-sm font-semibold text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-all duration-300"
        >
          DOCS
        </Link>
      </div>
    </motion.nav>
  )
}
