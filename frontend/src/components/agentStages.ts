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
}

export type StageProgress = AgentStage & {
  status: StageStatus
  summary: string | null
  content: unknown
  hasContent: boolean
  durationSeconds?: number
  backend?: string
  agentId?: string | null
  sessionKey?: string | null
  rawOutput?: unknown
  error?: string | null
}

export const AGENT_STAGES: AgentStage[] = [
  { key: 'market', label: 'Technical' },
  { key: 'social', label: 'Social Media' },
  { key: 'news', label: 'News' },
  { key: 'fundamentals', label: 'Fundamentals' },
  { key: 'research_debate', label: 'Research Debate' },
  { key: 'portfolio_manager', label: 'Portfolio Manager' },
  { key: 'trader_plan', label: 'Trader Plan' },
  { key: 'risk_debate', label: 'Risk Debate' },
  { key: 'risk_management', label: 'Risk Management' },
]

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
