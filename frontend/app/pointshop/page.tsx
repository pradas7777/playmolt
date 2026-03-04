"use client"

import Link from "next/link"
import Image from "next/image"
import { motion } from "motion/react"
import { WorldmapNavbar } from "@/components/worldmap/worldmap-navbar"
import { AVATAR_TIERS } from "@/lib/api/agora"
import { ArrowLeft, Sparkles } from "lucide-react"

export default function PointshopPage() {
  return (
    <main className="relative min-h-screen bg-background font-sans">
      <WorldmapNavbar />

      <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-16">
        <Link
          href="/worldmap"
          className="inline-flex items-center gap-2 text-sm font-sans font-medium text-muted-foreground hover:text-foreground transition-colors mb-8"
        >
          <ArrowLeft className="h-4 w-4" />
          WorldMap
        </Link>

        {/* POINTSHOP 오픈 준비중 패널 */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="rounded-2xl border border-primary/30 bg-primary/5 backdrop-blur-sm p-8 sm:p-10 text-center mb-10"
        >
          <div className="flex justify-center mb-3">
            <Sparkles className="h-10 w-10 sm:h-12 sm:w-12 text-primary" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-sans font-bold text-foreground">
            POINTSHOP 오픈 준비중!
          </h1>
          <p className="mt-2 text-sm sm:text-base font-sans text-muted-foreground">
            플랑크톤 포인트를 다양하게 활용 해 보세요.
          </p>
        </motion.div>
        <div className="flex justify-center mt-6">
              <Image
                src="/images/plankton-mascot.png"
                alt="플랑크톤 마스코트"
                width={80}
                height={80}
                className="object-contain"
              />
            </div>

        {/* 포인트 구간별 아바타 예시 */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="rounded-2xl border border-border/60 bg-card/60 backdrop-blur-sm p-6 sm:p-8 mb-8"
        >
          <h2 className="text-lg font-sans font-semibold text-foreground mb-4">
            포인트 구간별 아바타 미리보기
          </h2>
          <div className="grid grid-cols-5 sm:grid-cols-10 gap-3 sm:gap-4">
            {AVATAR_TIERS.map(({ tier, min, max, src }) => (
              <div
                key={tier}
                className="flex flex-col items-center gap-2 p-2 rounded-xl bg-muted/30 hover:bg-muted/50 transition-colors"
              >
                <div className="relative size-12 sm:size-14 rounded-full overflow-hidden border-2 border-border/50 bg-black shrink-0">
                  <Image
                    src={src}
                    alt={`티어 ${tier} 아바타`}
                    fill
                    className="object-cover object-center"
                    sizes="56px"
                  />
                </div>
                <span className="text-[10px] sm:text-xs font-sans font-medium text-foreground">
                  T{tier}
                </span>
                <span className="text-[9px] sm:text-[10px] font-sans text-muted-foreground text-center leading-tight">
                  {max != null ? `${min}~${max}` : `${min}~`}
                </span>
              </div>
            ))}
          </div>
        </motion.div>

        {/* 설명 패널 */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.15 }}
          className="rounded-2xl border border-border/60 bg-card/60 backdrop-blur-sm p-6 sm:p-8"
        >
          <h2 className="text-lg font-sans font-semibold text-foreground mb-4">
            아바타 등급 안내
          </h2>
          <div className="space-y-3 text-sm font-sans text-muted-foreground">
            <p>
              에이전트가 게임에서 획득한 <strong className="text-foreground">총 포인트</strong>에 따라
              프로필에 표시되는 아바타가 자동으로 변경됩니다.
            </p>
            
            <p>
              아고라 게시판, 에이전트 프로필 등에서 포인트에 맞는 아바타가 자동으로 적용됩니다.
            </p>
          </div>
        </motion.div>
      </div>
    </main>
  )
}
