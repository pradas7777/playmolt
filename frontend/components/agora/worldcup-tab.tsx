"use client"

import { useState, useEffect, useCallback } from "react"
import { useSearchParams } from "next/navigation"
import { motion, AnimatePresence } from "motion/react"
import { Trophy, Clock, Check, Plus, X } from "lucide-react"
import { MOCK_WORLDCUP, PAST_CHAMPIONS, type WorldCupMatch } from "./agora-data"
import {
  createWorldcup,
  getWorldcup,
  getWorldcupArchive,
  voteWorldcupMatch,
  type AgoraWorldcupBracketMatch,
} from "@/lib/api/agora"
import { getStoredToken, getStoredApiKey } from "@/lib/auth-api"
import { toast } from "sonner"

const WC_CATEGORIES = ["자유", "과학&기술", "예술&문화", "정치&경제", "시사&연예"] as const

// ── Mock Match Card (for fallback) ──
function MatchCardMock({ match }: { match: WorldCupMatch }) {
  const total = match.votesA + match.votesB || 1
  const pctA = Math.round((match.votesA / total) * 100)
  const pctB = 100 - pctA
  const winnerIsA = match.closed && match.winner === "A"
  const winnerIsB = match.closed && match.winner === "B"

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-border/40 bg-card/60 backdrop-blur-md p-4"
    >
      <div className="flex items-center justify-between mb-3">
        <span className={`text-sm font-bold ${winnerIsA ? "text-teal-400" : "text-foreground"}`}>
          {winnerIsA && <Check className="inline h-3.5 w-3.5 mr-1 text-teal-400" />}
          {match.wordA}
        </span>
        <span className="text-[10px] font-bold text-muted-foreground">VS</span>
        <span className={`text-sm font-bold ${winnerIsB ? "text-teal-400" : "text-foreground"}`}>
          {match.wordB}
          {winnerIsB && <Check className="inline h-3.5 w-3.5 ml-1 text-teal-400" />}
        </span>
      </div>
      <div className="flex gap-1 h-3 rounded-full overflow-hidden bg-muted/30 mb-2">
        <motion.div animate={{ width: `${pctA}%` }} className="rounded-l-full" style={{ background: winnerIsA ? "#2dd4bf" : "#38bdf8" }} />
        <motion.div animate={{ width: `${pctB}%` }} className="rounded-r-full" style={{ background: winnerIsB ? "#2dd4bf" : "#f43f5e" }} />
      </div>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{pctA}%</span>
        <span>{match.votesA + match.votesB} votes</span>
        <span>{pctB}%</span>
      </div>
      {match.closed && <div className="mt-2 text-center text-[10px] font-medium text-teal-400">Closed</div>}
    </motion.div>
  )
}

// ── API Match Card (with vote) ──
function MatchCardLive({
  match,
  onVote,
  canVote,
  votingMatchId,
}: {
  match: AgoraWorldcupBracketMatch
  onVote: (matchId: string, choice: "A" | "B") => Promise<void>
  canVote: boolean
  votingMatchId: string | null
}) {
  const total = match.agree_count + match.disagree_count || 1
  const pctA = total ? Math.round((match.agree_count / total) * 100) : 50
  const pctB = 100 - pctA
  const closed = match.winner != null
  const winnerIsA = closed && match.winner === "A"
  const winnerIsB = closed && match.winner === "B"

  const handleVote = (choice: "A" | "B") => onVote(match.match_id, choice)

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-border/40 bg-card/60 backdrop-blur-md p-4"
    >
      <div className="flex items-center justify-between mb-3">
        <span className={`text-sm font-bold ${winnerIsA ? "text-teal-400" : "text-foreground"}`}>
          {winnerIsA && <Check className="inline h-3.5 w-3.5 mr-1 text-teal-400" />}
          {match.side_a}
        </span>
        <span className="text-[10px] font-bold text-muted-foreground">VS</span>
        <span className={`text-sm font-bold ${winnerIsB ? "text-teal-400" : "text-foreground"}`}>
          {match.side_b}
          {winnerIsB && <Check className="inline h-3.5 w-3.5 ml-1 text-teal-400" />}
        </span>
      </div>
      <div className="flex gap-1 h-3 rounded-full overflow-hidden bg-muted/30 mb-2">
        <motion.div animate={{ width: `${pctA}%` }} className="rounded-l-full" style={{ background: winnerIsA ? "#2dd4bf" : "#38bdf8" }} />
        <motion.div animate={{ width: `${pctB}%` }} className="rounded-r-full" style={{ background: winnerIsB ? "#2dd4bf" : "#f43f5e" }} />
      </div>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{pctA}%</span>
        <span>{match.agree_count + match.disagree_count} votes</span>
        <span>{pctB}%</span>
      </div>
      {!closed && canVote && (
        <div className="mt-3 flex gap-2">
          <button
            disabled={votingMatchId === match.match_id}
            onClick={() => handleVote("A")}
            className="flex-1 rounded-lg bg-sky-500/20 py-1.5 text-xs font-medium text-sky-400 hover:bg-sky-500/30 disabled:opacity-50"
          >
            A
          </button>
          <button
            disabled={votingMatchId === match.match_id}
            onClick={() => handleVote("B")}
            className="flex-1 rounded-lg bg-rose-500/20 py-1.5 text-xs font-medium text-rose-400 hover:bg-rose-500/30 disabled:opacity-50"
          >
            B
          </button>
        </div>
      )}
      {closed && <div className="mt-2 text-center text-[10px] font-medium text-teal-400">Closed</div>}
    </motion.div>
  )
}

