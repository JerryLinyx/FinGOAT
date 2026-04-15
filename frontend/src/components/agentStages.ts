import type { AnalysisStage, AnalysisTask } from '../services/tradingService'

export type AgentStageKey =
  | 'market'
  | 'social'
  | 'news'
  | 'fundamentals'
  | 'research_debate'
  | 'portfolio_manager'
  | 'trader_plan'
  | 'risk_debate'
  | 'risk_management'

export type StageStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'

export type AgentStage = {
  key: AgentStageKey
  label: string
  icon: string
}

export type StageProgress = AgentStage & {
  status: StageStatus
  summary: string | null
  content: unknown
  hasContent: boolean
  durationSeconds?: number
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  llmCalls?: number
  failedCalls?: number
  latencyMs?: number
  backend?: string
  agentId?: string | null
  sessionKey?: string | null
  rawOutput?: unknown
  error?: string | null
}

export const AGENT_STAGES: AgentStage[] = [
  { key: 'market',            label: 'Technical',         icon: '📈' },
  { key: 'social',            label: 'Social Media',      icon: '📱' },
  { key: 'news',              label: 'News',              icon: '📰' },
  { key: 'fundamentals',      label: 'Fundamentals',      icon: '💹' },
  { key: 'research_debate',   label: 'Research Debate',   icon: '🔬' },
  { key: 'portfolio_manager', label: 'Portfolio Manager', icon: '💼' },
  { key: 'trader_plan',       label: 'Trader Plan',       icon: '📋' },
  { key: 'risk_debate',       label: 'Risk Debate',       icon: '⚖️' },
  { key: 'risk_management',   label: 'Risk Management',   icon: '🛡️' },
]

// ── Team definitions used by the web dashboard's live stage grouping ─────────

export interface AgentTeam {
  name: string
  icon: string
  stages: AgentStageKey[]
}

export const AGENT_TEAMS: AgentTeam[] = [
  { name: 'Analyst Team',          icon: '🔍', stages: ['market', 'social', 'news', 'fundamentals'] },
  { name: 'Research Team',         icon: '🔬', stages: ['research_debate'] },
  { name: 'Portfolio Management',  icon: '💼', stages: ['portfolio_manager'] },
  { name: 'Trading Team',          icon: '📋', stages: ['trader_plan'] },
  { name: 'Risk Management',       icon: '🛡️', stages: ['risk_debate', 'risk_management'] },
]

export const STAGE_LABEL_MAP: Record<AgentStageKey, string> = Object.fromEntries(
  AGENT_STAGES.map((s) => [s.key, s.label]),
) as Record<AgentStageKey, string>

// ── Activity log types ───────────────────────────────────────────────────────

export interface ActivityEntry {
  id: number
  timestamp: number
  type: 'token' | 'stage_start' | 'stage_end' | 'task_info' | 'error'
  stageId?: string
  node?: string       // LangGraph node name e.g. "Bull Researcher"
  nodeLabel?: string  // Display label e.g. "Bull"
  content: string
}

let _activityId = 0
export const nextActivityId = () => ++_activityId
export const resetActivityId = () => { _activityId = 0 }

// ── Aggregate stats from stages ──────────────────────────────────────────────

export interface AgentStats {
  totalStages: number
  completedStages: number
  totalTokens: number
  promptTokens: number
  completionTokens: number
  llmCalls: number
  failedCalls: number
  totalDuration: number
  reportsGenerated: number
}

export const aggregateStats = (stages: StageProgress[]): AgentStats => {
  let totalTokens = 0
  let promptTokens = 0
  let completionTokens = 0
  let llmCalls = 0
  let failedCalls = 0
  let totalDuration = 0
  let reportsGenerated = 0

  for (const s of stages) {
    if (s.totalTokens) totalTokens += s.totalTokens
    if (s.promptTokens) promptTokens += s.promptTokens
    if (s.completionTokens) completionTokens += s.completionTokens
    if (s.llmCalls) llmCalls += s.llmCalls
    if (s.failedCalls) failedCalls += s.failedCalls
    if (s.durationSeconds) totalDuration += s.durationSeconds
    if (s.hasContent) reportsGenerated++
  }

  return {
    totalStages: stages.length,
    completedStages: stages.filter((s) => s.status === 'completed').length,
    totalTokens,
    promptTokens,
    completionTokens,
    llmCalls,
    failedCalls,
    totalDuration,
    reportsGenerated,
  }
}

const LEGACY_REPORT_KEY_BY_STAGE: Record<AgentStageKey, string> = {
  market: 'market_report',
  social: 'sentiment_report',
  news: 'news_report',
  fundamentals: 'fundamentals_report',
  research_debate: 'investment_debate_state',
  portfolio_manager: 'investment_plan',
  trader_plan: 'trader_investment_plan',
  risk_debate: 'risk_debate_state',
  risk_management: 'final_trade_decision',
}

