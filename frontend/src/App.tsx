import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ChangeEvent, FormEvent, KeyboardEvent, CompositionEvent } from 'react'
import './App.css'

type AuthMode = 'login' | 'register'
type View = 'auth' | 'home'
type Theme = 'light' | 'dark'

type Article = {
  id: number
  title: string
  content: string
  preview: string
  createdAt?: string
}

type ChatMessage = {
  id: number
  role: 'user' | 'bot'
  author: string
  text: string
}

type ThemeContextValue = {
  theme: Theme
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light',
  toggleTheme: () => {},
})

const ThemeToggleButton = () => {
  const { theme, toggleTheme } = useContext(ThemeContext)
  return (
    <button type="button" className="theme-toggle" onClick={toggleTheme} aria-label="Toggle theme">
      {theme === 'light' ? (
        <svg viewBox="0 0 24 24" role="presentation" width="18" height="18">
          <path
            d="M21 13.5A8.5 8.5 0 0 1 10.5 3 6.5 6.5 0 1 0 21 13.5Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" role="presentation" width="18" height="18">
          <circle cx="12" cy="12" r="4.5" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l-1.5-1.5M20.5 20.5 19 19M5 19l-1.5 1.5M20.5 3.5 19 5" stroke="currentColor" strokeWidth="2" />
        </svg>
      )}
    </button>
  )
}

const PanelIcon = ({ type }: { type: 'config' | 'chat' | 'news' }) => {
  const icon = {
    config: (
      <>
        <circle cx="16" cy="16" r="6.5" fill="none" strokeWidth="2" />
        <path d="M8 16h16M12 10h8M12 22h8" strokeWidth="2" strokeLinecap="round" />
      </>
    ),
    chat: (
      <>
        <path
          d="M7 9h18v11H17l-5.5 4v-4H7z"
          fill="none"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <circle cx="12" cy="14" r="1" fill="currentColor" />
        <circle cx="16" cy="14" r="1" fill="currentColor" />
        <circle cx="20" cy="14" r="1" fill="currentColor" />
      </>
    ),
    news: (
      <>
        <rect x="9" y="7" width="14" height="18" rx="3" fill="none" strokeWidth="2" />
        <path d="M12 11h8M12 15h8M12 19h5" strokeWidth="2" strokeLinecap="round" />
      </>
    ),
  }[type]

  return (
    <span className="panel-icon" aria-hidden="true">
      <svg viewBox="0 0 32 32" role="presentation" stroke="currentColor" fill="none">
        {icon}
      </svg>
    </span>
  )
}

const TOKEN_STORAGE_KEY = 'fingoat_token'
const API_BASE_URL =
  import.meta.env.VITE_API_URL?.replace(/\/$/, '') || 'http://localhost:3000'

const initialForm = {
  username: '',
  password: '',
  confirmPassword: '',
}

const NAV_LINKS = [
  { label: 'Dashboard', status: 'Live' },
  { label: 'Markets', status: 'TODO' },
  { label: 'Portfolio', status: 'TODO' },
  { label: 'History', status: 'TODO' },
] as const

const AI_MESSAGES = [
  {
    id: 1,
    role: 'bot' as const,
    author: 'FG',
    text: "Hello! I'm FinGOAT, your agentic trading co-pilot. I'm currently tracking S&P 500 futures—what do you want to explore today?",
  },
  {
    id: 2,
    role: 'user' as const,
    author: 'ME',
    text: 'Analyze the recent performance of NVIDIA (NVDA) and suggest a short-term trading strategy.',
  },
  {
    id: 3,
    role: 'bot' as const,
    author: 'FG',
    text: 'Analyzing NVDA... Over the past week NVDA gained 5.2% on strong AI earnings. Momentum is extended (RSI 72), so consider a limit buy near the 5-day moving average with a 5% stop-loss to manage risk.',
  },
] as const

const DATA_SOURCES = [
  { label: 'Bloomberg Terminal', enabled: true },
  { label: 'Reuters Eikon', enabled: true },
  { label: 'SEC EDGAR Filings', enabled: true },
  { label: 'Social Media Sentiment', enabled: false },
] as const

const NOTIFICATION_CHANNELS = [
  { label: 'Trade Executions', enabled: true },
  { label: 'Major Market Alerts', enabled: true },
] as const

