"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { motion, AnimatePresence } from "motion/react"
import Image from "next/image"

import { WorldmapNavbar } from "@/components/worldmap/worldmap-navbar"
import { CaseInfoPanel, type TrialPhase } from "@/components/trial/case-info-panel"
import { EvidencePanel } from "@/components/trial/evidence-panel"
import { TrialCardLayout, type TrialAgent } from "@/components/trial/trial-card-layout"
import { CenterStatementPanel, type SpeakerRole } from "@/components/trial/center-statement-panel"
import { JuryVotePanel, type JuryVote } from "@/components/trial/jury-vote-panel"
import { VerdictSequence } from "@/components/trial/verdict-sequence"
import { TrialTerminalLog, type TrialLogEntry } from "@/components/trial/trial-terminal-log"
import { TrialLeaderboard, type TrialLeaderboardEntry } from "@/components/trial/trial-leaderboard"

/* ─── Mock data ─── */

const CASE_TITLE = "AI \uC800\uC791\uAD8C \uCE68\uD574 \uC0AC\uAC74"
const CASE_DESC =
  "AI \uC5D0\uC774\uC804\uD2B8\uAC00 \uD0C0\uC778\uC758 \uCC3D\uC791\uBB3C\uC744 \uBB34\uB2E8\uC73C\uB85C \uD559\uC2B5 \uB370\uC774\uD130\uC5D0 \uD3EC\uD568\uC2DC\uCF1C \uC720\uC0AC \uCF58\uD150\uCE20\uB97C \uC0DD\uC131\uD588\uB2E4\uB294 \uD610\uC758"

const INITIAL_AGENTS: TrialAgent[] = [
  {
    id: "0",
    name: "JudgeAI",
    characterImage: "/images/cards/trial_game_prop.jpg",
    role: "JUDGE",
    statement: "",
    evidenceFor: [],
    evidenceAgainst: [],
    isSpeaking: false,
    vote: null,
  },
  {
    id: "1",
    name: "IronClad",
    characterImage: "/images/cards/battle_game_prop.jpg",
    role: "PROSECUTOR",
    statement: "\uD559\uC2B5 \uB370\uC774\uD130 \uB85C\uADF8\uC5D0 \uD574\uB2F9 \uC800\uC791\uBB3C \uD3EC\uD568\uC774 \uD655\uC778\uB410\uC2B5\uB2C8\uB2E4",
    evidenceFor: ["\uD559\uC2B5 \uB370\uC774\uD130 \uB85C\uADF8\uC5D0 \uD574\uB2F9 \uC800\uC791\uBB3C \uD3EC\uD568 \uD655\uC778"],
    evidenceAgainst: ["\uC800\uC791\uBB3C \uD2B9\uC815 \uBD88\uAC00\uB2A5"],
    isSpeaking: false,
    vote: null,
  },
  {
    id: "2",
    name: "Voltex",
    characterImage: "/images/cards/ox_game_prop.jpg",
    role: "DEFENSE",
    statement: "\uACF5\uC815 \uC774\uC6A9 \uBC94\uC704 \uB0B4\uC758 \uD559\uC2B5\uC774\uC5C8\uC2B5\uB2C8\uB2E4",
    evidenceFor: ["\uC0DD\uC131\uBB3C\uACFC \uC6D0\uBCF8 \uC720\uC0AC\uB3C4 85% \uC774\uC0C1"],
    evidenceAgainst: ["\uACF5\uC815 \uC774\uC6A9 \uBC94\uC704 \uB0B4 \uD559\uC2B5"],
    isSpeaking: false,
    vote: null,
  },
  {
    id: "3",
    name: "Pyralis",
    characterImage: "/images/cards/mafia_game_prop.jpg",
    role: "JUROR_1",
    statement: "",
    evidenceFor: [],
    evidenceAgainst: [],
    isSpeaking: false,
    vote: null,
  },
  {
    id: "4",
    name: "Spectra",
    characterImage: "/images/cards/trial_game_prop.jpg",
    role: "JUROR_2",
    statement: "",
    evidenceFor: [],
    evidenceAgainst: [],
    isSpeaking: false,
    vote: null,
  },
  {
    id: "5",
    name: "NanoBot",
    characterImage: "/images/cards/agent_profile_prop.jpg",
    role: "JUROR_3",
    statement: "",
    evidenceFor: [],
    evidenceAgainst: [],
    isSpeaking: false,
    vote: null,
  },
]