const hasValue = (value: unknown): boolean => {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.some(hasValue)
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).some(hasValue)
  return true
}

export const parseAnalysisReport = (task?: AnalysisTask | null): Record<string, unknown> | null => {
  if (!task?.analysis_report) return null
  return task.analysis_report as Record<string, unknown>
}

const normalizeSummary = (value: unknown): string | null => {
  if (!hasValue(value)) return null
  if (typeof value === 'string') {
    const trimmed = value.replace(/\s+/g, ' ').trim()
    return trimmed.length > 180 ? `${trimmed.slice(0, 179)}...` : trimmed
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    for (const key of ['summary', 'judge_decision', 'current_response', 'explanation']) {
      if (key in obj) {
        const nested = normalizeSummary(obj[key])
        if (nested) return nested
      }
    }
    try {
      const json = JSON.stringify(obj)
      return json.length > 180 ? `${json.slice(0, 179)}...` : json
    } catch {
      return String(value)
    }
  }
  return String(value)
}

const buildFromCanonicalStages = (stages: AnalysisStage[]): StageProgress[] => {
  const byId = new Map(stages.map((stage) => [stage.stage_id, stage]))
  return AGENT_STAGES.map((definition) => {
    const stage = byId.get(definition.key)
    const content = stage?.content
    return {
      ...definition,
      status: stage?.status ?? 'pending',
      summary: stage?.summary ?? normalizeSummary(content),
      content,
      hasContent: hasValue(content),
      durationSeconds: stage?.duration_seconds,
      promptTokens: stage?.prompt_tokens,
      completionTokens: stage?.completion_tokens,
      totalTokens: stage?.total_tokens,
      llmCalls: stage?.llm_calls,
      failedCalls: stage?.failed_calls,
      latencyMs: stage?.latency_ms,
      backend: stage?.backend,
      agentId: stage?.agent_id ?? null,
      sessionKey: stage?.session_key ?? null,
      rawOutput: stage?.raw_output,
      error: stage?.error ?? null,
    }
  })
}

const buildFromLegacyReport = (task?: AnalysisTask | null): StageProgress[] => {
  const report = parseAnalysisReport(task) ?? {}
  const stageTimes = (report.__stage_times ?? {}) as Record<string, number>
  const keyOutputs = (report.__key_outputs ?? {}) as Record<string, { summary?: string }>

  const firstMissingIndex = AGENT_STAGES.findIndex((stage) => !hasValue(report[LEGACY_REPORT_KEY_BY_STAGE[stage.key]]))

  return AGENT_STAGES.map((stage, index) => {
    const reportKey = LEGACY_REPORT_KEY_BY_STAGE[stage.key]
    const content = report[reportKey]
    const hasContent = hasValue(content)
    const summary = keyOutputs[reportKey]?.summary ?? normalizeSummary(content)

    let status: StageStatus = 'pending'
    if (task?.status === 'failed') {
      status = hasContent ? 'completed' : index === (firstMissingIndex === -1 ? AGENT_STAGES.length - 1 : firstMissingIndex) ? 'failed' : 'pending'
    } else if (task?.status === 'cancelled') {
      status = hasContent ? 'completed' : index === (firstMissingIndex === -1 ? AGENT_STAGES.length - 1 : firstMissingIndex) ? 'cancelled' : 'pending'
    } else if (hasContent) {
      status = 'completed'
    } else if (task?.status === 'processing') {
      const activeIndex = firstMissingIndex === -1 ? AGENT_STAGES.length - 1 : firstMissingIndex
      status = index === activeIndex ? 'processing' : 'pending'
    }

    return {
      ...stage,
      status,
      summary,
      content,
      hasContent,
      durationSeconds: stageTimes[reportKey],
      promptTokens: undefined,
      completionTokens: undefined,
      totalTokens: undefined,
      llmCalls: undefined,
      failedCalls: undefined,
      latencyMs: undefined,
      backend: stage.key && task?.execution_mode === 'openclaw' && ['market', 'social', 'news', 'fundamentals'].includes(stage.key) ? 'openclaw' : 'default',
      agentId: null,
      sessionKey: null,
      rawOutput: undefined,
      error: status === 'failed' || status === 'cancelled' ? task?.error ?? null : null,
    }
  })
}

export const buildStageProgress = (task?: AnalysisTask | null): StageProgress[] => {
  if (task?.stages && task.stages.length > 0) {
    return buildFromCanonicalStages(task.stages)
  }
  return buildFromLegacyReport(task)
}

export const firstStageWithContent = (stages: StageProgress[]): AgentStageKey | undefined => {
  const found = stages.find((stage) => stage.hasContent)
  return found?.key
}

