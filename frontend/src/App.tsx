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
import { ProfilePage } from './components/ProfilePage'
import { getProfile } from './services/userService'
import { tradingService, type OllamaModel } from './services/tradingService'
import type { UserProfile } from './types/user'

type AuthMode = 'login' | 'register'
type View = 'auth' | 'home'
type Theme = 'light' | 'dark'
type CollapsiblePanel = 'config'
type DragPanel = 'config' | null
type ActiveTab = 'dashboard' | 'feed' | 'chart' | 'openclaw'
type ExecutionMode = 'api' | 'ollama' | 'openclaw'
type OpenClawStatus = 'disconnected' | 'connecting' | 'connected'
type RoleBindings = Record<'market' | 'social' | 'news' | 'fundamentals', string>

const REQUIRED_ROLES = [
  { id: 'market' as const, label: 'Market Analyst' },
  { id: 'social' as const, label: 'Social Analyst' },
  { id: 'news' as const, label: 'News Analyst' },
  { id: 'fundamentals' as const, label: 'Fundamentals Analyst' },
] as const

const OPENCLAW_BINDINGS_KEY = 'fingoat_openclaw_bindings'
const ANALYSIS_DRAFT_KEY = 'fingoat_analysis_draft'

function readOpenClawBindings(): RoleBindings {
  if (typeof window === 'undefined') return { market: '', social: '', news: '', fundamentals: '' }
  try {
    const raw = localStorage.getItem(OPENCLAW_BINDINGS_KEY)
    if (raw) return JSON.parse(raw) as RoleBindings
  } catch { /* ignore */ }
  return { market: '', social: '', news: '', fundamentals: '' }
}



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
  identifier: '',   // login: email or username
  email: '',        // register: email (required)
  displayName: '',  // register: display name (optional)
  password: '',
  confirmPassword: '',
}

type AnalysisDraft = {
  executionMode: ExecutionMode
  llmProvider: string
  llmModel: string
  llmBaseUrl: string
  riskTolerance: number
}

const normalizeProviderName = (provider: string | undefined | null): string => {
  if (!provider) return 'openai'
  return provider === 'aliyun' ? 'dashscope' : provider
}

