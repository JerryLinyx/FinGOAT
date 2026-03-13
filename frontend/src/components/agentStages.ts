import type { AnalysisTask } from '../services/tradingService'

export type AgentStageKey =
  | 'market_report'
  | 'sentiment_report'
  | 'news_report'
  | 'fundamentals_report'
  | 'investment_debate_state'
  | 'investment_plan'
  | 'trader_investment_plan'
  | 'risk_debate_state'
  | 'final_trade_decision'

export type StageStatus = 'pending' | 'processing' | 'completed' | 'failed'

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
}

export const AGENT_STAGES: AgentStage[] = [
  { key: 'market_report', label: 'Technical' },
  { key: 'sentiment_report', label: 'Social Media' },
  { key: 'news_report', label: 'News' },
  { key: 'fundamentals_report', label: 'Fundamentals' },
  { key: 'investment_debate_state', label: 'Research Debate' },
  { key: 'investment_plan', label: 'Portfolio Manager' },
  { key: 'trader_investment_plan', label: 'Trader Plan' },
  { key: 'risk_debate_state', label: 'Risk Debate' },
  { key: 'final_trade_decision', label: 'Risk Management' },
]

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

export const buildStageProgress = (task?: AnalysisTask | null): StageProgress[] => {
  const report = parseAnalysisReport(task) ?? {}
  const stageTimes = (report.__stage_times ?? {}) as Record<string, number>
  const keyOutputs = (report.__key_outputs ?? {}) as Record<string, { summary?: string }>

  const firstMissingIndex = AGENT_STAGES.findIndex((stage) => !hasValue(report[stage.key]))

  return AGENT_STAGES.map((stage, index) => {
    const content = report[stage.key]
    const hasContent = hasValue(content)
    const summary = keyOutputs[stage.key]?.summary ?? normalizeSummary(content)

    let status: StageStatus = 'pending'
    if (task?.status === 'failed') {
      status = hasContent ? 'completed' : index === (firstMissingIndex === -1 ? AGENT_STAGES.length - 1 : firstMissingIndex) ? 'failed' : 'pending'
    } else if (hasContent) {
      status = 'completed'
    } else if (task?.status === 'processing') {
      const activeIndex = firstMissingIndex === -1 ? AGENT_STAGES.length - 1 : firstMissingIndex
      status = index === activeIndex ? 'processing' : 'pending'
    } else if (task?.status === 'completed') {
      status = 'pending'
    }

    return {
      ...stage,
      status,
      summary,
      content,
      hasContent,
      durationSeconds: stageTimes[stage.key],
    }
  })
}

export const firstStageWithContent = (stages: StageProgress[]): AgentStageKey | undefined => {
  const found = stages.find((stage) => stage.hasContent)
  return found?.key
}
