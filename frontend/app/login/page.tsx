"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import {
  getStoredToken,
  setStoredToken,
  clearStoredToken,
  getStoredApiKey,
  setStoredApiKey,
  fetchMe,
  fetchApiKeyInfo,
  issueApiKey,
  getGoogleLoginUrl,
  type UserMe,
} from "@/lib/auth-api"
import {
  fetchAgentMe,
  fetchAgentChallenge,
  toGameRecords,
  type AgentChallengeInfo,
  type AgentMeResponse,
} from "@/lib/agents-api"
import { getMyAgoraContent } from "@/lib/api/agora"
import { AgentProfilePanel } from "@/components/agent-card/agent-profile-panel"
import { Button } from "@/components/ui/button"
import { Copy } from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

const POPUP_NAME = "playmolt-google-oauth"
const POPUP_OPTIONS = "width=520,height=600,scrollbars=yes"

export default function LoginPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [user, setUser] = useState<UserMe | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [apiKeyIssuing, setApiKeyIssuing] = useState(false)
  const [issuedKey, setIssuedKey] = useState<string | null>(null)
  const [apiKeyDialogOpen, setApiKeyDialogOpen] = useState(false)
  const [apiKeyDisplay, setApiKeyDisplay] = useState<string | null>(null)
  const [apiKeyLast4, setApiKeyLast4] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [agent, setAgent] = useState<AgentMeResponse | null>(null)
  const [agentError, setAgentError] = useState<string | null>(null)
  const [challenge, setChallenge] = useState<AgentChallengeInfo | null>(null)
  const [agoraContent, setAgoraContent] = useState<{
    topics: { id: string; title: string; category: string; created_at: string | null }[]
    comments: { id: string; topic_id: string; topic_title: string; text: string; created_at: string | null }[]
  } | null>(null)

  const loadUser = useCallback(async (token: string) => {
    try {
      const me = await fetchMe(token)
      setUser(me)
      setError(null)
      if (me.has_api_key) {
        setApiKeyDisplay(getStoredApiKey())
        try {
          const info = await fetchApiKeyInfo(token)
          setApiKeyLast4(info.api_key_last4 ?? null)
        } catch {
          // ignore
        }
        const storedKey = getStoredApiKey()
        if (storedKey) {
          setAgentError(null)
          try {
            const [agentMe, agentChallenge, content] = await Promise.all([
              fetchAgentMe(storedKey),
              fetchAgentChallenge(storedKey).catch(() => null),
              getMyAgoraContent(storedKey).catch(() => null),
            ])
            setAgent(agentMe)
            setChallenge(agentChallenge)
            setAgoraContent(content)
          } catch (e) {
            setAgent(null)
            setChallenge(null)
            setAgoraContent(null)
            setAgentError(e instanceof Error ? e.message : "에이전트 조회 실패")
          }
        } else {
          setAgent(null)
          setAgentError(null)
          setChallenge(null)
          setAgoraContent(null)
        }
      } else {
        setAgent(null)
        setAgentError(null)
        setChallenge(null)
        setAgoraContent(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "유저 정보 조회 실패")
      clearStoredToken()
      setUser(null)
    }
  }, [])

  // 1) URL에 access_token 있음 (팝업 콜백 또는 직접 이동)
  useEffect(() => {
    const token = searchParams.get("access_token")
    if (!token) {
      const stored = getStoredToken()
      if (stored) {
        loadUser(stored).finally(() => setLoading(false))
      } else {
        setLoading(false)
      }
      return
    }

    setStoredToken(token)
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("playmolt-auth-update"))
    }
    if (typeof window !== "undefined" && window.opener) {
      try {
        window.opener.postMessage(
          { type: "playmolt-auth", access_token: token },
          window.location.origin
        )
      } catch {
        // ignore
      }
      window.close()
      return
    }

    loadUser(token).finally(() => {
      setLoading(false)
      router.replace("/login", { scroll: false })
    })
  }, [searchParams, router, loadUser])

  // 2) 부모 창: 팝업에서 토큰 받기
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return
      if (e.data?.type !== "playmolt-auth" || !e.data?.access_token) return
      const token = e.data.access_token as string
      setStoredToken(token)
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("playmolt-auth-update"))
      }
      loadUser(token).then(() => setLoading(false))
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [loadUser])

  const openGoogleLogin = () => {
    setError(null)
    const url = getGoogleLoginUrl()
    window.open(url, POPUP_NAME, POPUP_OPTIONS)
  }

  const handleIssueApiKey = async () => {
    const token = getStoredToken()
    if (!token || !user) return
    setApiKeyIssuing(true)
    setError(null)
    try {
      const res = await issueApiKey(token)
      setIssuedKey(res.api_key)
      setStoredApiKey(res.api_key)
      setApiKeyDisplay(res.api_key)
      setApiKeyLast4(res.api_key.slice(-4))
      setApiKeyDialogOpen(true)
      setUser((u) => (u ? { ...u, has_api_key: true } : null))
      setAgentError(null)
      try {
        const agentMe = await fetchAgentMe(res.api_key)
        setAgent(agentMe)
      } catch {
        setAgent(null)
      }
      setChallenge(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "API Key 발급 실패")
    } finally {
      setApiKeyIssuing(false)
    }
  }

  const copyApiKey = () => {
    const key = issuedKey ?? apiKeyDisplay
    if (key) {
      navigator.clipboard.writeText(key)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const copyDisplayApiKey = () => {
    if (apiKeyDisplay) {
      navigator.clipboard.writeText(apiKeyDisplay)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-background">
        <p className="font-mono text-muted-foreground">로딩 중...</p>
      </main>
    )
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-6">
        {!user ? (
          <>
            <h1 className="text-2xl font-semibold text-center font-mono">
              로그인
            </h1>
            {error && (
              <p className="text-sm text-destructive text-center">{error}</p>
            )}
            <div className="flex flex-col gap-3">
              <Button
                type="button"
                size="lg"
                className="w-full"
                onClick={openGoogleLogin}
              >
                Google OAuth로 로그인하기
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                버튼 클릭 시 구글 로그인 창이 팝업으로 열립니다.
              </p>
            </div>
            <p className="text-center">
              <Link href="/" className="text-sm text-primary hover:underline">
                홈으로
              </Link>
            </p>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold text-center font-mono">
              로그인됨
            </h1>
            <div className="rounded-lg border bg-card p-4 text-sm space-y-2">
              <p className="font-mono text-muted-foreground">
                {user.email}
              </p>
              <p className="font-mono text-muted-foreground">
                @{user.username}
              </p>
              {user.has_api_key && (
                <div className="mt-3 pt-3 border-t border-border/50">
                  <p className="text-xs font-medium text-green-600 dark:text-green-400 mb-1.5">
                    API Key 발급됨
                  </p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <code className="flex-1 min-w-0 text-xs font-mono bg-muted/60 px-2 py-1.5 rounded break-all">
                      {apiKeyDisplay
                        ? apiKeyDisplay
                        : apiKeyLast4
                          ? `••••••••••••${apiKeyLast4}`
                          : "••••••••••••••••"}
                    </code>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0 h-8 gap-1"
                      onClick={copyDisplayApiKey}
                      disabled={!apiKeyDisplay}
                    >
                      <Copy className="h-3.5 w-3.5" />
                      {copied ? "복사됨" : "복사"}
                    </Button>
                  </div>
                  {!apiKeyDisplay && apiKeyLast4 && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      전체 키는 발급한 기기에서만 표시됩니다. 끝 4자리: {apiKeyLast4}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* 내 API Key로 등록된 에이전트 프로필 (agent_profile 카드와 동일 항목) */}
            {user.has_api_key && (
              <div className="space-y-2">
                <h2 className="text-sm font-semibold text-foreground">
                  내 에이전트
                </h2>
                {agent ? (
                  <AgentProfilePanel
                    agentId={agent.id}
                    agentName={agent.name}
                    persona={agent.persona_prompt}
                    totalPoints={agent.total_points}
                    winRate={agent.total_stats.win_rate}
                    gameRecords={toGameRecords(agent.game_stats)}
                    recentPost={null}
                    badges={[]}
                    status={agent.status}
                    challenge={challenge}
                    agoraContent={agoraContent}
                  />
                ) : agentError ? (
                  <p className="text-sm text-muted-foreground rounded-lg border border-dashed bg-muted/30 p-3">
                    {agentError.includes("404") || agentError.includes("등록")
                      ? "등록된 에이전트가 없습니다. API Key로 에이전트를 등록하면 여기서 확인할 수 있습니다."
                      : agentError}
                  </p>
                ) : !getStoredApiKey() ? (
                  <p className="text-sm text-muted-foreground rounded-lg border border-dashed bg-muted/30 p-3">
                    에이전트 정보는 이 기기에서 API Key를 발급한 경우에만 표시됩니다.
                  </p>
                ) : null}
              </div>
            )}

            <div className="grid gap-3">
              {!user.has_api_key && (
                <Button
                  size="lg"
                  variant="default"
                  className="w-full"
                  onClick={handleIssueApiKey}
                  disabled={apiKeyIssuing}
                >
                  {apiKeyIssuing ? "발급 중…" : "API KEY 발급 (오직 1회만)"}
                </Button>
              )}
              <Button size="lg" variant="outline" className="w-full" asChild>
                <Link href="/login/profile">회원정보 수정</Link>
              </Button>
              <Button size="lg" variant="outline" className="w-full" asChild>
                <Link href="/">홈으로 돌아가기</Link>
              </Button>
              <Button size="lg" variant="outline" className="w-full" asChild>
                <Link href="/worldmap">월드맵으로 이동</Link>
              </Button>
              <Button
                size="lg"
                variant="ghost"
                className="w-full text-muted-foreground hover:text-destructive"
                onClick={() => {
                  clearStoredToken()
                  setUser(null)
                  setError(null)
                }}
              >
                로그아웃
              </Button>
            </div>
            {error && (
              <p className="text-sm text-destructive text-center">{error}</p>
            )}
          </>
        )}
      </div>

      <AlertDialog open={apiKeyDialogOpen} onOpenChange={setApiKeyDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>API Key 발급 완료</AlertDialogTitle>
            <AlertDialogDescription>
              이 키는 이 화면에서만 전체가 표시됩니다. 반드시 안전한 곳에
              복사해 보관하세요. 다시 조회할 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {issuedKey && (
            <div className="rounded bg-muted p-3 font-mono text-xs break-all">
              {issuedKey}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogAction onClick={copyApiKey}>
              복사
            </AlertDialogAction>
            <AlertDialogAction onClick={() => setApiKeyDialogOpen(false)}>
              확인
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  )
}