const RISK_LABELS = ['Conservative', 'Moderate', 'Aggressive'] as const
const SIDE_PANEL_MIN_WIDTH = 280
const SIDE_PANEL_MAX_WIDTH = 360
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
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('ollama')
  const [openclawStatus, setOpenclawStatus] = useState<OpenClawStatus>('disconnected')
  const [openclawBindings, setOpenclawBindings] = useState<RoleBindings>(readOpenClawBindings)
  const [riskTolerance, setRiskTolerance] = useState(1)
  const [draftMessage, setDraftMessage] = useState('')
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([])
  const [ollamaModelsLoading, setOllamaModelsLoading] = useState(false)
  const [ollamaModelsError, setOllamaModelsError] = useState('')
  const ollamaLoadedHostRef = useRef<string | null>(null)
  const [collapsedPanels, setCollapsedPanels] = useState<Record<CollapsiblePanel, boolean>>({
    config: false,
  })
  const [panelWidths, setPanelWidths] = useState<Record<CollapsiblePanel, number>>({
    config: 300,
  })
  const [draggingPanel, setDraggingPanel] = useState<DragPanel>(null)
  const [isDesktopLayout, setIsDesktopLayout] = useState(() =>
    typeof window === 'undefined' ? true : window.innerWidth > DESKTOP_BREAKPOINT,
  )

  // User identity & profile overlay
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null)
  const [showProfile, setShowProfile] = useState(false)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const userMenuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    localStorage.setItem('fingoat_theme', theme)
  }, [theme])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = localStorage.getItem(ANALYSIS_DRAFT_KEY)
      if (!raw) return
      const draft = JSON.parse(raw) as Partial<AnalysisDraft>
      if (draft.executionMode) setExecutionMode(draft.executionMode)
      if (draft.llmProvider) setLlmProvider(normalizeProviderName(draft.llmProvider))
      if (draft.llmModel) setLlmModel(draft.llmModel)
      if (typeof draft.llmBaseUrl === 'string') setLlmBaseUrl(draft.llmBaseUrl)
      if (typeof draft.riskTolerance === 'number') setRiskTolerance(draft.riskTolerance)
    } catch {
      // ignore malformed drafts
    }
  }, [])



  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))
  }, [])

  useEffect(() => {
    if (localStorage.getItem(TOKEN_STORAGE_KEY)) {
      setView('home')
      // Restore user profile state on page reload
      getProfile()
        .then(setCurrentUser)
        .catch(() => { /* non-fatal */ })
    }
  }, [])

  // Close user dropdown when clicking outside it
  useEffect(() => {
    if (!showUserMenu) return undefined
    const handler = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showUserMenu])

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
    setCurrentUser(null)
    setShowProfile(false)
    setShowUserMenu(false)
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

    if (mode === 'login') {
      if (!form.identifier.trim() || !form.password) {
        setError('Please fill in your email/username and password.')
        return
      }
    } else {
      if (!form.email.trim() || !form.password) {
        setError('Please fill in your email and password.')
        return
      }
      if (!form.email.includes('@')) {
        setError('Please enter a valid email address.')
        return
      }
      if (form.password.length < 8) {
        setError('Password must be at least 8 characters long.')
        return
      }
      if (form.password !== form.confirmPassword) {
        setError('Passwords do not match.')
        return
      }
    }

    const payload =
      mode === 'login'
        ? { identifier: form.identifier.trim(), password: form.password }
        : { email: form.email.trim(), display_name: form.displayName.trim(), password: form.password }

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
        // Fetch profile to populate user state
        try {
          const profile = await getProfile()
          setCurrentUser(profile)
        } catch {
          // Non-fatal: user will see username from token
        }
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
    dashscope: [
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
    dashscope: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    'openai-compatible': 'http://localhost:8009/v1',
    vllm: 'http://localhost:8009/v1',
    ollama: 'http://localhost:11434',
  }

  const handleLlmProviderChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const value = normalizeProviderName(e.target.value)
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

  const handleExecutionModeChange = (mode: ExecutionMode) => {
    setExecutionMode(mode)
    if (mode === 'ollama') {
      setLlmProvider('ollama')
      setLlmModel((prev) => (MODEL_PRESETS.ollama.includes(prev) ? prev : 'gemma3:1b'))
      setLlmBaseUrl('http://localhost:11434')
    } else if (mode === 'api' && llmProvider === 'ollama') {
      setLlmProvider('openai')
      setLlmModel('gpt-4o-mini')
      setLlmBaseUrl('https://api.openai.com/v1')
    }
    // openclaw: no LLM config changes needed
  }

  const saveAnalysisDraft = useCallback(() => {
    const draft: AnalysisDraft = {
      executionMode,
      llmProvider,
      llmModel,
      llmBaseUrl,
      riskTolerance,
    }
    localStorage.setItem(ANALYSIS_DRAFT_KEY, JSON.stringify(draft))
    setDraftMessage(`Saved ${new Date().toLocaleTimeString()}`)
    window.setTimeout(() => setDraftMessage(''), 2200)
  }, [executionMode, llmBaseUrl, llmModel, llmProvider, riskTolerance])

  const detectOllamaModels = useCallback(async (force = false) => {
    const targetHost = llmBaseUrl.trim() || 'http://localhost:11434'
    if (!force && ollamaLoadedHostRef.current === targetHost && ollamaModels.length > 0) {
      return
    }
    try {
      setOllamaModelsLoading(true)
      setOllamaModelsError('')
      const result = await tradingService.getOllamaModels(targetHost)
      setOllamaModels(result.models)
      ollamaLoadedHostRef.current = result.base_url
    } catch (err) {
      setOllamaModels([])
      setOllamaModelsError(err instanceof Error ? err.message : 'Failed to detect Ollama models')
    } finally {
      setOllamaModelsLoading(false)
    }
  }, [llmBaseUrl, ollamaModels.length])

  useEffect(() => {
    if (executionMode !== 'ollama') return
    void detectOllamaModels()
  }, [detectOllamaModels, executionMode])

  const ollamaModelOptions = useMemo(() => {
    const merged = new Set<string>()
    MODEL_PRESETS.ollama.forEach((model) => merged.add(model))
    ollamaModels.forEach((model) => merged.add(model.name))
    return Array.from(merged)
  }, [ollamaModels])

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
      {/* Profile overlay — rendered on top of everything when open */}
      {showProfile && (
        <ProfilePage
          initialProfile={currentUser}
          onClose={() => setShowProfile(false)}
          onProfileUpdate={(p) => setCurrentUser(p)}
        />
      )}
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

          {/* User menu */}
          <div className="user-menu-wrapper" ref={userMenuRef}>
            <button
              type="button"
              className="user-menu-btn"
              onClick={() => setShowUserMenu((v) => !v)}
              aria-expanded={showUserMenu}
              aria-haspopup="menu"
            >
              {currentUser?.display_name || currentUser?.username || 'Account'}
              <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true" style={{ marginLeft: '0.35rem' }}>
                <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              </svg>
            </button>
            {showUserMenu && (
              <div className="user-dropdown" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  className="user-dropdown__item"
                  onClick={() => { setShowUserMenu(false); setShowProfile(true) }}
                >
                  Profile
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="user-dropdown__item user-dropdown__item--danger"
                  onClick={handleLogout}
                >
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {activeTab === 'feed' ? (
        <FeedPage onSessionExpired={resetSession} />
      ) : activeTab === 'chart' ? (
        <ChartPage onSessionExpired={resetSession} />
      ) : activeTab === 'openclaw' ? (
        <OpenClawPage
          onStatusChange={setOpenclawStatus}
          onBindingsChange={(b) => setOpenclawBindings(b as RoleBindings)}
        />
      ) : (
      <main
        ref={dashboardGridRef}
        className={`dashboard-grid ${isDesktopLayout ? 'dashboard-grid--resizable' : ''}`}
        style={
          isDesktopLayout
            ? {
              gridTemplateColumns: `${isConfigCollapsed ? SIDE_PANEL_COLLAPSED_WIDTH : panelWidths.config}px 6px minmax(0, 1fr)`,
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

            {/* ── Execution Mode segment control ── */}
            <div className="config-group">
              <label className="config-label">Execution Mode</label>
              <div className="exec-mode-seg">
                {(['api', 'ollama', 'openclaw'] as ExecutionMode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={`exec-mode-seg__btn ${executionMode === m ? 'exec-mode-seg__btn--active' : ''}`}
                    onClick={() => handleExecutionModeChange(m)}
                  >
                    {m === 'api' ? 'API' : m === 'ollama' ? 'Ollama' : 'OpenClaw'}
                  </button>
                ))}
              </div>
            </div>

            {/* ── API mode: cloud provider config ── */}
            {executionMode === 'api' && (
              <>
                <div className="config-group">
                  <label className="config-label" htmlFor="ai-model">
                    LLM Provider
                  </label>
                  <select id="ai-model" value={llmProvider} onChange={handleLlmProviderChange}>
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="google">Gemini</option>
                    <option value="deepseek">DeepSeek (OpenAI compatible)</option>
                    <option value="dashscope">DashScope</option>
                    <option value="openai-compatible">OpenAI-compatible (custom)</option>
                    <option value="vllm">vLLM (local)</option>
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
                        <option key={m} value={m}>{m}</option>
                      ))}
                      <option value="custom">Custom…</option>
                    </select>
                    <input
                      id="llm-model"
                      type="text"
                      value={llmModel}
                      onChange={handleLlmModelChange}
                      placeholder="e.g., gpt-4o-mini"
                    />
                  </div>
                </div>

                {(llmProvider === 'deepseek' ||
                  llmProvider === 'dashscope' ||
                  llmProvider === 'openai-compatible' ||
                  llmProvider === 'vllm') && (
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
              </>
            )}

            {/* ── Ollama mode: local model config ── */}
            {executionMode === 'ollama' && (
              <>
                <div className="config-group">
                  <label className="config-label" htmlFor="ollama-model">
                    Ollama Model
                  </label>
                  <div className="model-row">
                    <select
                      id="ollama-model-presets"
                      value={ollamaModelOptions.includes(llmModel) ? llmModel : 'custom'}
                      onChange={(e) => {
                        const val = e.target.value
                        if (val === 'custom') return
                        setLlmModel(val)
                      }}
                    >
                      {ollamaModelOptions.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                      <option value="custom">Custom…</option>
                    </select>
                    <input
                      id="ollama-model"
                      type="text"
                      value={llmModel}
                      onChange={handleLlmModelChange}
                      placeholder="e.g., gemma3:1b"
                    />
                  </div>
                </div>

                <div className="config-group">
                  <label className="config-label" htmlFor="ollama-host">
                    Ollama Host
                  </label>
                  <input
                    id="ollama-host"
                    type="text"
                    value={llmBaseUrl}
                    onChange={handleLlmBaseUrlChange}
                    placeholder="http://localhost:11434"
                  />
                </div>

                <div className="config-group">
                  <div className="config-label-row">
                    <span>Detected Models</span>
                    <button
                      type="button"
                      className="inline-action-btn"
                      onClick={() => detectOllamaModels(true)}
                      disabled={ollamaModelsLoading}
                    >
                      {ollamaModelsLoading ? 'Checking…' : 'Refresh list'}
                    </button>
                  </div>
                  <div className="config-note config-note--tight">
                    {ollamaModelsError
                      ? ollamaModelsError
                      : ollamaModels.length > 0
                        ? `Detected ${ollamaModels.length} local models from ${ollamaLoadedHostRef.current ?? llmBaseUrl}`
                        : 'No detected models yet. Check that the Ollama host is reachable.'}
                  </div>
                </div>
              </>
            )}

            {/* ── OpenClaw mode: gateway status + role bindings ── */}
            {executionMode === 'openclaw' && (
              <div className="config-group">
                <div className="oc-status-row">
                  <span className={`oc-status-dot oc-status-dot--${openclawStatus}`} />
                  <span className="config-label" style={{ margin: 0 }}>
                    {openclawStatus === 'connected'
                      ? 'Gateway Connected'
                      : openclawStatus === 'connecting'
                        ? 'Connecting…'
                        : 'Gateway Disconnected'}
                  </span>
                </div>

                <div className="oc-role-list">
                  {REQUIRED_ROLES.map(({ id, label }) => {
                    const agentId = openclawBindings[id]
                    return (
                      <div key={id} className="oc-role-row">
                        <span className="oc-role-label">{label}</span>
                        <span className={`oc-role-badge ${agentId ? 'oc-role-badge--bound' : 'oc-role-badge--unbound'}`}>
                          {agentId || 'Unbound'}
                        </span>
                      </div>
                    )
                  })}
                </div>

                <button
                  type="button"
                  className="action-btn outline"
                  style={{ width: '100%' }}
                  onClick={() => setActiveTab('openclaw')}
                >
                  Configure OpenClaw →
                </button>
              </div>
            )}

            {/* ── Risk Tolerance (always visible) ── */}
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
              {executionMode === 'openclaw'
                ? <>OpenClaw mode · <strong>{Object.values(openclawBindings).filter(Boolean).length}/4</strong> roles bound · <strong>{riskTone}</strong> risk</>
                : executionMode === 'ollama'
                  ? <>Ollama · <strong>{llmModel}</strong> · <strong>{riskTone}</strong> risk</>
                  : <>API · <strong>{llmProvider}</strong> / <strong>{llmModel}</strong> · <strong>{riskTone}</strong> risk</>
              }
            </div>

            <div className="config-actions">
              <button type="button" className="action-btn outline" onClick={saveAnalysisDraft}>
                Save Draft
              </button>
              <button type="button" className="action-btn primary" onClick={() => setShowProfile(true)}>
                Profile & API Keys
              </button>
            </div>
            {draftMessage && <div className="config-note config-note--tight">{draftMessage}</div>}
          </div>
          )}
        </section>

        <div
          className={`panel-splitter panel-splitter--left ${draggingPanel === 'config' ? 'panel-splitter--active' : ''}`}
          onMouseDown={(e) => handleSplitterMouseDown(e, 'config')}
          onDoubleClick={() => togglePanelCollapse('config')}
          aria-label={isConfigCollapsed ? 'Expand configuration sidebar' : 'Collapse configuration sidebar'}
          title="Drag to resize · Double-click to collapse"
          role="separator"
        />

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
              executionMode={executionMode === 'openclaw' ? 'openclaw' : 'default'}
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
          {mode === 'login' ? (
            <>
              <label className="field-label" htmlFor="identifier">
                Email or Username
              </label>
              <input
                id="identifier"
                name="identifier"
                type="text"
                placeholder="Enter your email or username"
                value={form.identifier}
                onChange={handleInputChange}
                autoComplete="username"
              />
            </>
          ) : (
            <>
              <label className="field-label" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                placeholder="you@example.com"
                value={form.email}
                onChange={handleInputChange}
                autoComplete="email"
              />
              <label className="field-label" htmlFor="displayName">
                Display Name <span className="field-label-optional">(optional)</span>
              </label>
              <input
                id="displayName"
                name="displayName"
                type="text"
                placeholder="How you appear to others"
                value={form.displayName}
                onChange={handleInputChange}
                autoComplete="name"
              />
            </>
          )}

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
