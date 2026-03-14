import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import './App.css'
import { TradingAnalysis } from './components/TradingAnalysis'
import { ChartPage } from './components/ChartPage'
import { OpenClawPage } from './components/OpenClawPage'
import { FeedPage } from './components/FeedPage'

type AuthMode = 'login' | 'register'
type View = 'auth' | 'home'
type Theme = 'light' | 'dark'
type CollapsiblePanel = 'config'
type DragPanel = 'config' | null
type ActiveTab = 'dashboard' | 'feed' | 'chart' | 'openclaw'



type ThemeContextValue = {
  theme: Theme
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light',
  toggleTheme: () => { },
})

const ThemeToggleButton = () => {
  const { theme, toggleTheme } = useContext(ThemeContext)
  return (
    <button type="button" className="theme-toggle" onClick={toggleTheme} aria-label="Toggle theme">
      {theme === 'light' ? (
        <svg viewBox="0 0 24 24" role="presentation" width="20" height="20" aria-hidden="true">
          <path
            d="M15.2 2.7A8.8 8.8 0 1 0 21 15.8a7.3 7.3 0 0 1-5.8-13.1Z"
            fill="currentColor"
            opacity="0.95"
          />
          <circle cx="17.4" cy="6.1" r="1.1" fill="currentColor" opacity="0.55" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" role="presentation" width="20" height="20" aria-hidden="true">
          <circle cx="12" cy="12" r="4.25" fill="currentColor" />
          <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M12 1.9v2.4" />
            <path d="M12 19.7v2.4" />
            <path d="M1.9 12h2.4" />
            <path d="M19.7 12h2.4" />
            <path d="M4.4 4.4l1.7 1.7" />
            <path d="M17.9 17.9l1.7 1.7" />
            <path d="M4.4 19.6l1.7-1.7" />
            <path d="M17.9 6.1l1.7-1.7" />
          </g>
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
const rawApiUrl = import.meta.env.VITE_API_URL
const API_BASE_URL = rawApiUrl ? rawApiUrl.replace(/\/$/, '') : ''


const initialForm = {
  username: '',
  password: '',
  confirmPassword: '',
}



const RISK_LABELS = ['Conservative', 'Moderate', 'Aggressive'] as const
const SIDE_PANEL_MIN_WIDTH = 240
const SIDE_PANEL_MAX_WIDTH = 460
const SIDE_PANEL_COLLAPSED_WIDTH = 84
const DESKTOP_BREAKPOINT = 900

const getStoredTheme = (): Theme => {
  if (typeof window === 'undefined') {
    return 'light'
  }
  const stored = localStorage.getItem('fingoat_theme')
  return stored === 'dark' ? 'dark' : 'light'
}

function App() {
  const dashboardGridRef = useRef<HTMLElement | null>(null)
  const [theme, setTheme] = useState<Theme>(getStoredTheme)
  const [mode, setMode] = useState<AuthMode>('login')
  const [view, setView] = useState<View>('auth')
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard')
  const [form, setForm] = useState(initialForm)
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [llmProvider, setLlmProvider] = useState('ollama')
  const [llmModel, setLlmModel] = useState('gemma3:1b')
  const [llmBaseUrl, setLlmBaseUrl] = useState('http://localhost:11434')
  const [executionMode, setExecutionMode] = useState<'default' | 'openclaw'>('default')
  const [riskTolerance, setRiskTolerance] = useState(1)
  const [collapsedPanels, setCollapsedPanels] = useState<Record<CollapsiblePanel, boolean>>({
    config: false,
  })
  const [panelWidths, setPanelWidths] = useState<Record<CollapsiblePanel, number>>({
    config: 320,
  })
  const [draggingPanel, setDraggingPanel] = useState<DragPanel>(null)
  const [isDesktopLayout, setIsDesktopLayout] = useState(() =>
    typeof window === 'undefined' ? true : window.innerWidth > DESKTOP_BREAKPOINT,
  )

  useEffect(() => {
    localStorage.setItem('fingoat_theme', theme)
  }, [theme])



  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))
  }, [])

  useEffect(() => {
    if (localStorage.getItem(TOKEN_STORAGE_KEY)) {
      setView('home')
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    const handleResize = () => {
      setIsDesktopLayout(window.innerWidth > DESKTOP_BREAKPOINT)
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const subtitle = useMemo(() => {
    if (mode === 'login') {
      return 'Please enter your credentials to sign in.'
    }
    return 'Create an account to start orchestrating trades.'
  }, [mode])



  const handleRiskChange = (event: ChangeEvent<HTMLInputElement>) => {
    setRiskTolerance(Number(event.target.value))
  }

  const loadPreviousAnalyses = () => {
    // Placeholder - handled by TradingAnalysis component
  }



  const resetSession = useCallback((message?: string) => {
    localStorage.removeItem(TOKEN_STORAGE_KEY)
    setForm(initialForm)
    setView('auth')
    setMode('login')
    setShowPassword(false)
    setSuccess('')
    setError(message ?? '')

  }, [])



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

  const MODEL_PRESETS: Record<string, string[]> = {
    openai: ['gpt-4o-mini', 'gpt-4o'],
    anthropic: ['claude-3-haiku-20240307', 'claude-3-5-sonnet-latest'],
    google: ['gemini-1.5-flash', 'gemini-1.5-pro'],
    deepseek: ['deepseek-chat'],
    aliyun: [
      'qwen3.5-flash',
      'deepseek-v3.2',
      'glm-4.6',
      'Moonshot-Kimi-K2-Instruct',
      'qwen3-vl-32b-thinking',
    ],
    'openai-compatible': ['gpt-4o-mini'],
    vllm: ['gpt-4o-mini'],
    ollama: [
      'gemma3:1b',
      'llama3.2',
      'llama3.1',
      'llama3.1:405b',
      'llama3.2:1b',
      'llama3.2-vision',
      'llama3.2-vision:90b',
      'llama3.3',
      'llama4:scout',
      'llama4:maverick',
      'gemma3',
      'gemma3:12b',
      'gemma3:27b',
      'qwq',
      'deepseek-r1',
      'deepseek-r1:671b',
      'phi4',
      'phi4-mini',
      'mistral',
      'moondream',
      'neural-chat',
      'starling-lm',
      'codellama',
      'llama2-uncensored',
      'llava',
      'granite3.3',
      'qwen2.5',
    ],
  }

  const BASE_DEFAULTS: Record<string, string> = {
    openai: 'https://api.openai.com/v1',
    deepseek: 'https://api.deepseek.com/v1',
    aliyun: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    'openai-compatible': 'http://localhost:8009/v1',
    vllm: 'http://localhost:8009/v1',
    ollama: 'http://localhost:11434',
  }

  const handleLlmProviderChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value
    setLlmProvider(value)
    const presets = MODEL_PRESETS[value] || []
    if (presets.length > 0) {
      setLlmModel(presets[0])
    }
    if (BASE_DEFAULTS[value]) {
      setLlmBaseUrl(BASE_DEFAULTS[value])
    } else {
      setLlmBaseUrl('')
    }
  }

  const handleLlmModelChange = (e: ChangeEvent<HTMLInputElement>) => {
    setLlmModel(e.target.value)
  }

  const handleLlmBaseUrlChange = (e: ChangeEvent<HTMLInputElement>) => {
    setLlmBaseUrl(e.target.value)
  }

  const togglePanelCollapse = (panel: CollapsiblePanel) => {
    setCollapsedPanels((prev) => ({
      ...prev,
      [panel]: !prev[panel],
    }))
  }

  const isDraggingRef = useRef(false)
  const dragStartXRef = useRef(0)

  const handleSplitterMouseDown = (e: React.MouseEvent, panel: CollapsiblePanel) => {
    if (!isDesktopLayout) return
    isDraggingRef.current = false
    dragStartXRef.current = e.clientX
    setCollapsedPanels((prev) => ({
      ...prev,
      [panel]: false,
    }))
    setDraggingPanel(panel)
  }

  useEffect(() => {
    if (!draggingPanel || !dashboardGridRef.current || !isDesktopLayout) return undefined

    const handleMouseMove = (event: MouseEvent) => {
      if (Math.abs(event.clientX - dragStartXRef.current) > 4) {
        isDraggingRef.current = true
      }
      const bounds = dashboardGridRef.current?.getBoundingClientRect()
      if (!bounds) return

      if (draggingPanel === 'config') {
        const measuredWidth = event.clientX - bounds.left
        if (measuredWidth < 180) {
          setCollapsedPanels((prev) => ({ ...prev, config: true }))
        } else {
          setCollapsedPanels((prev) => ({ ...prev, config: false }))
          const nextWidth = Math.min(
            SIDE_PANEL_MAX_WIDTH,
            Math.max(SIDE_PANEL_MIN_WIDTH, measuredWidth),
          )
          setPanelWidths((prev) => ({ ...prev, config: nextWidth }))
        }
      }
    }

    const handleMouseUp = () => {
      setDraggingPanel(null)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [draggingPanel, isDesktopLayout])



  const isConfigCollapsed = isDesktopLayout && collapsedPanels.config

  const dashboardView = (
    <div className="dashboard">
      <header className="top-nav">
        <div className="brand">
          <div className="brand-mark" aria-label="FinGOAT logo">🐐</div>
          <div className="brand-copy">
            <strong>FinGOAT</strong>
            <span className="brand-subtitle">Financial Graph-Orchestrated Agent Trading</span>
          </div>
        </div>
        <nav className="nav-tabs">
          <button
            type="button"
            className={`nav-tab ${activeTab === 'dashboard' ? 'nav-tab--active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            Dashboard
          </button>
          <button
            type="button"
            className={`nav-tab ${activeTab === 'feed' ? 'nav-tab--active' : ''}`}
            onClick={() => setActiveTab('feed')}
          >
            Feed
          </button>
          <button
            type="button"
            className={`nav-tab ${activeTab === 'chart' ? 'nav-tab--active' : ''}`}
            onClick={() => setActiveTab('chart')}
          >
            Chart
          </button>
          <button
            type="button"
            className={`nav-tab ${activeTab === 'openclaw' ? 'nav-tab--active' : ''}`}
            onClick={() => setActiveTab('openclaw')}
          >
            OpenClaw
          </button>
        </nav>
        <div className="nav-actions">
          <ThemeToggleButton />
          <a
            href="https://github.com/JerryLinyx/FinGOAT"
            target="_blank"
            rel="noopener noreferrer"
            className="github-link"
            aria-label="View source on GitHub"
            title="View source on GitHub"
          >
            <svg viewBox="0 0 24 24" role="presentation" width="18" height="18" aria-hidden="true" fill="currentColor">
              <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
            </svg>
          </a>
          <button type="button" className="logout-btn" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </header>

      {activeTab === 'feed' ? (
        <FeedPage onSessionExpired={resetSession} />
      ) : activeTab === 'chart' ? (
        <ChartPage onSessionExpired={resetSession} />
      ) : activeTab === 'openclaw' ? (
        <OpenClawPage />
      ) : (
      <main
        ref={dashboardGridRef}
        className={`dashboard-grid ${isDesktopLayout ? 'dashboard-grid--resizable' : ''}`}
        style={
          isDesktopLayout
            ? {
              gridTemplateColumns: `${isConfigCollapsed ? SIDE_PANEL_COLLAPSED_WIDTH : panelWidths.config}px 14px minmax(0, 1fr)`,
            }
            : undefined
        }
      >
        <section className={`panel config-panel panel--side ${isConfigCollapsed ? 'panel--side-collapsed' : ''}`}>
          <div className="panel-heading">
            <PanelIcon type="config" />
            <div className={`panel-heading-copy ${isConfigCollapsed ? 'panel-heading-copy--hidden' : ''}`}>
              <p className="panel-label">Configuration</p>
              <h2>Agent Settings</h2>
            </div>
          </div>

          {!isConfigCollapsed && (
          <div className="panel-body scrollable">
            <div className="config-group">
              <label className="config-label" htmlFor="ai-model">
                LLM Provider
              </label>
              <select id="ai-model" value={llmProvider} onChange={handleLlmProviderChange}>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="google">Gemini</option>
                <option value="deepseek">DeepSeek (OpenAI compatible)</option>
                <option value="aliyun">Aliyun DashScope</option>
                <option value="openai-compatible">OpenAI-compatible (custom)</option>
                <option value="vllm">vLLM (local)</option>
                <option value="ollama">Ollama (local)</option>
              </select>
            </div>

            <div className="config-group">
              <label className="config-label" htmlFor="llm-model">
                LLM Model
              </label>
              <div className="model-row">
                <select
                  id="llm-model-presets"
                  value={MODEL_PRESETS[llmProvider]?.includes(llmModel) ? llmModel : 'custom'}
                  onChange={(e) => {
                    const val = e.target.value
                    if (val === 'custom') return
                    setLlmModel(val)
                  }}
                >
                  {(MODEL_PRESETS[llmProvider] || []).map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                  <option value="custom">Custom…</option>
                </select>
                <input
                  id="llm-model"
                  type="text"
                  value={llmModel}
                  onChange={handleLlmModelChange}
                  placeholder="e.g., gpt-4o-mini / qwen3.5-flash / deepseek-v3.2 / glm-4.6 / Moonshot-Kimi-K2-Instruct / qwen3-vl-32b-thinking"
                />
              </div>
            </div>

            {(llmProvider === 'deepseek' ||
              llmProvider === 'aliyun' ||
              llmProvider === 'openai-compatible' ||
              llmProvider === 'vllm' ||
              llmProvider === 'ollama') && (
                <div className="config-group">
                  <label className="config-label" htmlFor="llm-baseurl">
                    Base URL
                  </label>
                  <input
                    id="llm-baseurl"
                    type="text"
                    value={llmBaseUrl}
                    onChange={handleLlmBaseUrlChange}
                    placeholder="https://api.deepseek.com"
                  />
                </div>
              )}

            <div className="config-group">
              <label className="config-label" htmlFor="execution-mode">
                Execution Mode
              </label>
              <select
                id="execution-mode"
                value={executionMode}
                onChange={(e) => setExecutionMode(e.target.value as 'default' | 'openclaw')}
              >
                <option value="default">Default</option>
                <option value="openclaw">OpenClaw</option>
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



            <div className="config-note">
              Executing in <strong>{executionMode}</strong> mode with <strong>{riskTone}</strong> risk, using <strong>{llmProvider}</strong> / <strong>{llmModel}</strong>.
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
          )}
        </section>

        <div className={`panel-splitter panel-splitter--left ${draggingPanel === 'config' ? 'panel-splitter--active' : ''}`}>
          <button
            type="button"
            className="panel-splitter__toggle"
            onClick={(e) => {
              if (isDraggingRef.current) {
                e.preventDefault()
                return
              }
              togglePanelCollapse('config')
            }}
            onMouseDown={(e) => handleSplitterMouseDown(e, 'config')}
            aria-label={isConfigCollapsed ? 'Expand configuration sidebar' : 'Collapse configuration sidebar'}
            title={isConfigCollapsed ? 'Expand configuration sidebar' : 'Collapse configuration sidebar'}
          >
            {isConfigCollapsed ? '▸' : '◂'}
          </button>
        </div>

        <section className="panel ai-panel">
          <div className="panel-heading">
            <PanelIcon type="chat" />
            <div>
              <p className="panel-label">Trading Analysis</p>
              <h2>Stock Analysis</h2>
            </div>
            <button
              type="button"
              className="panel-action panel-action--icon"
              onClick={loadPreviousAnalyses}
              aria-label="Refresh analyses"
              title="Refresh analyses"
            >
              ↺
            </button>
          </div>

          <div className="panel-body scrollable">
            <TradingAnalysis
              onSessionExpired={resetSession}
              llmProvider={llmProvider}
              llmModel={llmModel}
              llmBaseUrl={llmBaseUrl}
              executionMode={executionMode}
            />
          </div>
        </section>


      </main>
      )}
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
