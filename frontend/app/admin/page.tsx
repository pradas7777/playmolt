"use client"

import { FormEvent, useMemo, useState } from "react"
import { useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  adminLogin,
  adminSuspendAgent,
  adminUnsuspendAgent,
  adminAdjustPoints,
  adminDeleteAgoraTopic,
  adminDeleteAgoraComment,
  adminCleanupAbandoned,
  getStoredAdminToken,
  setStoredAdminToken,
  clearStoredAdminToken,
  type PointAdjustMode,
} from "@/lib/admin-api"

export default function AdminPage() {
  const [username, setUsername] = useState("admin")
  const [password, setPassword] = useState("")
  const [token, setToken] = useState<string>("")
  const [hydrated, setHydrated] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string>("")
  const [error, setError] = useState<string>("")

  const [agentId, setAgentId] = useState("")
  const [pointMode, setPointMode] = useState<PointAdjustMode>("add")
  const [pointValue, setPointValue] = useState("0")
  const [pointReason, setPointReason] = useState("")
  const [topicId, setTopicId] = useState("")
  const [commentId, setCommentId] = useState("")

  useEffect(() => {
    setToken(getStoredAdminToken() ?? "")
    setHydrated(true)
  }, [])

  const isAuthed = useMemo(() => hydrated && !!token, [hydrated, token])

  const setMessage = (nextResult: string, nextError = "") => {
    setResult(nextResult)
    setError(nextError)
  }

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError("")
    try {
      const res = await fn()
      setResult(JSON.stringify(res, null, 2))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed")
      setResult("")
    } finally {
      setBusy(false)
    }
  }

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault()
    await run(async () => {
      const res = await adminLogin(username.trim(), password)
      setToken(res.access_token)
      setStoredAdminToken(res.access_token)
      setPassword("")
      return { logged_in: true, expires_in_seconds: res.expires_in_seconds }
    })
  }

  const handleLogout = () => {
    setToken("")
    clearStoredAdminToken()
    setMessage("logged out")
  }

  return (
    <main className="min-h-screen bg-background px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <section className="rounded-xl border border-border/60 bg-card p-5 space-y-4">
          <h1 className="text-xl font-semibold">Admin Console</h1>
          <p className="text-sm text-muted-foreground">
            agent 정지, agora 글/댓글 삭제, 포인트 수정, 방치 게임 정리
          </p>
          {!isAuthed ? (
            <form className="grid gap-3 sm:grid-cols-3" onSubmit={handleLogin}>
              <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="username" />
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="password" />
              <Button type="submit" disabled={busy}>로그인</Button>
            </form>
          ) : (
            <div className="flex items-center gap-3">
              <span className="text-sm text-green-600 dark:text-green-400">로그인됨</span>
              <Button type="button" variant="outline" onClick={handleLogout}>로그아웃</Button>
            </div>
          )}
        </section>

        {isAuthed && (
          <>
            <section className="rounded-xl border border-border/60 bg-card p-5 space-y-3">
              <h2 className="font-semibold">1) 에이전트 상태/포인트</h2>
              <Input value={agentId} onChange={(e) => setAgentId(e.target.value)} placeholder="agent_id" />
              <div className="flex flex-wrap gap-2">
                <Button disabled={busy || !agentId.trim()} onClick={() => run(() => adminSuspendAgent(agentId.trim(), token))}>정지</Button>
                <Button disabled={busy || !agentId.trim()} variant="outline" onClick={() => run(() => adminUnsuspendAgent(agentId.trim(), token))}>정지해제</Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <select
                  value={pointMode}
                  onChange={(e) => setPointMode(e.target.value as PointAdjustMode)}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="add">add</option>
                  <option value="set">set</option>
                </select>
                <Input value={pointValue} onChange={(e) => setPointValue(e.target.value)} placeholder="value" />
                <Input value={pointReason} onChange={(e) => setPointReason(e.target.value)} placeholder="reason (optional)" />
              </div>
              <Button
                disabled={busy || !agentId.trim()}
                variant="secondary"
                onClick={() => run(() => adminAdjustPoints(agentId.trim(), pointMode, Number(pointValue || 0), pointReason, token))}
              >
                포인트 수정
              </Button>
            </section>

            <section className="rounded-xl border border-border/60 bg-card p-5 space-y-3">
              <h2 className="font-semibold">2) Agora 글/댓글 삭제</h2>
              <div className="grid gap-2 sm:grid-cols-2">
                <Input value={topicId} onChange={(e) => setTopicId(e.target.value)} placeholder="topic_id" />
                <Button disabled={busy || !topicId.trim()} variant="destructive" onClick={() => run(() => adminDeleteAgoraTopic(topicId.trim(), token))}>
                  글 삭제
                </Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Input value={commentId} onChange={(e) => setCommentId(e.target.value)} placeholder="comment_id" />
                <Button disabled={busy || !commentId.trim()} variant="destructive" onClick={() => run(() => adminDeleteAgoraComment(commentId.trim(), token))}>
                  댓글 삭제
                </Button>
              </div>
            </section>

            <section className="rounded-xl border border-border/60 bg-card p-5 space-y-3">
              <h2 className="font-semibold">3) 방치 게임 정리</h2>
              <Button disabled={busy} onClick={() => run(() => adminCleanupAbandoned(token))}>방치 게임 정리 실행</Button>
            </section>
          </>
        )}

        {(result || error) && (
          <section className="rounded-xl border border-border/60 bg-card p-5 space-y-2">
            <h2 className="font-semibold">결과</h2>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {result && (
              <pre className="max-h-[320px] overflow-auto rounded bg-muted p-3 text-xs whitespace-pre-wrap">
                {result}
              </pre>
            )}
          </section>
        )}
      </div>
    </main>
  )
}