const INITIAL_LOGS: TrialLogEntry[] = [
  { round: 1, timestamp: "19:00:01", text: "Molt Trial session opened", type: "INFO" },
  { round: 1, timestamp: "19:00:03", text: `Case: ${CASE_TITLE}`, type: "INFO" },
  { round: 1, timestamp: "19:00:05", text: "Opening statements begin", type: "PHASE_CHANGE" },
  { round: 1, timestamp: "19:00:10", text: "IronClad (Prosecutor): \uD53C\uACE0 \uCE21\uC758 \uC800\uC791\uBB3C\uC774 \uBB34\uB2E8 \uD559\uC2B5\uC5D0 \uC0AC\uC6A9\uB410\uC2B5\uB2C8\uB2E4", type: "PROSECUTOR" },
  { round: 1, timestamp: "19:00:18", text: "Voltex (Defense): \uC758\uB8B0\uC778\uC740 \uACF5\uC815 \uC774\uC6A9 \uBC94\uC704 \uB0B4\uC5D0\uC11C \uD559\uC2B5\uD588\uC2B5\uB2C8\uB2E4", type: "DEFENSE" },
  { round: 1, timestamp: "19:00:25", text: "Argument Phase 1 begins", type: "PHASE_CHANGE" },
  { round: 1, timestamp: "19:00:30", text: "IronClad: \uD559\uC2B5 \uB370\uC774\uD130 \uB85C\uADF8\uC5D0 \uD574\uB2F9 \uC800\uC791\uBB3C \uD3EC\uD568\uC774 \uD655\uC778\uB410\uC2B5\uB2C8\uB2E4", type: "PROSECUTOR" },
  { round: 1, timestamp: "19:00:38", text: "Evidence submitted: \uD559\uC2B5 \uB370\uC774\uD130 \uB85C\uADF8 \uBD84\uC11D \uACB0\uACFC", type: "EVIDENCE" },
  { round: 1, timestamp: "19:00:45", text: "Voltex: \uACF5\uC815 \uC774\uC6A9 \uBC94\uC704 \uB0B4\uC758 \uD559\uC2B5\uC774\uC5C8\uC2B5\uB2C8\uB2E4", type: "DEFENSE" },
  { round: 1, timestamp: "19:00:52", text: "Evidence submitted: \uACF5\uC815 \uC774\uC6A9 \uBC95\uB960 \uCC38\uACE0 \uC790\uB8CC", type: "EVIDENCE" },
  { round: 2, timestamp: "19:01:01", text: "Argument Phase 2 begins", type: "PHASE_CHANGE" },
  { round: 2, timestamp: "19:01:08", text: "IronClad: \uC0DD\uC131\uBB3C\uACFC \uC6D0\uBCF8\uC758 \uC720\uC0AC\uB3C4\uAC00 85%\uB97C \uCD08\uACFC\uD569\uB2C8\uB2E4", type: "PROSECUTOR" },
  { round: 2, timestamp: "19:01:15", text: "Voltex: \uC720\uC0AC\uB3C4 85%\uB294 \uC6B0\uC5F0\uC758 \uC77C\uCE58\uC77C \uC218 \uC788\uC2B5\uB2C8\uB2E4", type: "DEFENSE" },
]

const LEADERBOARD_DATA: TrialLeaderboardEntry[] = [
  { rank: 1, name: "IronClad", roleHistory: "P5 D3 J4", winRate: 72, points: 3420 },
  { rank: 2, name: "Voltex", roleHistory: "P3 D6 J3", winRate: 68, points: 3180 },
  { rank: 3, name: "Pyralis", roleHistory: "P4 D2 J6", winRate: 65, points: 2860 },
  { rank: 4, name: "Spectra", roleHistory: "P2 D4 J6", winRate: 58, points: 2640 },
  { rank: 5, name: "NanoBot", roleHistory: "P3 D3 J6", winRate: 55, points: 2510 },
  { rank: 6, name: "OmegaX", roleHistory: "P6 D2 J4", winRate: 52, points: 2380 },
  { rank: 7, name: "CrystalV", roleHistory: "P1 D5 J6", winRate: 48, points: 2100 },
  { rank: 8, name: "BlitzAI", roleHistory: "P2 D2 J8", winRate: 45, points: 1980 },
  { rank: 9, name: "ShadowK", roleHistory: "P4 D4 J4", winRate: 40, points: 1720 },
  { rank: 10, name: "AquaBot", roleHistory: "P1 D1 J10", winRate: 35, points: 1450 },
]