const AGENT_MODELS = [
  { label: 'FinGOAT-7B (Default)', value: 'FinGOAT-7B' },
  { label: 'FinGOAT-13B', value: 'FinGOAT-13B' },
  { label: 'FinGOAT-Enterprise', value: 'FinGOAT-Enterprise' },
] as const

const RISK_LABELS = ['Conservative', 'Moderate', 'Aggressive'] as const

const getStoredTheme = (): Theme => {
  if (typeof window === 'undefined') {
    return 'light'
  }
  const stored = localStorage.getItem('fingoat_theme')
  return stored === 'dark' ? 'dark' : 'light'
}

function App() {
  const [theme, setTheme] = useState<Theme>(getStoredTheme)
  const [mode, setMode] = useState<AuthMode>('login')
  const [view, setView] = useState<View>('auth')
  const [form, setForm] = useState(initialForm)
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [articles, setArticles] = useState<Article[]>([])
  const [articlesLoading, setArticlesLoading] = useState(false)
  const [articlesError, setArticlesError] = useState('')
  const [selectedModel, setSelectedModel] = useState<string>(AGENT_MODELS[0].value)
  const [riskTolerance, setRiskTolerance] = useState(1)
  const [dataSources, setDataSources] = useState<Record<string, boolean>>(() =>
    DATA_SOURCES.reduce(
      (acc, source) => ({
        ...acc,
        [source.label]: source.enabled,
      }),
      {} as Record<string, boolean>,
    ),
  )
  const [notificationsState, setNotificationsState] = useState<Record<string, boolean>>(() =>
    NOTIFICATION_CHANNELS.reduce(
      (acc, channel) => ({
        ...acc,
        [channel.label]: channel.enabled,
      }),
      {} as Record<string, boolean>,
    ),
  )
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() => [...AI_MESSAGES])
  const [chatInput, setChatInput] = useState('')
  const chatWindowRef = useRef<HTMLDivElement | null>(null)
  const [expandedArticles, setExpandedArticles] = useState<Record<number, boolean>>({})
  const [articleLikes, setArticleLikes] = useState<Record<number, number>>({})
  const [likingArticle, setLikingArticle] = useState<Record<number, boolean>>({})
  const [isComposing, setIsComposing] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    localStorage.setItem('fingoat_theme', theme)
  }, [theme])

  useEffect(() => {
    if (chatWindowRef.current) {
      chatWindowRef.current.scrollTop = chatWindowRef.current.scrollHeight
    }
  }, [chatMessages])

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))
  }, [])

  useEffect(() => {
    if (localStorage.getItem(TOKEN_STORAGE_KEY)) {
      setView('home')
    }
  }, [])

  const subtitle = useMemo(() => {
    if (mode === 'login') {
      return 'Please enter your credentials to sign in.'
    }
    return 'Create an account to start orchestrating trades.'
  }, [mode])

  const toggleDataSource = (label: string) => {
    setDataSources((prev) => ({
      ...prev,
      [label]: !prev[label],
    }))
  }

  const toggleNotification = (label: string) => {
    setNotificationsState((prev) => ({
      ...prev,
      [label]: !prev[label],
    }))
  }

  const handleModelChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setSelectedModel(event.target.value)
  }

  const handleRiskChange = (event: ChangeEvent<HTMLInputElement>) => {
    setRiskTolerance(Number(event.target.value))
  }

  const handleChatInputChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setChatInput(event.target.value)
  }

  const handleChatInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !isComposing) {
      event.preventDefault()
      handleSendMessage()
    }
    if (event.key === 'Escape') {
      setChatInput('')
    }
  }

  const handleCompositionStart = (event: CompositionEvent<HTMLTextAreaElement>) => {
    setIsComposing(true)
  }

  const handleCompositionEnd = (event: CompositionEvent<HTMLTextAreaElement>) => {
    setIsComposing(false)
  }

  const handleSendMessage = () => {
    const prompt = chatInput.trim()
    if (!prompt) return

    const userMessage: ChatMessage = {
      id: Date.now(),
      role: 'user',
      author: 'ME',
      text: prompt,
    }

    const response: ChatMessage = {
      id: Date.now() + 1,
      role: 'bot',
      author: 'FG',
      text: `Noted. I will explore "${prompt}" with ${selectedModel} and a ${
        RISK_LABELS[riskTolerance] ?? 'Moderate'
      } risk lens. Expect a summary shortly.`,
    }

    setChatMessages((prev) => [...prev, userMessage, response])
    setChatInput('')
  }

  const handleNewSession = () => {
    setChatMessages([])
    setChatInput('')
  }

  const handleAttachmentTrigger = () => {
    fileInputRef.current?.click()
  }

  const handleAttachmentChange = (event: ChangeEvent<HTMLInputElement>) => {
    // Placeholder: attachments not yet supported
    event.target.value = ''
  }

  const toggleArticleBody = (articleId: number) => {
    setExpandedArticles((prev) => ({
      ...prev,
      [articleId]: !prev[articleId],
    }))
  }

  const resetSession = useCallback((message?: string) => {
    localStorage.removeItem(TOKEN_STORAGE_KEY)
    setForm(initialForm)
    setView('auth')
    setMode('login')
    setShowPassword(false)
    setSuccess('')
    setError(message ?? '')
    setArticles([])
    setArticlesError('')
    setArticlesLoading(false)
  }, [])

  const fetchArticleLikes = useCallback(
    async (ids: number[]) => {
      const token = localStorage.getItem(TOKEN_STORAGE_KEY)
      if (!token || ids.length === 0) {
        return
      }
      try {
        const results = await Promise.all(
          ids.map(async (articleId) => {
            const response = await fetch(`${API_BASE_URL}/api/articles/${articleId}/like`, {
              method: 'GET',
              headers: {
                'Content-Type': 'application/json',
                Authorization: token,
              },
            })

            if (response.status === 401) {
              resetSession('Session expired. Please log in again.')
              return [articleId, 0] as const
            }

            if (!response.ok) {
              return [articleId, 0] as const
            }

            const data = await response.json().catch(() => ({}))
            return [articleId, Number(data.likes ?? 0)] as const
          }),
        )

        setArticleLikes((prev) => {
          const next = { ...prev }
          results.forEach(([articleId, value]) => {
            if (!Number.isNaN(value)) {
              next[articleId] = value
            }
          })
          return next
        })
      } catch {
        // ignore network hiccups for like counts
      }
    },
    [resetSession],
  )

  const fetchArticles = useCallback(
    async (signal?: AbortSignal) => {
      const token = localStorage.getItem(TOKEN_STORAGE_KEY)
      if (!token) {
        resetSession()
        return
      }

      setArticlesLoading(true)
      setArticlesError('')
      try {
        const response = await fetch(`${API_BASE_URL}/api/articles`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            Authorization: token,
          },
          signal,
        })

        if (signal?.aborted) return

        if (response.status === 401) {
          resetSession('Session expired. Please log in again.')
          return
        }

        const payload = await response.json().catch(() => null)

        if (!response.ok) {
          const message =
            payload && typeof payload.error === 'string'
              ? payload.error
              : 'Unable to fetch articles right now.'
          setArticlesError(message)
          return
        }

        const normalizeArticle = (item: Record<string, unknown>): Article => ({
          id: Number(item.id ?? item.ID ?? 0),
          title: String(item.title ?? item.Title ?? 'Untitled article'),
          content: String(item.content ?? item.Content ?? ''),
          preview: String(item.preview ?? item.Preview ?? ''),
          createdAt: String(item.createdAt ?? item.CreatedAt ?? ''),
        })

        const rawItems = Array.isArray(payload)
          ? (payload as Record<string, unknown>[])
          : payload
            ? [payload as Record<string, unknown>]
            : []
        const normalized = rawItems.map((item) => normalizeArticle(item))
        setArticles(normalized)
        setExpandedArticles({})
        fetchArticleLikes(normalized.map((article) => article.id))
      } catch (err) {
        if (signal?.aborted) return
        setArticlesError(
          err instanceof Error
            ? err.message
            : 'Unexpected error while loading news.',
        )
      } finally {
        if (!signal?.aborted) {
          setArticlesLoading(false)
        }
      }
    },
    [resetSession, fetchArticleLikes],
  )

  useEffect(() => {
    if (view !== 'home') return
    const controller = new AbortController()
    fetchArticles(controller.signal)
    return () => controller.abort()
  }, [view, fetchArticles])

  const handleLikeArticle = async (articleId: number) => {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY)
    if (!token) {
      resetSession()
      return
    }
    setLikingArticle((prev) => ({ ...prev, [articleId]: true }))
    try {
      const response = await fetch(`${API_BASE_URL}/api/articles/${articleId}/like`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token,
        },
      })

      if (response.status === 401) {
        resetSession('Session expired. Please log in again.')
        return
      }

      if (response.ok) {
        setArticleLikes((prev) => ({
          ...prev,
          [articleId]: (prev[articleId] ?? 0) + 1,
        }))
      }
    } catch (error) {
      setArticlesError((prev) =>
        prev || 'Unable to register your like right now. Please try again later.',
      )
    } finally {
      setLikingArticle((prev) => ({ ...prev, [articleId]: false }))
    }
  }

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const { name, value } = event.target
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (loading) return

    setError('')
    setSuccess('')

    if (!form.username.trim() || !form.password) {
      setError('Please fill in both username and password.')
      return
    }

    if (mode === 'register') {
      if (form.password.length < 8) {
        setError('Password must be at least 8 characters long.')
        return
      }
      if (form.password !== form.confirmPassword) {
        setError('Passwords do not match.')
        return
      }
    }

    const payload = {
      username: form.username.trim(),
      password: form.password,
    }
    const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register'

    try {
      setLoading(true)
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        const message =
          typeof data?.error === 'string'
            ? data.error
            : 'Unable to process your request. Please try again.'
        setError(message)
        return
      }

      if (typeof data?.token === 'string') {
        localStorage.setItem(TOKEN_STORAGE_KEY, data.token)
        setSuccess(mode === 'login' ? 'Welcome back!' : 'Account created.')
        setTimeout(() => setView('home'), 400)
      } else {
        setError('The server response did not include a token.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error occurred.')
    } finally {
      setLoading(false)
    }
  }

  const handleModeChange = (nextMode: AuthMode) => {
    setMode(nextMode)
    setError('')
    setSuccess('')
    setForm(initialForm)
  }

  const handleLogout = () => {
    resetSession()
  }

  const togglePasswordVisibility = () => {
    setShowPassword((prev) => !prev)
  }

  const riskTone = RISK_LABELS[riskTolerance] ?? 'Moderate'

  const formatTimestamp = (value?: string) => {
    if (!value) return 'Moments ago'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return 'Moments ago'
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const dashboardView = (
    <div className="dashboard">
      <header className="top-nav">
        <div className="brand">
          <div className="brand-mark">FG</div>
          <div className="brand-copy">
            <strong>FinGOAT</strong>
            <span>Financial Graph-Orchestrated Agent Trading</span>
          </div>
        </div>
        <nav className="nav-links">
          {NAV_LINKS.map(({ label }) => (
            <button
              key={label}
              type="button"
              className={`nav-link ${label === 'Dashboard' ? 'active' : ''}`}
              disabled={label !== 'Dashboard'}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="nav-actions">
          <ThemeToggleButton />
          <button type="button" className="logout-btn" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </header>

      <div className="todo-strip">
        Navigation targets are placeholders—full page switching remains a TODO.
      </div>

      <main className="dashboard-grid">
        <section className="panel config-panel">
          <div className="panel-heading">
            <PanelIcon type="config" />
            <div>
              <p className="panel-label">Configuration</p>
              <h2>Agent Settings</h2>
            </div>
            <button type="button" className="panel-action" disabled>
              TODO
            </button>
          </div>

          <div className="panel-body scrollable">
            <div className="config-group">
              <label className="config-label" htmlFor="ai-model">
                AI Model
              </label>
              <select id="ai-model" value={selectedModel} onChange={handleModelChange}>
                {AGENT_MODELS.map((model) => (
                  <option key={model.value} value={model.value}>
                    {model.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="config-group">
              <div className="config-label-row">
                <span>Risk Tolerance</span>
                <span className="config-value">{riskTone}</span>
              </div>
              <input
                type="range"
                min="0"
                max="2"
                step="1"
                value={riskTolerance}
                onChange={handleRiskChange}
              />
              <div className="range-labels">
                <span>Conservative</span>
                <span>Moderate</span>
                <span>Aggressive</span>
              </div>
            </div>

            <div className="config-group">
              <p className="config-label">Data Sources</p>
              <ul className="config-list">
                {DATA_SOURCES.map((source) => (
                  <li key={source.label} className="config-check">
                    <button
                      type="button"
                      className={`config-row ${dataSources[source.label] ? 'active' : ''}`}
                      onClick={() => toggleDataSource(source.label)}
                      aria-pressed={dataSources[source.label]}
                    >
                      <span>{source.label}</span>
                      <span
                        className={`check-pill ${dataSources[source.label] ? 'active' : ''}`}
                        aria-hidden="true"
                      />
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="config-group">
              <p className="config-label">Notifications</p>
              <ul className="config-list">
                {NOTIFICATION_CHANNELS.map((channel) => (
                  <li key={channel.label} className="config-check">
                    <button
                      type="button"
                      className={`config-row ${
                        notificationsState[channel.label] ? 'active' : ''
                      }`}
                      onClick={() => toggleNotification(channel.label)}
                      aria-pressed={notificationsState[channel.label]}
                    >
                      <span>{channel.label}</span>
                      <span
                        className={`check-pill ${
                          notificationsState[channel.label] ? 'active' : ''
                        }`}
                        aria-hidden="true"
                      />
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="config-note">
              Operating in <strong>{riskTone}</strong> mode with <strong>{selectedModel}</strong>.
            </div>

            <div className="config-actions">
              <button type="button" className="action-btn outline">
                Save Draft
              </button>
              <button type="button" className="action-btn primary">
                Deploy Strategy
              </button>
            </div>
          </div>
        </section>

        <section className="panel ai-panel">
          <div className="panel-heading">
            <PanelIcon type="chat" />
            <div>
              <p className="panel-label">AI Assistant</p>
              <h2>Conversation</h2>
            </div>
            <button type="button" className="panel-action" onClick={handleNewSession}>
              New Session
            </button>
          </div>

          <div className="panel-body">
            <div className="chat-window" ref={chatWindowRef}>
              {chatMessages.map((message) => (
                <div
                  key={message.id}
                  className={`chat-bubble ${message.role === 'user' ? 'user' : 'bot'}`}
                >
                  <div className="chat-avatar">{message.author}</div>
                  <p>{message.text}</p>
                </div>
              ))}
              {!chatMessages.length && (
                <div className="chat-status">Start a conversation to see messages here.</div>
              )}
            </div>

            <div className="chat-input">
              <div className="chat-input-wrapper">
                <div className="chat-input-toolbar">
                  <button
                    type="button"
                    className="attach-btn"
                    onClick={handleAttachmentTrigger}
                    aria-label="Add attachment"
                  >
                    <svg viewBox="0 0 24 24" role="presentation">
                      <circle cx="12" cy="12" r="8" />
                      <path d="M12 8v8M8 12h8" strokeLinecap="round" />
                    </svg>
                    <span className="tooltip">Add attachment</span>
                  </button>
                  <span className="chat-input-tip">Shift + Enter for new line</span>
                </div>
                <textarea
                  placeholder="Message FinGOAT..."
                  value={chatInput}
                  rows={1}
                  onChange={handleChatInputChange}
                  onKeyDown={handleChatInputKeyDown}
                  onCompositionStart={handleCompositionStart}
                  onCompositionEnd={handleCompositionEnd}
                />
                <div className="chat-input-hints">
                  <span>Esc clears draft</span>
                </div>
              </div>
              <input
                type="file"
                ref={fileInputRef}
                className="chat-file-input"
                onChange={handleAttachmentChange}
              />
              <button
                type="button"
                className="send-btn"
                onClick={handleSendMessage}
                disabled={!chatInput.trim()}
              >
                <svg
                  viewBox="0 0 24 24"
                  role="presentation"
                  stroke="currentColor"
                  strokeWidth="2"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 12h14" />
                  <path d="m13 6 7 6-7 6" />
                </svg>
              </button>
            </div>
          </div>
        </section>

        <section className="panel news-panel">
          <div className="panel-heading">
            <PanelIcon type="news" />
            <div>
              <p className="panel-label">Market News</p>
              <h2>Live Articles</h2>
            </div>
            <button
              type="button"
              className="panel-action"
              onClick={() => fetchArticles()}
              disabled={articlesLoading}
            >
              {articlesLoading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          <div className="panel-body">
            <div className="news-list">
              {articlesLoading && <p className="news-placeholder">Loading articles…</p>}
              {!articlesLoading && articlesError && (
                <p className="news-error">{articlesError}</p>
              )}
              {!articlesLoading && !articlesError && articles.length === 0 && (
                <p className="news-placeholder">
                  No articles yet. Use the backend endpoints to seed insights.
                </p>
              )}
              {!articlesLoading &&
                !articlesError &&
                articles.map((article) => {
                  const expanded = !!expandedArticles[article.id]
                  const likes = articleLikes[article.id] ?? 0
                  const isLiking = !!likingArticle[article.id]
                  return (
                    <article key={article.id} className="news-card">
                      <div className="news-head">
                        <div>
                          <p className="news-meta">{formatTimestamp(article.createdAt)}</p>
                          <h3>{article.title}</h3>
                        </div>
                        <button
                          type="button"
                          className="news-toggle"
                          onClick={() => toggleArticleBody(article.id)}
                        >
                          {expanded ? 'Hide' : 'Read more'}
                        </button>
                      </div>
                      <p className="news-preview">{article.preview}</p>
                      {expanded && <p className="news-content">{article.content}</p>}
                      <div className="news-actions">
                        <button
                          type="button"
                          className="like-btn"
                          onClick={() => handleLikeArticle(article.id)}
                          disabled={isLiking}
                        >
                          <span aria-hidden="true">♥</span>
                          <span>{isLiking ? 'Sending…' : `${likes} Likes`}</span>
                        </button>
                        <span className="news-id">#{article.id}</span>
                      </div>
                    </article>
                  )
                })}
            </div>
          </div>
        </section>
      </main>
    </div>
  )

  const authView = (
    <div className="auth-page">
      <div className="glow glow-left" />
      <div className="glow glow-right" />
      <section className="auth-panel">
        <div className="auth-tabs">
          {(['login', 'register'] as AuthMode[]).map((tab) => (
            <button
              key={tab}
              type="button"
              className={`auth-tab ${mode === tab ? 'active' : ''}`}
              onClick={() => handleModeChange(tab)}
              disabled={mode === tab}
            >
              {tab === 'login' ? 'Login' : 'Register'}
            </button>
          ))}
        </div>

        <header className="auth-header">
          <h1>{mode === 'login' ? 'Welcome Back' : 'Create Account'}</h1>
          <p>{subtitle}</p>
        </header>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="field-label" htmlFor="username">
            Username
          </label>
          <input
            id="username"
            name="username"
            type="text"
            placeholder="Enter your username"
            value={form.username}
            onChange={handleInputChange}
            autoComplete="username"
          />

          <label className="field-label" htmlFor="password">
            Password
          </label>
          <div className="password-field">
            <input
              id="password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              placeholder="Enter your password"
              value={form.password}
              onChange={handleInputChange}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
            <button
              type="button"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="ghost-btn"
              onClick={togglePasswordVisibility}
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>

          {mode === 'register' && (
            <>
              <label className="field-label" htmlFor="confirmPassword">
                Confirm password
              </label>
              <input
                id="confirmPassword"
                name="confirmPassword"
                type={showPassword ? 'text' : 'password'}
                placeholder="Re-enter your password"
                value={form.confirmPassword}
                onChange={handleInputChange}
                autoComplete="new-password"
              />
            </>
          )}

          {error && <div className="banner banner-error">{error}</div>}
          {success && <div className="banner banner-success">{success}</div>}

          <button type="submit" className="primary-btn" disabled={loading}>
            {loading ? 'Please wait…' : mode === 'login' ? 'Login' : 'Register'}
          </button>
        </form>

        <footer className="auth-footer">
          {mode === 'login' ? (
            <>
              Don&apos;t have an account?{' '}
              <button
                type="button"
                className="link-btn"
                onClick={() => handleModeChange('register')}
              >
                Register
              </button>
            </>
          ) : (
            <>
              Already onboard?{' '}
              <button
                type="button"
                className="link-btn"
                onClick={() => handleModeChange('login')}
              >
                Login
              </button>
            </>
          )}
        </footer>
      </section>
    </div>
  )

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      <div className={`app theme-${theme}`}>{view === 'home' ? dashboardView : authView}</div>
    </ThemeContext.Provider>
  )
}

export default App
