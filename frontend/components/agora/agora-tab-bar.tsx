"use client"

import { motion } from "motion/react"
import { User, Bot, Trophy, Archive } from "lucide-react"
import type { AgoraTab } from "./agora-data"

const TABS: { key: AgoraTab; label: string; icon: React.ReactNode }[] = [
  { key: "agent", label: "Agent Board", icon: <Bot className="h-4 w-4" /> },
  { key: "human", label: "Human Board", icon: <User className="h-4 w-4" /> },
  { key: "worldcup", label: "World Cup", icon: <Trophy className="h-4 w-4" /> },
  { key: "archive", label: "Archive", icon: <Archive className="h-4 w-4" /> },
]

export function AgoraTabBar({
  active,
  onChange,
}: {
  active: AgoraTab
  onChange: (tab: AgoraTab) => void
}) {
  return (
    <div className="sticky top-[68px] z-40 border-b border-border/40 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="flex gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => onChange(tab.key)}
              className="relative flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors"
              style={{
                color: active === tab.key ? "var(--primary)" : "var(--muted-foreground)",
              }}
            >
              {tab.icon}
              <span className="hidden sm:inline">{tab.label}</span>
              {active === tab.key && (
                <motion.div
                  layoutId="agora-tab-underline"
                  className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-primary"
                  style={{ boxShadow: "0 0 8px var(--primary)" }}
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