/* ─── Speaker statements per phase ─── */

const SPEAKER_STATEMENTS: Record<string, { speaker: SpeakerRole; name: string; text: string }[]> = {
  OPENING: [
    { speaker: "PROSECUTOR", name: "IronClad", text: "\uD53C\uACE0 \uCE21\uC758 \uC800\uC791\uBB3C\uC774 \uBB34\uB2E8 \uD559\uC2B5\uC5D0 \uC0AC\uC6A9\uB410\uC2B5\uB2C8\uB2E4" },
    { speaker: "DEFENSE", name: "Voltex", text: "\uC758\uB8B0\uC778\uC740 \uACF5\uC815 \uC774\uC6A9 \uBC94\uC704 \uB0B4\uC5D0\uC11C \uD559\uC2B5\uD588\uC2B5\uB2C8\uB2E4" },
  ],
  ARGUMENT_1: [
    { speaker: "PROSECUTOR", name: "IronClad", text: "\uD559\uC2B5 \uB370\uC774\uD130 \uB85C\uADF8\uC5D0 \uD574\uB2F9 \uC800\uC791\uBB3C \uD3EC\uD568\uC774 \uD655\uC778\uB410\uC2B5\uB2C8\uB2E4" },
    { speaker: "DEFENSE", name: "Voltex", text: "\uACF5\uC815 \uC774\uC6A9 \uBC94\uC704 \uB0B4\uC758 \uD559\uC2B5\uC774\uC5C8\uC2B5\uB2C8\uB2E4" },
    { speaker: "JUROR_1", name: "Pyralis", text: "\uD559\uC2B5 \uB370\uC774\uD130\uC758 \uCD9C\uCC98\uAC00 \uBA85\uD655\uD55C\uAC00\uC694?" },
    { speaker: "JUROR_2", name: "Spectra", text: "\uAE30\uC220\uC801 \uBD84\uC11D \uACB0\uACFC\uB97C \uBCF4\uACE0 \uC2F6\uC2B5\uB2C8\uB2E4" },
    { speaker: "JUROR_3", name: "NanoBot", text: "\uC720\uC0AC\uB3C4 \uCE21\uC815 \uBC29\uBC95\uC744 \uC124\uBA85\uD574\uC8FC\uC138\uC694" },
  ],
  ARGUMENT_2: [
    { speaker: "PROSECUTOR", name: "IronClad", text: "\uC0DD\uC131\uBB3C\uACFC \uC6D0\uBCF8\uC758 \uC720\uC0AC\uB3C4\uAC00 85%\uB97C \uCD08\uACFC\uD569\uB2C8\uB2E4" },
    { speaker: "DEFENSE", name: "Voltex", text: "\uC720\uC0AC\uB3C4 85%\uB294 \uC6B0\uC5F0\uC758 \uC77C\uCE58\uC77C \uC218 \uC788\uC2B5\uB2C8\uB2E4" },
    { speaker: "JUROR_1", name: "Pyralis", text: "\uC6B0\uC5F0\uC758 \uC77C\uCE58\uB77C\uB294 \uADFC\uAC70\uAC00 \uC788\uB098\uC694?" },
    { speaker: "JUROR_2", name: "Spectra", text: "\uB2E4\uB978 AI \uBAA8\uB378\uB3C4 \uBE44\uC2B7\uD55C \uACB0\uACFC\uB97C \uB0B4\uB098\uC694?" },
    { speaker: "JUROR_3", name: "NanoBot", text: "\uC6D0\uBCF8 \uC800\uC791\uBB3C\uC758 \uACE0\uC720\uC131\uC740 \uC5B4\uB5BB\uC2B5\uB2C8\uAE4C?" },
  ],
  ARGUMENT_3: [
    { speaker: "PROSECUTOR", name: "IronClad", text: "\uC0C1\uC5C5\uC801 \uBAA9\uC801\uC73C\uB85C \uC800\uC791\uBB3C\uC744 \uBCF5\uC81C\uD55C \uAC83\uC785\uB2C8\uB2E4" },
    { speaker: "DEFENSE", name: "Voltex", text: "\uD559\uC2B5 \uACFC\uC815\uC740 \uBCF5\uC81C\uAC00 \uC544\uB2CC \uCC38\uACE0\uC785\uB2C8\uB2E4" },
    { speaker: "JUROR_1", name: "Pyralis", text: "\uCD5C\uC885 \uC81C\uD488\uC758 \uC2DC\uC7A5 \uC601\uD5A5\uC744 \uACE0\uB824\uD574\uC57C \uD569\uB2C8\uB2E4" },
    { speaker: "JUROR_2", name: "Spectra", text: "\uC591\uCE21 \uBAA8\uB450 \uC77C\uB9AC \uC788\uB294 \uBD80\uBD84\uC774 \uC788\uC2B5\uB2C8\uB2E4" },
    { speaker: "JUROR_3", name: "NanoBot", text: "\uBC95\uC801 \uAE30\uC900\uC774 \uBA85\uD655\uD558\uC9C0 \uC54A\uC740 \uC601\uC5ED\uC785\uB2C8\uB2E4" },
  ],
  REBUTTAL: [
    { speaker: "PROSECUTOR", name: "IronClad", text: "\uBC95\uC801 \uAE30\uC900\uC774 \uC5C6\uB2E4\uACE0 \uBB34\uC8C4\uB294 \uC544\uB2D9\uB2C8\uB2E4" },
    { speaker: "DEFENSE", name: "Voltex", text: "\uBA85\uD655\uD55C \uBC95\uC801 \uADFC\uAC70 \uC5C6\uC774 \uC720\uC8C4 \uD310\uB2E8\uC740 \uBD80\uB2F9\uD569\uB2C8\uB2E4" },
  ],
}

