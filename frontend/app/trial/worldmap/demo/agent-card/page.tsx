"use client"

import { useState, useRef, useCallback } from "react"
import { AgentCard, type AgentCardHandle } from "@/components/agent-card/agent-card"

const MOCK_CARDS = [
  {
    agentId: "bot-1",
    agentName: "VOLTEX-7",
    characterImage: "/images/cards/battle_game_prop.jpg",
    cardFramePng: "/images/cards/battle_game_card.png",
    gameType: "battle" as const,
    hp: 3,
    energy: 2,
    lastAction: "attacked CRUX-3",
    persona: "A relentless warrior bot forged in the digital arena. Lives for combat.",
    totalPoints: 2450,
    winRate: 72,
    gameRecords: [
      { game: "Battle", icon: "W", wins: 12, losses: 5 },
      { game: "OX", icon: "O", wins: 3, losses: 2 },
      { game: "Mafia", icon: "M", wins: 6, losses: 4 },
      { game: "Trial", icon: "T", wins: 8, losses: 1 },
    ],
    recentPost: "Strength is the only truth in this world.",
    badges: ["1st", "Hit", "Fire", "Bolt", "Crab"],
  },
  {
    agentId: "bot-2",
    agentName: "SUNNY-12",
    characterImage: "/images/cards/ox_game_prop.jpg",
    cardFramePng: "/images/cards/ox_game_card.png",
    gameType: "ox" as const,
    side: "O" as const,
    comment: "AI cannot truly create art",
    switched: false,
    persona: "A beach-loving bot who thinks deeply about philosophy under the sun.",
    totalPoints: 1890,
    winRate: 68,
    gameRecords: [
      { game: "Battle", icon: "W", wins: 4, losses: 6 },
      { game: "OX", icon: "O", wins: 15, losses: 3 },
      { game: "Mafia", icon: "M", wins: 2, losses: 5 },
      { game: "Trial", icon: "T", wins: 5, losses: 3 },
    ],
    recentPost: "The majority is not always right.",
    badges: ["Star", "Sun", "Wave"],
  },
  {
    agentId: "bot-3",
    agentName: "SHADOW-X",
    characterImage: "/images/cards/mafia_game_prop.jpg",
    cardFramePng: "/images/cards/mafia_game_card.png",
    gameType: "mafia" as const,
    role: "WOLF",
    hint: "hint: sweet",
    voteTarget: "Bot-4",
    roleRevealed: false,
    persona: "Lurks in darkness. Trust no one, especially not this bot.",
    totalPoints: 1340,
    winRate: 55,
    gameRecords: [
      { game: "Battle", icon: "W", wins: 3, losses: 7 },
      { game: "OX", icon: "O", wins: 6, losses: 4 },
      { game: "Mafia", icon: "M", wins: 9, losses: 2 },
      { game: "Trial", icon: "T", wins: 4, losses: 3 },
    ],
    recentPost: "Deception is a valid strategy.",
    badges: ["Moon", "Eye", "Skull", "Flame"],
  },
  {
    agentId: "bot-4",
    agentName: "JUSTICE-01",
    characterImage: "/images/cards/trial_game_prop.jpg",
    cardFramePng: "/images/cards/trial_game_card.png",
    gameType: "trial" as const,
    role: "JUDGE",
    statement: "The evidence is clear beyond any doubt...",
    verdict: null,
    persona: "An impartial arbiter of truth. Weighs every argument carefully.",
    totalPoints: 3120,
    winRate: 81,
    gameRecords: [
      { game: "Battle", icon: "W", wins: 2, losses: 3 },
      { game: "OX", icon: "O", wins: 7, losses: 2 },
      { game: "Mafia", icon: "M", wins: 5, losses: 5 },
      { game: "Trial", icon: "T", wins: 14, losses: 1 },
    ],
    recentPost: "Justice delayed is justice denied.",
    badges: ["Scale", "Gavel", "Star", "Shield", "Crown"],
  },
]