// ── Node → Stage mapping (mirrors Python backend NODE_TO_STAGE) ──────────────

export const NODE_TO_STAGE: Record<string, AgentStageKey> = {
  'Market Analyst':       'market',
  'Social Analyst':       'social',
  'News Analyst':         'news',
  'Fundamentals Analyst': 'fundamentals',
  'Bull Researcher':      'research_debate',
  'Bear Researcher':      'research_debate',
  'Research Manager':     'portfolio_manager',
  'Trader':               'trader_plan',
  'Risky Analyst':        'risk_debate',
  'Safe Analyst':         'risk_debate',
  'Neutral Analyst':      'risk_debate',
  'Risk Judge':           'risk_management',
}

export const NODE_LABEL: Record<string, string> = {
  'Market Analyst':       'Technical',
  'Social Analyst':       'Social Media',
  'News Analyst':         'News',
  'Fundamentals Analyst': 'Fundamentals',
  'Bull Researcher':      'Bull',
  'Bear Researcher':      'Bear',
  'Research Manager':     'Research Manager',
  'Trader':               'Trader',
  'Risky Analyst':        'Risky',
  'Safe Analyst':         'Safe',
  'Neutral Analyst':      'Neutral',
  'Risk Judge':           'Risk Judge',
}

export const NODE_ICON: Record<string, string> = {
  'Market Analyst':       '📈',
  'Social Analyst':       '📱',
  'News Analyst':         '📰',
  'Fundamentals Analyst': '💹',
  'Bull Researcher':      '🐂',
  'Bear Researcher':      '🐻',
  'Research Manager':     '💼',
  'Trader':               '📋',
  'Risky Analyst':        '🔥',
  'Safe Analyst':         '🛡',
  'Neutral Analyst':      '⚖️',
  'Risk Judge':           '🏛',
}

// ── Execution phases for parallel visualization ───────────────────────────────

export interface ExecutionPhase {
  id: string
  label: string
  icon: string
  description: string
  isParallel: boolean
  nodes: string[]            // LangGraph node names in this phase (ordered)
  stageIds: AgentStageKey[]  // stage_ids covered by this phase
}

export const EXECUTION_PHASES: ExecutionPhase[] = [
  {
    id: 'analyst',
    label: 'Analyst Team',
    icon: '🔍',
    description: '4 agents in parallel',
    isParallel: true,
    nodes: ['Market Analyst', 'Social Analyst', 'News Analyst', 'Fundamentals Analyst'],
    stageIds: ['market', 'social', 'news', 'fundamentals'],
  },
  {
    id: 'research',
    label: 'Research Debate',
    icon: '🔬',
    description: 'Bull ↔ Bear',
    isParallel: false,
    nodes: ['Bull Researcher', 'Bear Researcher', 'Research Manager'],
    stageIds: ['research_debate', 'portfolio_manager'],
  },
  {
    id: 'trading',
    label: 'Trading',
    icon: '📋',
    description: 'Trade decision',
    isParallel: false,
    nodes: ['Trader'],
    stageIds: ['trader_plan'],
  },
  {
    id: 'risk',
    label: 'Risk Management',
    icon: '🛡️',
    description: 'Risk debate + judgment',
    isParallel: false,
    nodes: ['Risky Analyst', 'Safe Analyst', 'Neutral Analyst', 'Risk Judge'],
    stageIds: ['risk_debate', 'risk_management'],
  },
]

// ── Live stage result (from parsed stage_end SSE event) ───────────────────────

export interface LiveStageResult {
  stageId: string
  status: string
  summary?: string
  durationSeconds?: number
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  llmCalls?: number
  failedCalls?: number
  latencyMs?: number
}

export function parseLiveStageResult(raw: string): LiveStageResult | null {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>
    return {
      stageId:           String(obj.stage_id ?? ''),
      status:            String(obj.status ?? 'completed'),
      summary:           typeof obj.summary === 'string' ? obj.summary : undefined,
      durationSeconds:   typeof obj.duration_seconds === 'number' ? obj.duration_seconds : undefined,
      promptTokens:      typeof obj.prompt_tokens === 'number' ? obj.prompt_tokens : undefined,
      completionTokens:  typeof obj.completion_tokens === 'number' ? obj.completion_tokens : undefined,
      totalTokens:       typeof obj.total_tokens === 'number' ? obj.total_tokens : undefined,
      llmCalls:          typeof obj.llm_calls === 'number' ? obj.llm_calls : undefined,
      failedCalls:       typeof obj.failed_calls === 'number' ? obj.failed_calls : undefined,
      latencyMs:         typeof obj.latency_ms === 'number' ? obj.latency_ms : undefined,
    }
  } catch {
    return null
  }
}
