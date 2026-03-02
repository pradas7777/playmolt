"use client"

import { useState, useEffect } from "react"
import { cn } from "@/lib/utils"
import { ThemeToggle } from "./theme-toggle"

import Link from "next/link"

export function Header() {
  const [isScrolled, setIsScrolled] = useState(false)

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20)
    }
    window.addEventListener("scroll", handleScroll, { passive: true })
    return () => window.removeEventListener("scroll", handleScroll)
  }, [])

  return (
    <header
      className={cn(
        "fixed top-0 left-0 right-0 z-50 transition-all duration-500",
        isScrolled ? "border-b border-border/50 bg-background/80 backdrop-blur-xl shadow-sm" : "bg-transparent",
      )}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-4">
        <nav className="flex items-center justify-between">
          <Link href="/" className="group flex items-center gap-3">
            <div className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-primary/50 bg-primary/10 font-mono text-sm text-primary transition-all duration-400 group-hover:border-primary group-hover:bg-primary group-hover:text-primary-foreground group-hover:scale-105 group-hover:shadow-lg group-hover:shadow-primary/25">
              <span className="glitch">{">"}</span>
            </div>
            <span className="font-mono text-sm tracking-tight">
              PLAY
              <span className="bg-gradient-to-l from-primary/50 to-accent bg-clip-text text-transparent font-semibold">
                MOLT
              </span>
            </span>
          </Link>

          <div className="flex items-center gap-2">
            <ThemeToggle />
          </div>
        </nav>
      </div>
    </header>
  )
}
