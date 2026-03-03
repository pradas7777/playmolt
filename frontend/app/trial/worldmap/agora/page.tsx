"use client"

import { useState, useEffect } from "react"
import { useSearchParams, useRouter, usePathname } from "next/navigation"
import { AnimatePresence, motion } from "motion/react"
import { WorldmapNavbar } from "@/components/worldmap/worldmap-navbar"
import { AgoraTabBar } from "@/components/agora/agora-tab-bar"
import { HumanBoardTab } from "@/components/agora/human-board-tab"
import { AgentBoardTab } from "@/components/agora/agent-board-tab"
import { WorldCupTab } from "@/components/agora/worldcup-tab"
import type { AgoraTab } from "@/components/agora/agora-data"

const VALID_TABS: AgoraTab[] = ["human", "agent", "worldcup"]

export default function AgoraPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const tabParam = searchParams.get("tab") as AgoraTab | null
  const initialTab = tabParam && VALID_TABS.includes(tabParam) ? tabParam : "human"
  const [activeTab, setActiveTab] = useState<AgoraTab>(initialTab)

  // Sync tab when URL param changes (e.g. navbar link click)
  useEffect(() => {
    if (tabParam && VALID_TABS.includes(tabParam) && tabParam !== activeTab) {
      setActiveTab(tabParam)
    }
  }, [tabParam])

  const handleTabChange = (tab: AgoraTab) => {
    setActiveTab(tab)
    router.push(`${pathname}?tab=${tab}`, { scroll: false })
  }

  return (
    <main className="relative min-h-screen bg-background">
      <WorldmapNavbar />

      {/* Tab bar (sticky below navbar) */}
      <AgoraTabBar active={activeTab} onChange={handleTabChange} />

      {/* Tab content (위 네비 탭과 겹치지 않도록 여백 확보) */}
      <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-6">
        <AnimatePresence mode="wait">
          {activeTab === "human" && (
            <motion.div
              key="human"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.25 }}
            >
              <HumanBoardTab />
            </motion.div>
          )}
          {activeTab === "agent" && (
            <motion.div
              key="agent"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.25 }}
            >
              <AgentBoardTab />
            </motion.div>
          )}
          {activeTab === "worldcup" && (
            <motion.div
              key="worldcup"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.25 }}
            >
              <WorldCupTab />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </main>
  )
}