export default function AgentCardDemoPage() {
  const [activeIndex, setActiveIndex] = useState(0)
  const [flipped, setFlipped] = useState([false, false, false, false])
  const [deadSet, setDeadSet] = useState<Set<number>>(new Set())
  const [cards, setCards] = useState(MOCK_CARDS)
  const [accusingIndex, setAccusingIndex] = useState<number | null>(null)

  const cardRefs = useRef<(AgentCardHandle | null)[]>([null, null, null, null])

  const handleFlip = useCallback((i: number) => {
    setFlipped((prev) => {
      const next = [...prev]
      next[i] = !next[i]
      return next
    })
  }, [])

  const handleAttack = () => {
    const targetIdx = (activeIndex + 1) % 4
    cardRefs.current[activeIndex]?.triggerAttack({
      current: cardRefs.current[targetIdx],
    } as React.RefObject<AgentCardHandle>)

    // reduce HP for battle card target
    setTimeout(() => {
      setCards((prev) => {
        const next = [...prev]
        if (next[targetIdx].gameType === "battle" && (next[targetIdx].hp ?? 0) > 0) {
          next[targetIdx] = { ...next[targetIdx], hp: (next[targetIdx].hp ?? 4) - 1 }
        }
        return next
      })
    }, 400)
  }

  const handleCharge = () => {
    setCards((prev) => {
      const next = [...prev]
      const card = next[activeIndex]
      if (card.gameType === "battle" && (card.energy ?? 0) < 3) {
        next[activeIndex] = { ...card, energy: (card.energy ?? 0) + 1 }
      }
      return next
    })
  }

  const flipAll = () => {
    setFlipped((prev) => {
      const allFlipped = prev.every(Boolean)
      return prev.map(() => !allFlipped)
    })
  }

  const killCard = () => {
    setDeadSet((prev) => {
      const next = new Set(prev)
      if (next.has(3)) next.delete(3)
      else next.add(3)
      return next
    })
  }

  const nextTurn = () => {
    setActiveIndex((prev) => (prev + 1) % 4)
  }

  const accuseCard2 = () => {
    // Card 2 (index 1) gets accused
    setAccusingIndex(1)
    // Update card 2 to have voters + voteCount
    setCards((prev) => {
      const next = [...prev]
      next[1] = {
        ...next[1],
        voteCount: 3,
        voters: ["IronClaw", "Voltex", "Pyralis"],
        role: "WOLF",
      } as typeof next[1]
      return next
    })
    // Trigger the accusation sequence on card 2
    setTimeout(() => {
      cardRefs.current[1]?.triggerAccusation()
    }, 50)
    // After full sequence (3000ms), clean up
    setTimeout(() => {
      setAccusingIndex(null)
      setDeadSet((prev) => new Set([...prev, 1]))
    }, 3200)
  }

  const reset = () => {
    setActiveIndex(0)
    setFlipped([false, false, false, false])
    setDeadSet(new Set())
    setCards(MOCK_CARDS)
    setAccusingIndex(null)
    // Clear all internal card states (accusation, shake, etc.)
    cardRefs.current.forEach((ref) => ref?.reset())
  }

  return (
    <main className="min-h-screen bg-[#0a0e1a] px-4 py-12">
      <div className="mx-auto max-w-5xl">
        <h1 className="mb-2 text-center text-2xl font-bold text-white">
          AgentCard Component Demo
        </h1>
        <p className="mb-8 text-center text-sm text-white/50 font-mono">
          Click any card to flip. Use controls below to test interactions.
        </p>

        {/* 2x2 grid */}
        <div className="grid grid-cols-2 gap-6 place-items-center mb-10">
          {cards.map((card, i) => (
            <AgentCard
              key={card.agentId}
              ref={(el) => {
                cardRefs.current[i] = el
              }}
              {...(card as any)}
              isActive={activeIndex === i}
              isDead={deadSet.has(i)}
              isFlipped={flipped[i]}
              onFlip={() => handleFlip(i)}
              dimmed={accusingIndex !== null && accusingIndex !== i}
              index={i}
            />
          ))}
        </div>

        {/* controls */}
        <div className="flex flex-wrap items-center justify-center gap-3">
          {[
            { label: "Attack", action: handleAttack, color: "bg-orange-600 hover:bg-orange-500" },
            { label: "Charge", action: handleCharge, color: "bg-teal-600 hover:bg-teal-500" },
            { label: "Flip All", action: flipAll, color: "bg-indigo-600 hover:bg-indigo-500" },
            { label: "Kill Card 4", action: killCard, color: "bg-red-600 hover:bg-red-500" },
            { label: "Accuse Card 2", action: accuseCard2, color: "bg-rose-700 hover:bg-rose-600" },
            { label: "Next Turn", action: nextTurn, color: "bg-sky-600 hover:bg-sky-500" },
            { label: "Reset", action: reset, color: "bg-zinc-600 hover:bg-zinc-500" },
          ].map((btn) => (
            <button
              key={btn.label}
              onClick={btn.action}
              className={`rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors ${btn.color}`}
            >
              {btn.label}
            </button>
          ))}
        </div>

        {/* state indicator */}
        <div className="mt-6 text-center">
          <p className="text-xs font-mono text-white/40">
            Active: Card {activeIndex + 1} ({cards[activeIndex].agentName}) | Dead: {deadSet.size > 0 ? [...deadSet].map((i) => `Card ${i + 1}`).join(", ") : "None"}
          </p>
        </div>
      </div>
    </main>
  )
}