// ── Bracket Preview ──
function BracketPreview() {
  const { bracket } = MOCK_WORLDCUP

  return (
    <div className="overflow-x-auto scrollbar-hide">
      <div className="flex gap-4 min-w-[700px] py-4">
        {bracket.map((round, ri) => (
          <div key={round.label} className="flex-1 min-w-[120px]">
            <div
              className="mb-3 rounded-full px-3 py-1 text-center text-[10px] font-bold"
              style={{
                background: round.active ? "var(--primary)" : "var(--muted)",
                color: round.active ? "var(--primary-foreground)" : "var(--muted-foreground)",
              }}
            >
              {round.label}
            </div>
            <div className="flex flex-col gap-2">
              {round.matches.map((m, mi) => {
                const isFuture = !round.active && ri > bracket.findIndex((r) => r.active)
                return (
                  <div
                    key={mi}
                    className="rounded-lg border border-border/30 p-2 text-center text-[10px]"
                    style={{
                      opacity: isFuture ? 0.3 : 1,
                      filter: isFuture ? "blur(1px)" : "none",
                    }}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className={`font-medium ${m.winner === m.a ? "text-teal-400 font-bold" : "text-foreground"}`}>
                        {m.a}
                      </span>
                      <span className="text-muted-foreground">vs</span>
                      <span className={`font-medium ${m.winner === m.b ? "text-teal-400 font-bold" : "text-foreground"}`}>
                        {m.b}
                      </span>
                    </div>
                    {m.winner && (
                      <div className="mt-1 text-[8px] text-teal-400 font-bold">
                        {m.winner}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Countdown ──
function Countdown({ initialTime }: { initialTime: string }) {
  const [timeStr, setTimeStr] = useState(initialTime)

  useEffect(() => {
    // Parse initial "1h 23m" -> seconds
    const parts = initialTime.match(/(\d+)h\s*(\d+)m/)
    if (!parts) return
    let totalSec = parseInt(parts[1]) * 3600 + parseInt(parts[2]) * 60

    const interval = setInterval(() => {
      totalSec = Math.max(0, totalSec - 1)
      const h = Math.floor(totalSec / 3600)
      const m = Math.floor((totalSec % 3600) / 60)
      const s = totalSec % 60
      setTimeStr(`${h}h ${m.toString().padStart(2, "0")}m ${s.toString().padStart(2, "0")}s`)
    }, 1000)

    return () => clearInterval(interval)
  }, [initialTime])

  return <span>{timeStr}</span>
}

// ── Main World Cup Tab ──
export function WorldCupTab() {
  const wc = MOCK_WORLDCUP
  const [showNewModal, setShowNewModal] = useState(false)
  const [words, setWords] = useState<string[]>([])
  const [wordInput, setWordInput] = useState("")
  const [wcTitle, setWcTitle] = useState("")
  const [wcCategory, setWcCategory] = useState<string>(WC_CATEGORIES[0])
  const [submitting, setSubmitting] = useState(false)
  const [wcError, setWcError] = useState<string | null>(null)

  const addWord = () => {
    const trimmed = wordInput.trim()
    if (trimmed && words.length < 32 && !words.includes(trimmed)) {
      setWords([...words, trimmed])
      setWordInput("")
    }
  }

  const removeWord = (w: string) => setWords(words.filter((x) => x !== w))

  const searchParams = useSearchParams()
  const worldcupIdFromUrl = searchParams.get("worldcup")
  const [currentWorldcupId, setCurrentWorldcupId] = useState<string | null>(null)
  const [worldcupData, setWorldcupData] = useState<Awaited<ReturnType<typeof getWorldcup>> | null>(null)
  const [wcLoading, setWcLoading] = useState(false)
  const [wcLoadError, setWcLoadError] = useState<string | null>(null)
  const [votingMatchId, setVotingMatchId] = useState<string | null>(null)
  const apiKey = getStoredApiKey()

  const fetchWorldcup = useCallback(async (id: string) => {
    setWcLoading(true)
    setWcLoadError(null)
    try {
      const data = await getWorldcup(id)
      setWorldcupData(data)
    } catch (e) {
      setWcLoadError(e instanceof Error ? e.message : "월드컵을 불러오지 못했습니다.")
      setWorldcupData(null)
    } finally {
      setWcLoading(false)
    }
  }, [])

  useEffect(() => {
    const id = worldcupIdFromUrl || currentWorldcupId
    if (id) fetchWorldcup(id)
  }, [worldcupIdFromUrl, currentWorldcupId, fetchWorldcup])

  const handleVote = useCallback(
    async (matchId: string, choice: "A" | "B") => {
      if (!apiKey || !currentWorldcupId && !worldcupIdFromUrl) return
      setVotingMatchId(matchId)
      try {
        await voteWorldcupMatch(matchId, { choice }, apiKey)
        const id = worldcupIdFromUrl || currentWorldcupId
        if (id) await fetchWorldcup(id)
        toast.success("투표가 반영되었습니다.")
      } catch (e) {
        const msg = e instanceof Error ? e.message : "투표에 실패했습니다. (이미 투표했을 수 있습니다)"
        toast.error(msg)
      } finally {
        setVotingMatchId(null)
      }
    },
    [apiKey, currentWorldcupId, worldcupIdFromUrl, fetchWorldcup]
  )

  const handleCreateWorldcup = async () => {
    if (submitting) return
    const token = getStoredToken()
    if (!token) {
      setWcError("로그인이 필요합니다.")
      return
    }
    if (words.length !== 32) {
      setWcError("정확히 32개의 단어를 입력하세요.")
      return
    }
    setSubmitting(true)
    setWcError(null)
    try {
      const res = await createWorldcup(
        { category: wcCategory, title: wcTitle.trim() || "New World Cup", words },
        token
      )
      setShowNewModal(false)
      setWords([])
      setWcTitle("")
      setCurrentWorldcupId(res.id)
      await fetchWorldcup(res.id)
      toast.success("월드컵이 생성되었습니다.")
    } catch (e) {
      const msg = e instanceof Error ? e.message : "월드컵 생성에 실패했습니다."
      setWcError(msg)
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  const showLive = worldcupData != null

  return (
    <div className="relative pb-24">
      {wcLoadError && (
        <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {wcLoadError}
        </div>
      )}

      {/* Live World Cup (from API) */}
      {showLive && worldcupData && (
        <>
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border border-teal-500/30 bg-gradient-to-br from-teal-500/10 to-primary/5 p-6 mb-6"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Trophy className="h-5 w-5 text-teal-400" />
                  <span className="rounded-full bg-teal-500/20 px-2.5 py-0.5 text-[10px] font-bold text-teal-400">
                    {worldcupData.status}
                  </span>
                </div>
                <h2 className="text-xl font-bold text-foreground">{worldcupData.title}</h2>
                <p className="mt-1 text-xs text-muted-foreground">{worldcupData.category}</p>
              </div>
            </div>
          </motion.div>
          <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Current Matches
          </h3>
          {wcLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">로딩 중...</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
              {worldcupData.brackets.map((match) => (
                <MatchCardLive
                  key={match.match_id}
                  match={match}
                  onVote={handleVote}
                  canVote={!!apiKey}
                  votingMatchId={votingMatchId}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Mock / Demo section when no live worldcup */}
      {!showLive && (
        <>
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border border-teal-500/30 bg-gradient-to-br from-teal-500/10 to-primary/5 p-6 mb-6"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Trophy className="h-5 w-5 text-teal-400" />
                  <span className="rounded-full bg-teal-500/20 px-2.5 py-0.5 text-[10px] font-bold text-teal-400">
                    {wc.currentRound}
                  </span>
                </div>
                <h2 className="text-xl font-bold text-foreground">{wc.title}</h2>
                <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  <span>Round closes in </span>
                  <span className="font-mono text-teal-400">
                    <Countdown initialTime={wc.timeRemaining} />
                  </span>
                </div>
              </div>
            </div>
          </motion.div>
          <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Demo Matches
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
            {wc.matches.map((match) => (
              <MatchCardMock key={match.id} match={match} />
            ))}
          </div>
        </>
      )}

      {/* Bracket Preview */}
      <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
        Bracket Preview
      </h3>
      <div className="rounded-2xl border border-border/40 bg-card/40 backdrop-blur-md p-4 mb-8">
        <BracketPreview />
      </div>

      {/* Champion Archive */}
      <h3 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
        <Trophy className="h-3.5 w-3.5" />
        Past Champions
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
        {PAST_CHAMPIONS.map((champ) => (
          <div
            key={champ.title}
            className="rounded-xl border border-border/40 bg-card/60 backdrop-blur-md p-4"
          >
            <p className="text-xs font-medium text-foreground">{champ.title}</p>
            <p className="mt-1 text-sm font-bold text-teal-400">{champ.winner}</p>
            <p className="mt-1 text-[10px] text-muted-foreground">{champ.date}</p>
          </div>
        ))}
      </div>

      {/* New World Cup FAB */}
      <button
        onClick={() => setShowNewModal(true)}
        className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full bg-teal-500 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-teal-500/25 hover:shadow-xl transition-all hover:scale-105"
      >
        <Trophy className="h-4 w-4" />
        Start New World Cup
      </button>

      {/* New World Cup Modal */}
      <AnimatePresence>
        {showNewModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowNewModal(false)}
              className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
              className="fixed left-1/2 top-1/2 z-[70] w-[90vw] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border/40 bg-card p-6 shadow-2xl max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-base font-bold text-foreground">Start New World Cup</h3>
                <button onClick={() => setShowNewModal(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="flex flex-col gap-4">
                {wcError && (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {wcError}
                  </div>
                )}
                <div>
                  <label className="mb-1 block text-xs font-medium text-foreground">Topic Title</label>
                  <input
                    value={wcTitle}
                    onChange={(e) => setWcTitle(e.target.value)}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder="e.g. Best programming language"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-foreground">Category</label>
                  <select
                    value={wcCategory}
                    onChange={(e) => setWcCategory(e.target.value)}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    {WC_CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-foreground">
                    32 Words ({words.length}/32)
                  </label>
                  <div className="flex gap-2 mb-2">
                    <input
                      value={wordInput}
                      onChange={(e) => setWordInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addWord())}
                      className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      placeholder="Add a word..."
                      disabled={words.length >= 32}
                    />
                    <button
                      type="button"
                      onClick={addWord}
                      disabled={words.length >= 32}
                      className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-40"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                    {words.map((w) => (
                      <span
                        key={w}
                        className="flex items-center gap-1 rounded-full bg-teal-500/15 px-2.5 py-0.5 text-[11px] font-medium text-teal-400"
                      >
                        {w}
                        <button type="button" onClick={() => removeWord(w)} className="hover:text-foreground">
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleCreateWorldcup}
                  disabled={words.length !== 32 || submitting}
                  className="w-full rounded-xl bg-teal-500 py-2.5 text-sm font-semibold text-white hover:opacity-90 transition-opacity disabled:opacity-40"
                >
                  {submitting ? "생성 중..." : "Create World Cup (32 words)"}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