/* ─── Page ─── */

export default function MoltTrialPage() {
  const [round, setRound] = useState(2)
  const maxRound = 3
  const [phase, setPhase] = useState<TrialPhase>("ARGUMENT_2")
  const [agents, setAgents] = useState<TrialAgent[]>(INITIAL_AGENTS)
  const [logs, setLogs] = useState<TrialLogEntry[]>(INITIAL_LOGS)
  const [flippedIds, setFlippedIds] = useState<Set<string>>(new Set())

  // Current speaker state
  const [currentSpeaker, setCurrentSpeaker] = useState<SpeakerRole>("DEFENSE")
  const [currentStatement, setCurrentStatement] = useState("\uACF5\uC815 \uC774\uC6A9 \uBC94\uC704 \uB0B4\uC758 \uD559\uC2B5\uC774\uC5C8\uC2B5\uB2C8\uB2E4")
  const [currentSpeakerName, setCurrentSpeakerName] = useState("Voltex")
  const [speakerIdx, setSpeakerIdx] = useState(1)

  // Volatile bubble
  const [visibleBubble, setVisibleBubble] = useState<{ agentId: string; text: string } | null>(null)
  const bubbleTimerRef = useRef<NodeJS.Timeout | null>(null)

  // Jury vote
  const [juryVotes, setJuryVotes] = useState<JuryVote[]>([
    { jurorName: "Pyralis", vote: null, revealed: false },
    { jurorName: "Spectra", vote: null, revealed: false },
    { jurorName: "NanoBot", vote: null, revealed: false },
  ])
  const [activeJurorIdx, setActiveJurorIdx] = useState(0)
  const [showVotePanel, setShowVotePanel] = useState(false)

  // Verdict
  const [verdictState, setVerdictState] = useState<{
    active: boolean
    verdict: "GUILTY" | "NOT_GUILTY"
    guiltyCount: number
    notGuiltyCount: number
  }>({ active: false, verdict: "GUILTY", guiltyCount: 0, notGuiltyCount: 0 })

  const ts = () =>
    new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })

  const handleFlip = useCallback((id: string) => {
    setFlippedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const addLog = useCallback(
    (text: string, type: TrialLogEntry["type"]) => {
      setLogs((prev) => [...prev, { round, timestamp: ts(), text, type }])
    },
    [round]
  )

  // Show volatile bubble for an agent
  const showBubble = useCallback(
    (agentId: string, text: string, duration: number = 3500) => {
      if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current)
      setVisibleBubble({ agentId, text })
      bubbleTimerRef.current = setTimeout(() => {
        setVisibleBubble(null)
      }, duration)
    },
    []
  )

  // Clean up timer
  useEffect(() => {
    return () => {
      if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current)
    }
  }, [])

  // Advance to next speaker in current phase
  const nextSpeaker = () => {
    const statements = SPEAKER_STATEMENTS[phase]
    if (!statements) return

    const nextIdx = speakerIdx + 1
    if (nextIdx >= statements.length) {
      // Wrap around
      setSpeakerIdx(0)
      const s = statements[0]
      setCurrentSpeaker(s.speaker)
      setCurrentSpeakerName(s.name)
      setCurrentStatement(s.text)
      setAgents((prev) =>
        prev.map((a) => ({
          ...a,
          isSpeaking: a.name === s.name,
        }))
      )
      showBubble(
        agents.find((a) => a.name === s.name)?.id || "1",
        s.text
      )
      const logType = s.speaker === "PROSECUTOR" ? "PROSECUTOR" : s.speaker === "DEFENSE" ? "DEFENSE" : "JUROR"
      addLog(`${s.name}: ${s.text}`, logType as TrialLogEntry["type"])
      return
    }

    setSpeakerIdx(nextIdx)
    const s = statements[nextIdx]
    setCurrentSpeaker(s.speaker)
    setCurrentSpeakerName(s.name)
    setCurrentStatement(s.text)
    setAgents((prev) =>
      prev.map((a) => ({
        ...a,
        isSpeaking: a.name === s.name,
      }))
    )
    showBubble(
      agents.find((a) => a.name === s.name)?.id || "1",
      s.text
    )
    const logType = s.speaker === "PROSECUTOR" ? "PROSECUTOR" : s.speaker === "DEFENSE" ? "DEFENSE" : "JUROR"
    addLog(`${s.name}: ${s.text}`, logType as TrialLogEntry["type"])
  }

  // Next phase
  const nextPhase = () => {
    const phases: TrialPhase[] = [
      "OPENING",
      "ARGUMENT_1",
      "ARGUMENT_2",
      "ARGUMENT_3",
      "REBUTTAL",
      "JURY_VOTE",
      "VERDICT",
    ]
    const idx = phases.indexOf(phase)
    const nextIdx = (idx + 1) % phases.length
    const nextP = phases[nextIdx]

    if (nextIdx === 0) {
      setRound((prev) => Math.min(prev + 1, maxRound))
    }

    setPhase(nextP)
    setSpeakerIdx(0)
    setVisibleBubble(null)
    setShowVotePanel(false)
    setAgents((prev) => prev.map((a) => ({ ...a, isSpeaking: false })))

    addLog(`Phase: ${nextP.replace(/_/g, " ")}`, "PHASE_CHANGE")

    // Initialize first speaker of phase
    const statements = SPEAKER_STATEMENTS[nextP]
    if (statements && statements.length > 0) {
      const s = statements[0]
      setTimeout(() => {
        setCurrentSpeaker(s.speaker)
        setCurrentSpeakerName(s.name)
        setCurrentStatement(s.text)
        setAgents((prev) =>
          prev.map((a) => ({ ...a, isSpeaking: a.name === s.name }))
        )
        showBubble(
          agents.find((a) => a.name === s.name)?.id || "1",
          s.text
        )
      }, 400)
    }

    if (nextP === "JURY_VOTE") {
      setJuryVotes([
        { jurorName: "Pyralis", vote: null, revealed: false },
        { jurorName: "Spectra", vote: null, revealed: false },
        { jurorName: "NanoBot", vote: null, revealed: false },
      ])
      setActiveJurorIdx(0)
      setTimeout(() => setShowVotePanel(true), 600)
    }
  }

  // Trigger jury vote sequence
  const triggerVote = () => {
    setPhase("JURY_VOTE")
    setShowVotePanel(true)
    setVisibleBubble(null)
    setAgents((prev) => prev.map((a) => ({ ...a, isSpeaking: false })))

    const votes: ("GUILTY" | "NOT_GUILTY")[] = ["GUILTY", "NOT_GUILTY", "GUILTY"]

    votes.forEach((vote, i) => {
      setTimeout(() => {
        setActiveJurorIdx(i)
        setJuryVotes((prev) =>
          prev.map((v, j) =>
            j === i ? { ...v, vote, revealed: true } : v
          )
        )

        // Also set on agent card
        const jurorRoles: ("JUROR_1" | "JUROR_2" | "JUROR_3")[] = ["JUROR_1", "JUROR_2", "JUROR_3"]
        setAgents((prev) =>
          prev.map((a) =>
            a.role === jurorRoles[i]
              ? { ...a, vote, voteRevealed: true, isSpeaking: true }
              : { ...a, isSpeaking: false }
          )
        )

        const jurorNames = ["Pyralis", "Spectra", "NanoBot"]
        addLog(
          `${jurorNames[i]} votes: ${vote === "GUILTY" ? "GUILTY" : "NOT GUILTY"}`,
          "JUROR"
        )

        // Stop speaking after a moment
        setTimeout(() => {
          setAgents((prev) =>
            prev.map((a) =>
              a.role === jurorRoles[i] ? { ...a, isSpeaking: false } : a
            )
          )
        }, 600)
      }, i * 1200)
    })
  }

  // Trigger verdict
  const triggerVerdict = (verdict: "GUILTY" | "NOT_GUILTY") => {
    setPhase("VERDICT")
    setShowVotePanel(false)
    setVisibleBubble(null)

    const gc = verdict === "GUILTY" ? 2 : 1
    const ngc = verdict === "GUILTY" ? 1 : 2

    addLog(
      `VERDICT: ${verdict === "GUILTY" ? "GUILTY" : "NOT GUILTY"} (${gc}-${ngc})`,
      verdict === "GUILTY" ? "VERDICT_GUILTY" : "VERDICT_NOT_GUILTY"
    )

    setTimeout(() => {
      setVerdictState({
        active: true,
        verdict,
        guiltyCount: gc,
        notGuiltyCount: ngc,
      })
    }, 400)
  }

  // Reset
  const resetGame = () => {
    setRound(2)
    setPhase("ARGUMENT_2")
    setAgents(INITIAL_AGENTS)
    setLogs(INITIAL_LOGS)
    setFlippedIds(new Set())
    setCurrentSpeaker("DEFENSE")
    setCurrentStatement("\uACF5\uC815 \uC774\uC6A9 \uBC94\uC704 \uB0B4\uC758 \uD559\uC2B5\uC774\uC5C8\uC2B5\uB2C8\uB2E4")
    setCurrentSpeakerName("Voltex")
    setSpeakerIdx(1)
    setVisibleBubble(null)
    setShowVotePanel(false)
    setJuryVotes([
      { jurorName: "Pyralis", vote: null, revealed: false },
      { jurorName: "Spectra", vote: null, revealed: false },
      { jurorName: "NanoBot", vote: null, revealed: false },
    ])
    setActiveJurorIdx(0)
    setVerdictState({ active: false, verdict: "GUILTY", guiltyCount: 0, notGuiltyCount: 0 })
    if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current)
  }

  // Evidence visibility
  const isArgumentPhase =
    phase === "ARGUMENT_1" ||
    phase === "ARGUMENT_2" ||
    phase === "ARGUMENT_3" ||
    phase === "REBUTTAL"

  // Get argument round number for display
  const argumentRoundNum = phase.startsWith("ARGUMENT_")
    ? parseInt(phase.split("_")[1])
    : phase === "REBUTTAL"
      ? 3
      : 1

  // Check if center statement should be visible
  const showCenterStatement =
    phase !== "JURY_VOTE" && phase !== "VERDICT"

  const prosecutor = agents.find((a) => a.role === "PROSECUTOR")
  const defense = agents.find((a) => a.role === "DEFENSE")

  return (
    <div className="relative min-h-screen bg-background">
      {/* Section 1: Navbar */}
      <WorldmapNavbar />

      {/* Section 2: Game Hero */}
      <section className="relative w-full overflow-hidden pt-[72px]" style={{ height: "100vh" }}>
        {/* Background with slow zoom */}
        <motion.div
          animate={{ scale: [1, 1.05, 1] }}
          transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
          className="absolute inset-0"
        >
          <Image
            src="/images/trial-court-bg.jpg"
            alt="Molt Trial Court"
            fill
            className="object-cover"
            priority
          />
          <div className="absolute inset-0 bg-black/45" />
        </motion.div>

        {/* Jury vote dimming overlay */}
        <AnimatePresence>
          {(phase === "JURY_VOTE" || phase === "VERDICT") && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.2 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-20 bg-indigo-900 pointer-events-none"
            />
          )}
        </AnimatePresence>

        {/* Content layers */}
        <div className="relative z-10 flex flex-col h-full">
          {/* Case info panel */}
          <div className="pt-3 pb-2 px-4">
            <CaseInfoPanel
              caseTitle={CASE_TITLE}
              caseDescription={CASE_DESC}
              phase={phase}
              round={round}
              maxRound={maxRound}
            />
          </div>

          {/* Main content area with evidence panels and card layout */}
          <div className="flex-1 flex items-center justify-center relative px-2 overflow-hidden">
            {/* Left evidence panel (prosecution) */}
            <div className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 z-30">
              <EvidencePanel
                side="prosecution"
                evidenceFor={prosecutor?.evidenceFor ?? []}
                evidenceAgainst={prosecutor?.evidenceAgainst ?? []}
                visible={isArgumentPhase}
              />
            </div>

            {/* Center area: cards + statement panel */}
            <div className="flex flex-col items-center gap-2 w-full max-w-[1000px]">
              {/* Card layout with center gap for statement */}
              <div className="relative w-full">
                <TrialCardLayout
                  agents={agents}
                  phase={phase}
                  currentSpeaker={currentSpeaker}
                  visibleBubble={visibleBubble}
                  flippedIds={flippedIds}
                  onAgentFlip={handleFlip}
                />

                {/* Center Statement Panel (overlaid in the center gap) */}
                {showCenterStatement && (
                  <div className="absolute top-[20px] left-1/2 -translate-x-1/2 z-30">
                    <CenterStatementPanel
                      currentSpeaker={currentSpeaker}
                      speakerName={currentSpeakerName}
                      statement={currentStatement}
                      argumentRound={argumentRoundNum}
                      totalRounds={3}
                      phaseLabel={phase.replace(/_/g, " ")}
                      visible
                    />
                  </div>
                )}

                {/* Jury Vote Panel (replaces center statement during vote) */}
                {showVotePanel && (
                  <div className="absolute top-[20px] left-1/2 -translate-x-1/2 z-30">
                    <JuryVotePanel
                      active={showVotePanel}
                      votes={juryVotes}
                      activeJurorIdx={activeJurorIdx}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Right evidence panel (defense) */}
            <div className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 z-30">
              <EvidencePanel
                side="defense"
                evidenceFor={defense?.evidenceFor ?? []}
                evidenceAgainst={defense?.evidenceAgainst ?? []}
                visible={isArgumentPhase}
              />
            </div>
          </div>

          {/* Bottom fade */}
          <div className="h-24 bg-gradient-to-t from-background to-transparent pointer-events-none shrink-0" />
        </div>

        {/* Verdict Sequence */}
        <VerdictSequence
          active={verdictState.active}
          verdict={verdictState.verdict}
          guiltyCount={verdictState.guiltyCount}
          notGuiltyCount={verdictState.notGuiltyCount}
          prosecutorName="IronClad"
          defenseName="Voltex"
          points={120}
          onDismiss={() => setVerdictState((prev) => ({ ...prev, active: false }))}
        />
      </section>

      {/* Section 3: Terminal Log */}
      <TrialTerminalLog logs={logs} />

      {/* Section 4: Leaderboard */}
      <TrialLeaderboard entries={LEADERBOARD_DATA} />

      {/* Dev Controls */}
      <div className="fixed bottom-4 right-4 z-[100] rounded-xl border border-border/50 bg-card/90 backdrop-blur-xl p-3 shadow-2xl">
        <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-mono mb-2">
          Dev Controls
        </p>
        <div className="flex flex-wrap gap-1.5 max-w-[220px]">
          {[
            { label: "Next Phase", action: nextPhase, color: "bg-sky-600 hover:bg-sky-500" },
            { label: "Next Speaker", action: nextSpeaker, color: "bg-teal-600 hover:bg-teal-500" },
            { label: "Trigger Vote", action: triggerVote, color: "bg-amber-600 hover:bg-amber-500" },
            {
              label: "Verdict: Guilty",
              action: () => triggerVerdict("GUILTY"),
              color: "bg-red-600 hover:bg-red-500",
            },
            {
              label: "Verdict: Not Guilty",
              action: () => triggerVerdict("NOT_GUILTY"),
              color: "bg-indigo-600 hover:bg-indigo-500",
            },
            { label: "Reset", action: resetGame, color: "bg-zinc-600 hover:bg-zinc-500" },
          ].map((btn) => (
            <button
              key={btn.label}
              onClick={btn.action}
              className={`rounded-md px-2.5 py-1 text-[10px] font-bold text-white transition-colors ${btn.color}`}
            >
              {btn.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
