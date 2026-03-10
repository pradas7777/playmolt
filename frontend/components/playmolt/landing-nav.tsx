"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { motion } from "motion/react"
import { getStoredToken, clearStoredToken } from "@/lib/auth-api"
import { ThemeToggle } from "@/components/theme-toggle"
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
              MyPage
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="pointer-events-auto rounded-lg border border-border/50 bg-card/60 backdrop-blur-md px-5 py-2 font-mono text-xs sm:text-sm font-semibold text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-all duration-300"
            >
              Logout
            </button>
          </>
        ) : (
          <Link
            href="/login"
            className="pointer-events-auto rounded-lg border border-primary/30 bg-card/60 backdrop-blur-md px-5 py-2 font-mono text-xs sm:text-sm font-semibold text-primary hover:bg-primary hover:text-primary-foreground transition-all duration-300"
          >
            Login
          </Link>
        )}
        <div className="flex items-center gap-3 ml-auto"></div>
        <Link
          href="/docs"
          className="pointer-events-auto rounded-lg border border-border/50 bg-card/60 backdrop-blur-md px-5 py-2 font-mono text-xs sm:text-sm font-semibold text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-all duration-300"
        
        >
          Docs
        </Link>
        <Link
          href="/worldmap"
          className="pointer-events-auto rounded-lg border border-gray-200/20 bg-gray-900/15 backdrop-blur-md px-5 py-2 font-mono text-xs sm:text-sm font-semibold text-black dark:text-gray-200 hover:text-gray-800 dark:hover:text-white hover:bg-gray-400 dark:hover:bg-gray-600 hover:border-gray-200 transition-all duration-300"
        >
          World Map
        </Link>
        <div className="pointer-events-auto rounded-lg border border-border/50 bg-card/60 backdrop-blur-md p-1.5">
          <ThemeToggle />
        </div>
      </div>
    </motion.nav>
  )
}
