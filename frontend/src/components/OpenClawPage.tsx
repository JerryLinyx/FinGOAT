import { useEffect, useMemo, useRef, useState } from 'react'
import '../OpenClawPage.css'
import {
  extractMessageText,
  OpenClawGatewayClient,
  parseAgentSessionKey,
  parseOpenClawDashboardInput,
  type AgentsListResult,
  type ChatEventPayload,
  type GatewayAgentRow,
  type GatewayHelloOk,
  type GatewaySessionRow,
  type SessionsListResult,
} from '../services/openclawGateway'

const OPENCLAW_CONFIG_STORAGE_KEY = 'fingoat_openclaw_config'
const OPENCLAW_BINDINGS_STORAGE_KEY = 'fingoat_openclaw_bindings'
const OPENCLAW_ROLE_SESSION_STORAGE_KEY = 'fingoat_openclaw_role_sessions'

const REQUIRED_ROLES = [
  { id: 'market', label: 'Market Analyst' },
  { id: 'social', label: 'Social Analyst' },
  { id: 'news', label: 'News Analyst' },
  { id: 'fundamentals', label: 'Fundamentals Analyst' },
] as const

type RequiredRoleId = typeof REQUIRED_ROLES[number]['id']
type RoleBindings = Record<RequiredRoleId, string>
type RoleSessions = Partial<Record<RequiredRoleId, string>>

type PersistedGatewayConfig = {
  dashboardUrl: string
}

type MessageEntry = {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  timestamp?: number
}

function readStoredJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') {
    return fallback
  }
  const raw = window.localStorage.getItem(key)
  if (!raw) {
    return fallback
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeStoredJson<T>(key: string, value: T) {
  if (typeof window === 'undefined') {
    return
  }
  window.localStorage.setItem(key, JSON.stringify(value))
}

function buildDefaultSessionKey(agentId: string, role: RequiredRoleId): string {
  return `agent:${agentId}:web:chat:fingoat:${role}`
}

function buildNewSessionKey(agentId: string, role: RequiredRoleId): string {
  return `agent:${agentId}:web:chat:fingoat:${role}:thread:${Date.now()}`
}

function normalizeChatMessages(messages: Array<unknown>): MessageEntry[] {
  return messages
    .map((message, index) => {
      if (!message || typeof message !== 'object') {
        return null
      }
      const entry = message as Record<string, unknown>
      const role = typeof entry.role === 'string' ? entry.role.toLowerCase() : 'assistant'
      const text = extractMessageText(message).trim()
      if (!text) {
        return null
      }
      const timestamp =
        typeof entry.timestamp === 'number'
          ? entry.timestamp
          : typeof entry.ts === 'number'
            ? entry.ts
            : undefined
      const normalized: MessageEntry = {
        id: `${role}-${timestamp ?? index}`,
        role: role === 'user' || role === 'assistant' ? role : 'system',
        text,
        timestamp,
      }
      return normalized
    })
    .filter((message): message is MessageEntry => message !== null)
}

function formatSessionLabel(session: GatewaySessionRow): string {
  return session.displayName?.trim() || session.label?.trim() || session.key
}

function formatTimestamp(timestamp?: number): string {
  if (!timestamp) {
    return 'No activity yet'
  }
  return new Date(timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function resolveAgentName(agent: GatewayAgentRow): string {
  return agent.identity?.name?.trim() || agent.name?.trim() || agent.id
}

export function OpenClawPage() {
  const storedConfig = readStoredJson<PersistedGatewayConfig>(OPENCLAW_CONFIG_STORAGE_KEY, {
    dashboardUrl: '',
  })
  const [dashboardUrl, setDashboardUrl] = useState(storedConfig.dashboardUrl)
  const [gatewayStatus, setGatewayStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected')
  const [gatewayError, setGatewayError] = useState('')
  const [hello, setHello] = useState<GatewayHelloOk | null>(null)
  const [agents, setAgents] = useState<AgentsListResult | null>(null)
  const [sessions, setSessions] = useState<SessionsListResult | null>(null)
  const [loadingAgents, setLoadingAgents] = useState(false)
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [bindings, setBindings] = useState<RoleBindings>(() =>
    readStoredJson<RoleBindings>(OPENCLAW_BINDINGS_STORAGE_KEY, {
      market: '',
      social: '',
      news: '',
      fundamentals: '',
    }),
  )
  const [roleSessions, setRoleSessions] = useState<RoleSessions>(() =>
    readStoredJson<RoleSessions>(OPENCLAW_ROLE_SESSION_STORAGE_KEY, {}),
  )
  const [activeRole, setActiveRole] = useState<RequiredRoleId>('market')
  const [chatMessages, setChatMessages] = useState<MessageEntry[]>([])
  const [chatDraft, setChatDraft] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [chatSending, setChatSending] = useState(false)
  const [chatRunId, setChatRunId] = useState<string | null>(null)
  const [chatStream, setChatStream] = useState('')
  const [chatError, setChatError] = useState('')
  const clientRef = useRef<OpenClawGatewayClient | null>(null)
  const currentSessionKeyRef = useRef('')
  const loadChatHistoryRef = useRef<(sessionKey: string) => Promise<void>>(async () => { })
  const loadSessionsRef = useRef<() => Promise<void>>(async () => { })

  useEffect(() => {
    writeStoredJson(OPENCLAW_CONFIG_STORAGE_KEY, { dashboardUrl })
  }, [dashboardUrl])

  useEffect(() => {
    writeStoredJson(OPENCLAW_BINDINGS_STORAGE_KEY, bindings)
  }, [bindings])

  useEffect(() => {
    writeStoredJson(OPENCLAW_ROLE_SESSION_STORAGE_KEY, roleSessions)
  }, [roleSessions])

  useEffect(() => {
    return () => {
      clientRef.current?.stop()
      clientRef.current = null
    }
  }, [])

  const allRolesMatched = useMemo(() => {
    return REQUIRED_ROLES.every((role) => Boolean(bindings[role.id]?.trim()))
  }, [bindings])

  const agentMap = useMemo(() => {
    const next = new Map<string, GatewayAgentRow>()
    for (const agent of agents?.agents ?? []) {
      next.set(agent.id, agent)
    }
    return next
  }, [agents])

  const activeAgentId = bindings[activeRole]?.trim() || ''
  const activeAgent = activeAgentId ? agentMap.get(activeAgentId) ?? null : null

  const filteredSessions = useMemo(() => {
    if (!activeAgentId) {
      return []
    }
    return (sessions?.sessions ?? []).filter((session) => {
      const parsed = parseAgentSessionKey(session.key)
      return parsed?.agentId === activeAgentId.toLowerCase()
    })
  }, [activeAgentId, sessions])

  const currentSessionKey = useMemo(() => {
    if (!activeAgentId) {
      return ''
    }
    const stored = roleSessions[activeRole]
    if (stored) {
      return stored
    }
    const dedicated = buildDefaultSessionKey(activeAgentId, activeRole)
    return dedicated
  }, [activeAgentId, activeRole, roleSessions])

  useEffect(() => {
    currentSessionKeyRef.current = currentSessionKey
  }, [currentSessionKey])

  async function loadAgents(client = clientRef.current) {
    if (!client) {
      return
    }
    setLoadingAgents(true)
    try {
      const result = await client.request<AgentsListResult>('agents.list', {})
      setAgents(result)
      setGatewayError('')
      setBindings((prev) => {
        const available = new Set(result.agents.map((agent) => agent.id))
        const next = { ...prev }
        for (const role of REQUIRED_ROLES) {
          if (next[role.id] && !available.has(next[role.id])) {
            next[role.id] = ''
          }
        }
        return next
      })
    } catch (error) {
      setGatewayError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoadingAgents(false)
    }
  }

  async function loadSessions(client = clientRef.current) {
    if (!client) {
      return
    }
    setLoadingSessions(true)
    try {
      const result = await client.request<SessionsListResult>('sessions.list', {})
      setSessions(result)
      setGatewayError('')
    } catch (error) {
      setGatewayError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoadingSessions(false)
    }
  }

  useEffect(() => {
    loadSessionsRef.current = () => loadSessions()
    loadChatHistoryRef.current = (sessionKey: string) => loadChatHistory(sessionKey)
  })

  async function loadChatHistory(sessionKey: string) {
    if (!clientRef.current || !sessionKey) {
      return
    }
    setChatLoading(true)
    setChatError('')
    try {
      const result = await clientRef.current.request<{ messages?: Array<unknown> }>('chat.history', {
        sessionKey,
        limit: 200,
      })
      setChatMessages(normalizeChatMessages(Array.isArray(result.messages) ? result.messages : []))
      setChatStream('')
      setChatRunId(null)
    } catch (error) {
      setChatError(error instanceof Error ? error.message : String(error))
    } finally {
      setChatLoading(false)
    }
  }

  function handleGatewayEvent(payload: ChatEventPayload) {
    if (!payload.sessionKey || payload.sessionKey !== currentSessionKeyRef.current) {
      return
    }
    if (payload.state === 'delta') {
      setChatStream(extractMessageText(payload.message).trim())
      return
    }
    if (payload.state === 'final') {
      const finalText = extractMessageText(payload.message).trim()
      if (finalText) {
        setChatMessages((prev) => [
          ...prev,
          {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            text: finalText,
            timestamp: Date.now(),
          },
        ])
      } else {
        void loadChatHistoryRef.current(payload.sessionKey)
      }
      setChatRunId(null)
      setChatStream('')
      void loadSessionsRef.current()
      return
    }
    if (payload.state === 'aborted') {
      setChatRunId(null)
      setChatStream('')
      return
    }
    if (payload.state === 'error') {
      setChatRunId(null)
      setChatStream('')
      setChatError(payload.errorMessage || 'OpenClaw chat error')
    }
  }

  async function connectGateway() {
    try {
      setGatewayStatus('connecting')
      setGatewayError('')
      const parsed = parseOpenClawDashboardInput(dashboardUrl)
      clientRef.current?.stop()
      const client = new OpenClawGatewayClient({
        wsUrl: parsed.wsUrl,
        token: parsed.token,
        onHello: (nextHello) => {
          setHello(nextHello)
          setGatewayStatus('connected')
          void loadAgents(client)
          void loadSessions(client)
        },
        onEvent: (event) => {
          if (event.event === 'chat') {
            handleGatewayEvent(event.payload as ChatEventPayload)
          }
        },
        onClose: (info) => {
          setGatewayStatus('disconnected')
          if (info.error) {
            setGatewayError(info.error)
          }
        },
      })
      clientRef.current = client
      client.start()
    } catch (error) {
      setGatewayStatus('disconnected')
      setGatewayError(error instanceof Error ? error.message : String(error))
    }
  }

  function disconnectGateway() {
    clientRef.current?.stop()
    clientRef.current = null
    setGatewayStatus('disconnected')
    setHello(null)
    setChatRunId(null)
    setChatStream('')
  }

  function handleBindingChange(role: RequiredRoleId, agentId: string) {
    setBindings((prev) => ({
      ...prev,
      [role]: agentId,
    }))
    setRoleSessions((prev) => ({
      ...prev,
      [role]: agentId ? buildDefaultSessionKey(agentId, role) : '',
    }))
    if (role === activeRole) {
      setChatMessages([])
      setChatStream('')
      setChatError('')
    }
  }

  function handleNewChat() {
    if (!activeAgentId) {
      return
    }
    const nextSessionKey = buildNewSessionKey(activeAgentId, activeRole)
    setRoleSessions((prev) => ({
      ...prev,
      [activeRole]: nextSessionKey,
    }))
    setChatMessages([])
    setChatStream('')
    setChatError('')
  }

  async function handleSendChat(event: React.FormEvent) {
    event.preventDefault()
    if (!clientRef.current || !currentSessionKey || !chatDraft.trim()) {
      return
    }

    const message = chatDraft.trim()
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    setChatMessages((prev) => [
      ...prev,
      {
        id: `user-${Date.now()}`,
        role: 'user',
        text: message,
        timestamp: Date.now(),
      },
    ])
    setChatDraft('')
    setChatSending(true)
    setChatError('')
    setChatRunId(runId)
    setChatStream('')

    try {
      await clientRef.current.request('chat.send', {
        sessionKey: currentSessionKey,
        message,
        deliver: false,
        idempotencyKey: runId,
      })
      setRoleSessions((prev) => ({
        ...prev,
        [activeRole]: currentSessionKey,
      }))
    } catch (error) {
      setChatRunId(null)
      setChatStream('')
      setChatError(error instanceof Error ? error.message : String(error))
    } finally {
      setChatSending(false)
    }
  }

  useEffect(() => {
    if (gatewayStatus !== 'connected' || !activeAgentId || !currentSessionKey || !allRolesMatched) {
      return
    }
    void loadChatHistory(currentSessionKey)
  }, [activeAgentId, allRolesMatched, currentSessionKey, gatewayStatus])

  const disabledReason =
    gatewayStatus !== 'connected'
      ? 'Connect your local OpenClaw dashboard first.'
      : !allRolesMatched
        ? 'Match all required analyst roles before chatting.'
        : !activeAgentId
          ? 'Select an agent binding for this role.'
          : null

  return (
    <div className="openclaw-page">
      <section className="openclaw-shell">
        <div className="openclaw-layout">
          <aside className="openclaw-sidebar card-surface">
            <div className="openclaw-sidebar-top">
              <div className="openclaw-sidebar-title">
                <p className="openclaw-eyebrow">OpenClaw Local</p>
                <div className="openclaw-title-with-info">
                  <h2>Agent Match</h2>
                  <span className="openclaw-info-icon" data-tooltip="Detect registered agents from your local OpenClaw gateway, map them to analyst roles, then chat.">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                  </span>
                </div>
              </div>
              <div className={`openclaw-status-pill openclaw-status-pill--${gatewayStatus}`}>
                <span className="openclaw-status-dot" />
                {gatewayStatus === 'connected' ? 'Connected' : gatewayStatus === 'connecting' ? 'Connecting' : 'Disconnected'}
              </div>
            </div>

            <div className="openclaw-sidebar-connect">
              <label className="openclaw-field">
                <input
                  type="text"
                  value={dashboardUrl}
                  onChange={(event) => setDashboardUrl(event.target.value)}
                  placeholder="Dashboard URL..."
                  aria-label="Dashboard URL"
                />
              </label>
              <div className="openclaw-connect-actions">
                <button type="button" className="openclaw-button" onClick={connectGateway} disabled={gatewayStatus === 'connecting'}>
                  {gatewayStatus === 'connected' ? 'Reconnect' : 'Connect'}
                </button>
                <button type="button" className="openclaw-button openclaw-button--ghost" onClick={disconnectGateway}>
                  Disconnect
                </button>
              </div>
              <div className="openclaw-connect-meta">
                <span>Protocol {hello?.protocol ?? '—'}</span>
                <span>Role {hello?.auth?.role ?? 'operator'}</span>
                <span>{agents?.agents.length ?? 0} agents detected</span>
              </div>
              {gatewayError && <div className="openclaw-inline-error">{gatewayError}</div>}
            </div>

            <hr className="openclaw-divider" />

            <div className="openclaw-panel-head">
              <div className="openclaw-title-with-info">
                <h3>Analyst Match</h3>
                <span className="openclaw-info-icon" data-tooltip={loadingAgents ? 'Refreshing registered agents…' : 'Choose which existing OpenClaw agent should play each analyst role.'}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                </span>
              </div>
              <button type="button" className="openclaw-link-button" onClick={() => {
                void loadAgents()
                void loadSessions()
              }}>
                Refresh
              </button>
            </div>
            <div className="openclaw-role-list">
              {REQUIRED_ROLES.map((role) => (
                <label key={role.id} className="openclaw-role-card">
                  <div className="openclaw-role-copy">
                    <strong>{role.label}</strong>
                    <span>{bindings[role.id] ? `Matched to ${bindings[role.id]}` : 'Unmatched'}</span>
                  </div>
                  <select
                    value={bindings[role.id]}
                    onChange={(event) => handleBindingChange(role.id, event.target.value)}
                    disabled={gatewayStatus !== 'connected'}
                  >
                    <option value="">Select agent…</option>
                    {(agents?.agents ?? []).map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {resolveAgentName(agent)} ({agent.id})
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>

            <div className={`openclaw-gate ${allRolesMatched ? 'openclaw-gate--ready' : ''}`}>
              {allRolesMatched ? 'All analyst roles matched. Chat is unlocked.' : 'Chat stays locked until all four roles are matched.'}
            </div>

            <div className="openclaw-panel-head openclaw-panel-head--spaced">
              <h3>Detected Agents</h3>
              <span>{loadingSessions ? 'Loading sessions…' : `${sessions?.sessions.length ?? 0} sessions`}</span>
            </div>
            <div className="openclaw-agent-list">
              {(agents?.agents ?? []).map((agent) => (
                <div key={agent.id} className={`openclaw-agent-chip ${activeAgentId === agent.id ? 'openclaw-agent-chip--active' : ''}`}>
                  <span className="openclaw-agent-chip-title">{resolveAgentName(agent)}</span>
                  <span className="openclaw-agent-chip-id">{agent.id}</span>
                </div>
              ))}
            </div>
          </aside>

          <section className="openclaw-chat card-surface">
            <div className="openclaw-panel-head">
              <div className="openclaw-title-with-info">
                <h3>OpenClaw Chat</h3>
                <span className="openclaw-info-icon" data-tooltip="Switch roles, pick a session for the mapped agent, and continue the conversation inside FinGOAT.">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                </span>
              </div>
              <button type="button" className="openclaw-button openclaw-button--ghost" onClick={handleNewChat} disabled={!activeAgentId || !allRolesMatched}>
                New Chat
              </button>
            </div>

            <div className="openclaw-role-tabs">
              {REQUIRED_ROLES.map((role) => (
                <button
                  key={role.id}
                  type="button"
                  className={`openclaw-role-tab ${activeRole === role.id ? 'openclaw-role-tab--active' : ''}`}
                  onClick={() => setActiveRole(role.id)}
                >
                  {role.label}
                </button>
              ))}
            </div>

            <div className="openclaw-session-bar">
              <div>
                <strong>{activeAgent ? resolveAgentName(activeAgent) : 'No agent selected'}</strong>
                <p>{currentSessionKey || 'No session key yet'}</p>
              </div>
              <select
                value={currentSessionKey}
                onChange={(event) =>
                  setRoleSessions((prev) => ({
                    ...prev,
                    [activeRole]: event.target.value,
                  }))
                }
                disabled={!activeAgentId || filteredSessions.length === 0}
              >
                {filteredSessions.length === 0 ? (
                  <option value={currentSessionKey}>{currentSessionKey || 'No existing sessions'}</option>
                ) : (
                  filteredSessions.map((session) => (
                    <option key={session.key} value={session.key}>
                      {formatSessionLabel(session)}
                    </option>
                  ))
                )}
              </select>
            </div>

            {disabledReason ? (
              <div className="openclaw-chat-gate">{disabledReason}</div>
            ) : (
              <>
                <div className="openclaw-message-list">
                  {chatLoading ? (
                    <div className="openclaw-chat-empty">Loading session history…</div>
                  ) : chatMessages.length === 0 && !chatStream ? (
                    <div className="openclaw-chat-empty">
                      Start a new conversation with {activeAgent ? resolveAgentName(activeAgent) : 'the mapped agent'}.
                    </div>
                  ) : (
                    <>
                      {chatMessages.map((message) => (
                        <article key={message.id} className={`openclaw-message openclaw-message--${message.role}`}>
                          <header>
                            <strong>{message.role === 'user' ? 'You' : message.role === 'assistant' ? 'OpenClaw' : 'System'}</strong>
                            {message.timestamp ? <span>{formatTimestamp(message.timestamp)}</span> : null}
                          </header>
                          <div>{message.text}</div>
                        </article>
                      ))}
                      {chatStream && (
                        <article className="openclaw-message openclaw-message--assistant openclaw-message--streaming">
                          <header>
                            <strong>OpenClaw</strong>
                            <span>Streaming…</span>
                          </header>
                          <div>{chatStream}</div>
                        </article>
                      )}
                    </>
                  )}
                </div>

                <form className="openclaw-composer" onSubmit={handleSendChat}>
                  <textarea
                    value={chatDraft}
                    onChange={(event) => setChatDraft(event.target.value)}
                    placeholder={`Message ${activeAgent ? resolveAgentName(activeAgent) : 'the selected agent'}…`}
                    disabled={chatSending || Boolean(chatRunId)}
                  />
                  <div className="openclaw-composer-actions">
                    <span>{chatError || (chatRunId ? 'Run in progress…' : 'Messages stay inside your local OpenClaw gateway.')}</span>
                    <button type="submit" className="openclaw-button" disabled={chatSending || !chatDraft.trim()}>
                      {chatSending ? 'Sending…' : 'Send'}
                    </button>
                  </div>
                </form>
              </>
            )}
          </section>
        </div>
      </section>
    </div>
  )
}
